import { and, eq } from "drizzle-orm";
import type {
  AutomatedReviewFinding,
  AutomatedReviewSummary,
  BranchRole,
  QualitySignalValue,
  QualitySignalsSnapshot,
  RepoPolicy,
  TriageBucket,
} from "@u3code/hub-contracts";
import { DEFAULT_REPO_POLICY } from "@u3code/hub-contracts";
import type { HubDatabase } from "../db/client.ts";
import {
  changeRequests,
  projectRepos,
  projects,
  pulses,
  releases,
  webhookDeliveries,
  workItemLinks,
  workItems,
} from "../db/schema.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import { newId } from "../utils/crypto.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

/**
 * Extracts a project work-item code (e.g. NEX-101) from PR body, title, or branch name.
 */
export function extractWorkItemCode(input: {
  readonly title: string;
  readonly body?: string | null;
  readonly headBranch: string;
}): string | null {
  const body = input.body ?? "";
  const explicit = /(?:refs|closes|fixes|work-item|item)[:\s#]+([A-Z][A-Z0-9]{1,9}-\d+)/i.exec(
    body,
  );
  if (explicit?.[1]) return explicit[1].toUpperCase();

  const titleTag = /(?:\[|\b)([A-Z][A-Z0-9]{1,9}-\d+)(?:\]|\b)/.exec(input.title);
  if (titleTag?.[1]) return titleTag[1].toUpperCase();

  const branchMatch = /(?:^|\/)([A-Z][A-Z0-9]{1,9}-\d+)(?:[-_/]|$)/i.exec(input.headBranch);
  if (branchMatch?.[1]) return branchMatch[1].toUpperCase();

  return null;
}

export function resolveBranchRole(policy: RepoPolicy, baseBranch: string): BranchRole {
  const match = policy.branches.find((b) => b.name === baseBranch);
  return match?.role ?? "other";
}

export function isAutoMergeBranch(policy: RepoPolicy, baseBranch: string): boolean {
  const match = policy.branches.find((b) => b.name === baseBranch);
  return match?.mergePolicy === "auto_on_low_risk";
}

export function matchAutomatedReviewer(
  policy: RepoPolicy,
  senderLogin: string,
): { readonly name: string; readonly blockingStates: readonly string[] } | null {
  const normalized = senderLogin.trim().toLowerCase();
  for (const rule of policy.automatedReviewers) {
    if (rule.botLogins.some((login) => login.trim().toLowerCase() === normalized)) {
      return { name: rule.name, blockingStates: rule.blockingStates };
    }
  }
  return null;
}

export function inferRiskLevel(text: string): "low" | "medium" | "high" | "unknown" {
  const lower = text.toLowerCase();
  if (/(high\s*risk|critical|高风险|严重)/.test(lower)) return "high";
  if (/(medium\s*risk|moderate|中风险)/.test(lower)) return "medium";
  if (/(low\s*risk|no\s*risk|低风险|无风险)/.test(lower)) return "low";
  return "unknown";
}

export function extractQualitySignal(
  policy: RepoPolicy,
  checkName: string,
  textToScan: string,
): QualitySignalValue | null {
  const rule = policy.qualitySignals.find(
    (s) => s.checkName.toLowerCase() === checkName.toLowerCase(),
  );
  if (!rule) return null;

  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, "i");
  } catch {
    return null;
  }

  const match = regex.exec(textToScan);
  const rawNumber = match?.[1] ? Number.parseFloat(match[1]) : Number.NaN;
  const value = Number.isFinite(rawNumber) ? rawNumber : null;

  let passed: boolean | null = null;
  if (value !== null) {
    const minOk = rule.minValue === undefined || value >= rule.minValue;
    const maxOk = rule.maxValue === undefined || value <= rule.maxValue;
    passed = minOk && maxOk;
  }

  return {
    key: rule.key,
    ...(rule.label !== undefined ? { label: rule.label } : {}),
    value,
    ...(rule.minValue !== undefined ? { minValue: rule.minValue } : {}),
    ...(rule.maxValue !== undefined ? { maxValue: rule.maxValue } : {}),
    ...(rule.unit !== undefined ? { unit: rule.unit } : {}),
    passed,
    rawSummary: textToScan.slice(0, 200),
  };
}

export function computeTriageBucket(input: {
  readonly state: string;
  readonly baseBranchRole: BranchRole;
  readonly workItemId: string | null;
  readonly automatedReview: AutomatedReviewSummary;
  readonly qualitySignals: QualitySignalsSnapshot;
  readonly humanReviewState: string;
}): TriageBucket {
  if (input.state === "draft") return "draft";
  if (input.state === "merged") {
    return input.baseBranchRole === "integration" && input.automatedReview.status === "auto_merged"
      ? "auto_merged_integration"
      : "merged";
  }
  if (input.state === "closed") return "merged";
  if (input.automatedReview.status === "blocking" || input.automatedReview.blockingCount > 0) {
    return "bot_blocked";
  }
  if (input.workItemId === null) {
    return "orphan";
  }
  const anySignalFailed = Object.values(input.qualitySignals.signals).some(
    (sig) => sig.passed === false,
  );
  if (input.qualitySignals.ciStatus === "failure" || anySignalFailed) {
    return "ci_blocked";
  }
  if (
    (input.automatedReview.status === "pass" ||
      input.automatedReview.status === "skipped" ||
      input.automatedReview.reviewers.length === 0) &&
    input.humanReviewState === "pending"
  ) {
    return "ready_for_human_review";
  }
  return "ci_blocked";
}

export interface GitHubWebhookDeps {
  readonly db: HubDatabase;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
}

export interface GitHubWebhookResult {
  readonly handled: boolean;
  readonly duplicate?: boolean;
  readonly detail: string;
}

export async function handleGitHubWebhook(
  deps: GitHubWebhookDeps,
  input: {
    readonly deliveryId: string;
    readonly eventName: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<GitHubWebhookResult> {
  const existingDelivery = await deps.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, input.deliveryId))
    .limit(1);
  if (existingDelivery[0]) {
    return { handled: true, duplicate: true, detail: "Duplicate delivery ignored." };
  }

  await deps.db.insert(webhookDeliveries).values({
    deliveryId: input.deliveryId,
    forgeKind: "github",
    eventName: input.eventName,
  });

  const repository = input.payload.repository as { readonly full_name?: string } | undefined;
  const repoFullName = repository?.full_name;
  if (!repoFullName) {
    return { handled: false, detail: "Missing repository.full_name." };
  }

  const repoRows = await deps.db
    .select({
      repo: projectRepos,
      project: projects,
    })
    .from(projectRepos)
    .innerJoin(projects, eq(projectRepos.projectId, projects.id))
    .where(and(eq(projectRepos.forgeKind, "github"), eq(projectRepos.repoFullName, repoFullName)))
    .limit(1);

  const repoContext = repoRows[0];
  const policy: RepoPolicy = repoContext?.repo.repoPolicy?.branches?.length
    ? repoContext.repo.repoPolicy
    : DEFAULT_REPO_POLICY;

  if (input.eventName === "pull_request") {
    return handlePullRequestEvent(deps, repoFullName, repoContext, policy, input.payload);
  }
  if (input.eventName === "pull_request_review") {
    return handlePullRequestReviewEvent(deps, repoFullName, repoContext, policy, input.payload);
  }
  if (input.eventName === "check_run") {
    return handleCheckRunEvent(deps, repoFullName, repoContext, policy, input.payload);
  }
  if (input.eventName === "deployment_status") {
    return handleDeploymentStatusEvent(deps, repoFullName, repoContext, input.payload);
  }

  return { handled: false, detail: `Event '${input.eventName}' ignored.` };
}

type RepoContext =
  | {
      readonly repo: typeof projectRepos.$inferSelect;
      readonly project: typeof projects.$inferSelect;
    }
  | undefined;

async function handlePullRequestEvent(
  deps: GitHubWebhookDeps,
  repoFullName: string,
  repoContext: RepoContext,
  policy: RepoPolicy,
  payload: Record<string, unknown>,
): Promise<GitHubWebhookResult> {
  const action = String(payload.action ?? "");
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  if (!pr) return { handled: false, detail: "Missing pull_request payload." };

  const number = Number(pr.number);
  const title = String(pr.title ?? "");
  const body = typeof pr.body === "string" ? pr.body : "";
  const url = String(pr.html_url ?? "");
  const head = pr.head as { readonly ref?: string; readonly sha?: string } | undefined;
  const base = pr.base as { readonly ref?: string } | undefined;
  const user = pr.user as { readonly login?: string } | undefined;
  const mergedBy = pr.merged_by as { readonly login?: string } | undefined;

  const headBranch = String(head?.ref ?? "");
  const headSha = String(head?.sha ?? "");
  const baseBranch = String(base?.ref ?? "");
  const authorVcsLogin = String(user?.login ?? "unknown");
  const merged = pr.merged === true;
  const draft = pr.draft === true;
  const rawState = String(pr.state ?? "open");
  const state = merged ? "merged" : draft ? "draft" : rawState === "closed" ? "closed" : "open";
  const additions = Number(pr.additions ?? 0);
  const deletions = Number(pr.deletions ?? 0);
  const maxLines = policy.maxPrChangedLines ?? 500;
  const isOversized = additions + deletions > maxLines;
  const baseBranchRole = resolveBranchRole(policy, baseBranch);

  const code = extractWorkItemCode({ title, body, headBranch });
  let workItem: typeof workItems.$inferSelect | undefined;
  if (code) {
    const found = await deps.db.select().from(workItems).where(eq(workItems.code, code)).limit(1);
    workItem = found[0];
  }

  const existingRows = await deps.db
    .select()
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.forgeKind, "github"),
        eq(changeRequests.repoFullName, repoFullName),
        eq(changeRequests.number, number),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  const shaChanged = existing !== undefined && existing.headSha !== headSha;
  let automatedReview: AutomatedReviewSummary =
    existing && !shaChanged
      ? existing.automatedReview
      : {
          status: policy.automatedReviewers.length > 0 ? "pending" : "skipped",
          blockingCount: 0,
          reviewers: [],
        };

  const qualitySignals: QualitySignalsSnapshot =
    existing && !shaChanged ? existing.qualitySignals : { ciStatus: "pending", signals: {} };

  const humanReviewState = existing && !shaChanged ? existing.humanReviewState : "pending";

  const mergedByBot =
    merged &&
    mergedBy?.login !== undefined &&
    matchAutomatedReviewer(policy, mergedBy.login) !== null;

  if (merged && (mergedByBot || isAutoMergeBranch(policy, baseBranch))) {
    automatedReview = {
      ...automatedReview,
      status: automatedReview.blockingCount > 0 ? automatedReview.status : "auto_merged",
    };
  }

  const triageBucket = computeTriageBucket({
    state,
    baseBranchRole,
    workItemId: workItem?.id ?? null,
    automatedReview,
    qualitySignals,
    humanReviewState,
  });

  const nowIso = new Date().toISOString();
  const mergedAt = merged ? String(pr.merged_at ?? nowIso) : (existing?.mergedAt ?? null);

  if (existing) {
    await deps.db
      .update(changeRequests)
      .set({
        workItemId: workItem?.id ?? null,
        title,
        url,
        headBranch,
        baseBranch,
        baseBranchRole,
        headSha,
        authorVcsLogin,
        state,
        additions,
        deletions,
        isOversized,
        automatedReview,
        qualitySignals,
        humanReviewState,
        triageBucket,
        mergedAt,
        updatedAt: nowIso,
      })
      .where(eq(changeRequests.id, existing.id));
  } else {
    await deps.db.insert(changeRequests).values({
      id: newId("cr"),
      forgeKind: "github",
      repoFullName,
      number,
      workItemId: workItem?.id ?? null,
      title,
      url,
      headBranch,
      baseBranch,
      baseBranchRole,
      headSha,
      authorVcsLogin,
      state,
      additions,
      deletions,
      isOversized,
      automatedReview,
      qualitySignals,
      humanReviewState,
      triageBucket,
      mergedAt,
      updatedAt: nowIso,
    });
  }

  if (workItem) {
    await deps.db
      .insert(workItemLinks)
      .values({
        id: newId("lnk"),
        workItemId: workItem.id,
        linkType: "change_request",
        repoFullName,
        externalId: String(number),
        url,
        title,
        metadata: { baseBranch, baseBranchRole, state },
      })
      .onConflictDoNothing();
  }

  // Auto-generate a System Pulse on merge so the cockpit never goes blind when humans forget to sync.
  if (action === "closed" && merged && workItem) {
    const pulseId = newId("pls");
    const mergeKindLabel =
      baseBranchRole === "integration" ? `merged into ${baseBranch}` : `merged into ${baseBranch}`;
    await deps.db.insert(pulses).values({
      id: pulseId,
      workItemId: workItem.id,
      sourceType: "system_merge",
      repoFullName,
      stageAtTime: workItem.stage,
      health: workItem.health,
      doneSummary: `PR #${number} (${title}) ${mergeKindLabel} (+${additions}/-${deletions}).`,
      decisions: [],
      blockers: [],
      nextStep:
        baseBranchRole === "integration"
          ? "Verify on integration/staging before release promotion."
          : "Verify production rollout.",
      progressedAcIds: [],
    });

    if (repoContext) {
      deps.broker.broadcast({
        type: "pulse.created",
        workspaceId: repoContext.project.workspaceId,
        projectId: repoContext.project.id,
        workItemId: workItem.id,
        pulseId,
        hasBlocker: false,
      });
    }
  }

  if (repoContext) {
    deps.broker.broadcast({
      type: "change_request.updated",
      workspaceId: repoContext.project.workspaceId,
      projectId: repoContext.project.id,
      repoFullName,
      number,
      triageBucket,
      blockingCount: automatedReview.blockingCount,
    });
  }

  return { handled: true, detail: `Processed pull_request #${number} (${action}).` };
}

async function handlePullRequestReviewEvent(
  deps: GitHubWebhookDeps,
  repoFullName: string,
  repoContext: RepoContext,
  policy: RepoPolicy,
  payload: Record<string, unknown>,
): Promise<GitHubWebhookResult> {
  const pr = payload.pull_request as
    | { readonly number?: number; readonly html_url?: string; readonly title?: string }
    | undefined;
  const review = payload.review as
    | {
        readonly state?: string;
        readonly body?: string;
        readonly html_url?: string;
        readonly user?: { readonly login?: string };
      }
    | undefined;
  if (!pr?.number || !review?.user?.login) {
    return { handled: false, detail: "Incomplete pull_request_review payload." };
  }

  const existingRows = await deps.db
    .select()
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.forgeKind, "github"),
        eq(changeRequests.repoFullName, repoFullName),
        eq(changeRequests.number, pr.number),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return { handled: false, detail: `PR #${pr.number} not tracked yet.` };
  }

  const senderLogin = review.user.login;
  const reviewState = String(review.state ?? "").toUpperCase();
  const body = String(review.body ?? "");
  const matchedBot = matchAutomatedReviewer(policy, senderLogin);
  const nowIso = new Date().toISOString();

  let automatedReview = existing.automatedReview;
  let humanReviewState = existing.humanReviewState;

  if (matchedBot) {
    const isBlocking = matchedBot.blockingStates.some((s) => s.toUpperCase() === reviewState);
    const finding: AutomatedReviewFinding = {
      reviewerName: matchedBot.name,
      state: reviewState,
      riskLevel: inferRiskLevel(body),
      bodyExcerpt: body.slice(0, 400),
      ...(review.html_url ? { url: review.html_url } : {}),
      updatedAt: nowIso,
    };

    const otherReviewers = automatedReview.reviewers.filter(
      (r) => r.reviewerName !== matchedBot.name,
    );
    const nextReviewers = [...otherReviewers, finding];
    const blockingCount = nextReviewers.filter((r) =>
      matchedBot.blockingStates.some((s) => s.toUpperCase() === r.state.toUpperCase()),
    ).length;

    automatedReview = {
      status: isBlocking
        ? "blocking"
        : reviewState === "APPROVED"
          ? "pass"
          : automatedReview.status,
      blockingCount,
      reviewers: nextReviewers,
    };

    if (isBlocking && existing.workItemId) {
      const workItemRows = await deps.db
        .select()
        .from(workItems)
        .where(eq(workItems.id, existing.workItemId))
        .limit(1);
      const wi = workItemRows[0];
      if (wi) {
        const pulseId = newId("pls");
        await deps.db.insert(pulses).values({
          id: pulseId,
          workItemId: wi.id,
          sourceType: "system_review_block",
          repoFullName,
          stageAtTime: wi.stage,
          health: "at_risk",
          doneSummary: `${matchedBot.name} flagged PR #${existing.number} with ${reviewState}.`,
          decisions: [],
          blockers: [
            {
              text: `${matchedBot.name}: ${body.slice(0, 180) || reviewState}`,
              needsAttentionRoles: ["dev", "security", "owner"],
            },
          ],
          nextStep: `Address ${matchedBot.name} review findings on PR #${existing.number}.`,
          progressedAcIds: [],
        });

        await deps.db
          .update(workItems)
          .set({ health: "at_risk", updatedAt: nowIso })
          .where(eq(workItems.id, wi.id));
      }
    }

    if (isBlocking && repoContext) {
      await deps.notifier.dispatch(repoContext.project.workspaceId, repoContext.project.id, {
        event: "pr.bot_blocked",
        title: `[${matchedBot.name}] PR #${existing.number} Blocked (${repoFullName})`,
        severity: finding.riskLevel === "high" ? "critical" : "warning",
        summary: `${matchedBot.name} requested changes on "${existing.title}" by @${existing.authorVcsLogin}.`,
        bullets: [
          `Branch: ${existing.headBranch} -> ${existing.baseBranch}`,
          ...(body ? [`Excerpt: ${body.slice(0, 180)}`] : []),
        ],
        url: existing.url,
      });
    }
  } else {
    if (reviewState === "APPROVED") humanReviewState = "approved";
    else if (reviewState === "CHANGES_REQUESTED") humanReviewState = "changes_requested";
  }

  const triageBucket = computeTriageBucket({
    state: existing.state,
    baseBranchRole: existing.baseBranchRole as BranchRole,
    workItemId: existing.workItemId,
    automatedReview,
    qualitySignals: existing.qualitySignals,
    humanReviewState,
  });

  await deps.db
    .update(changeRequests)
    .set({
      automatedReview,
      humanReviewState,
      triageBucket,
      updatedAt: nowIso,
    })
    .where(eq(changeRequests.id, existing.id));

  if (repoContext) {
    deps.broker.broadcast({
      type: "change_request.updated",
      workspaceId: repoContext.project.workspaceId,
      projectId: repoContext.project.id,
      repoFullName,
      number: existing.number,
      triageBucket,
      blockingCount: automatedReview.blockingCount,
    });
  }

  return { handled: true, detail: `Processed review by ${senderLogin} on PR #${existing.number}.` };
}

async function handleCheckRunEvent(
  deps: GitHubWebhookDeps,
  repoFullName: string,
  repoContext: RepoContext,
  policy: RepoPolicy,
  payload: Record<string, unknown>,
): Promise<GitHubWebhookResult> {
  const checkRun = payload.check_run as
    | {
        readonly name?: string;
        readonly status?: string;
        readonly conclusion?: string | null;
        readonly head_sha?: string;
        readonly output?: { readonly title?: string | null; readonly summary?: string | null };
        readonly pull_requests?: ReadonlyArray<{ readonly number: number }>;
      }
    | undefined;

  if (!checkRun?.name || checkRun.status !== "completed") {
    return { handled: false, detail: "Check run not completed." };
  }

  const prNumbers = (checkRun.pull_requests ?? []).map((p) => p.number);
  let targetRows: Array<typeof changeRequests.$inferSelect> = [];
  if (prNumbers.length > 0) {
    for (const num of prNumbers) {
      const found = await deps.db
        .select()
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.forgeKind, "github"),
            eq(changeRequests.repoFullName, repoFullName),
            eq(changeRequests.number, num),
          ),
        )
        .limit(1);
      if (found[0]) targetRows.push(found[0]);
    }
  } else if (checkRun.head_sha) {
    targetRows = await deps.db
      .select()
      .from(changeRequests)
      .where(
        and(
          eq(changeRequests.forgeKind, "github"),
          eq(changeRequests.repoFullName, repoFullName),
          eq(changeRequests.headSha, checkRun.head_sha),
        ),
      );
  }

  if (targetRows.length === 0) {
    return { handled: false, detail: "No matching PR found for check_run." };
  }

  const scanText = `${checkRun.output?.title ?? ""}\n${checkRun.output?.summary ?? ""}`;
  const extractedSignal = extractQualitySignal(policy, checkRun.name, scanText);
  const conclusion = checkRun.conclusion ?? "";
  const isFailure =
    conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required";
  const isSuccess =
    conclusion === "success" || conclusion === "neutral" || conclusion === "skipped";

  const nowIso = new Date().toISOString();
  for (const row of targetRows) {
    const nextSignals = { ...row.qualitySignals.signals };
    if (extractedSignal) {
      nextSignals[extractedSignal.key] = extractedSignal;
    }

    const nextCiStatus = isFailure
      ? "failure"
      : isSuccess && row.qualitySignals.ciStatus !== "failure"
        ? "success"
        : row.qualitySignals.ciStatus;

    const qualitySignals: QualitySignalsSnapshot = {
      ciStatus: nextCiStatus,
      signals: nextSignals,
    };

    const triageBucket = computeTriageBucket({
      state: row.state,
      baseBranchRole: row.baseBranchRole as BranchRole,
      workItemId: row.workItemId,
      automatedReview: row.automatedReview,
      qualitySignals,
      humanReviewState: row.humanReviewState,
    });

    await deps.db
      .update(changeRequests)
      .set({ qualitySignals, triageBucket, updatedAt: nowIso })
      .where(eq(changeRequests.id, row.id));

    if (repoContext) {
      deps.broker.broadcast({
        type: "change_request.updated",
        workspaceId: repoContext.project.workspaceId,
        projectId: repoContext.project.id,
        repoFullName,
        number: row.number,
        triageBucket,
        blockingCount: row.automatedReview.blockingCount,
      });
    }
  }

  return {
    handled: true,
    detail: `Processed check_run '${checkRun.name}' for ${targetRows.length} PR(s).`,
  };
}

async function handleDeploymentStatusEvent(
  deps: GitHubWebhookDeps,
  repoFullName: string,
  repoContext: RepoContext,
  payload: Record<string, unknown>,
): Promise<GitHubWebhookResult> {
  if (!repoContext) return { handled: false, detail: "Repository not linked to any project." };

  const deployment = payload.deployment as
    | { readonly environment?: string; readonly sha?: string }
    | undefined;
  const deploymentStatus = payload.deployment_status as { readonly state?: string } | undefined;
  if (!deployment?.environment || !deploymentStatus?.state) {
    return { handled: false, detail: "Missing deployment status fields." };
  }

  const activeReleases = await deps.db
    .select()
    .from(releases)
    .where(and(eq(releases.projectId, repoContext.project.id), eq(releases.status, "staging")));

  const nowIso = new Date().toISOString();
  for (const rel of activeReleases) {
    const nextSnapshots = {
      ...rel.repoSnapshots,
      [repoFullName]: {
        environment: deployment.environment,
        sha: deployment.sha ?? null,
        state: deploymentStatus.state,
        updatedAt: nowIso,
      },
    };
    await deps.db
      .update(releases)
      .set({ repoSnapshots: nextSnapshots, updatedAt: nowIso })
      .where(eq(releases.id, rel.id));
  }

  return {
    handled: true,
    detail: `Recorded deployment_status '${deploymentStatus.state}' for ${repoFullName}.`,
  };
}
