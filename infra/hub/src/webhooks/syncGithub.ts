import { and, eq } from "drizzle-orm";
import {
  DEFAULT_REPO_POLICY,
  type AutomatedReviewFinding,
  type AutomatedReviewSummary,
  type QualitySignalsSnapshot,
  type RepoPolicy,
} from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { changeRequests, projectRepos, projects, workItems } from "../db/schema.ts";
import { newId } from "../utils/crypto.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";
import {
  computeTriageBucket,
  extractWorkItemCode,
  inferRiskLevel,
  matchAutomatedReviewer,
  resolveBranchRole,
} from "./github.ts";

interface GitHubPullSummary {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly html_url: string;
  readonly draft?: boolean;
  readonly state: string;
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string };
  readonly user: { readonly login: string } | null;
  readonly additions?: number;
  readonly deletions?: number;
}

interface GitHubPullReview {
  readonly state: string;
  readonly body: string | null;
  readonly html_url?: string;
  readonly submitted_at?: string;
  readonly user: { readonly login: string } | null;
}

export interface SyncGitHubRepoResult {
  readonly repoFullName: string;
  readonly syncedCount: number;
  readonly openCount: number;
  readonly linkedCount: number;
}

export async function syncGitHubOpenPullRequests(
  deps: {
    readonly db: HubDatabase;
    readonly config: HubConfig;
    readonly broker: HubSocketBroker;
    readonly fetchImpl?: typeof fetch;
  },
  input: {
    readonly projectId: string;
    readonly repoId: string;
    readonly tokenOverride?: string;
  },
): Promise<SyncGitHubRepoResult> {
  const rows = await deps.db
    .select({ repo: projectRepos, project: projects })
    .from(projectRepos)
    .innerJoin(projects, eq(projectRepos.projectId, projects.id))
    .where(and(eq(projectRepos.id, input.repoId), eq(projectRepos.projectId, input.projectId)))
    .limit(1);

  const found = rows[0];
  if (!found) {
    throw new Error("Repository not found in this project.");
  }
  if (found.repo.forgeKind !== "github") {
    throw new Error(`Sync currently supports github repositories (got '${found.repo.forgeKind}').`);
  }

  const repoFullName = found.repo.repoFullName;
  const policy: RepoPolicy = found.repo.repoPolicy?.branches?.length
    ? found.repo.repoPolicy
    : DEFAULT_REPO_POLICY;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = input.tokenOverride?.trim() || deps.config.githubSyncToken;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "u3code-hub",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const pullsRes = await fetchImpl(
    `https://api.github.com/repos/${repoFullName}/pulls?state=open&per_page=30`,
    { headers },
  );
  if (!pullsRes.ok) {
    throw new Error(
      `GitHub API returned HTTP ${pullsRes.status} for ${repoFullName}. Configure GITHUB_SYNC_TOKEN for private repositories.`,
    );
  }

  const pulls = (await pullsRes.json()) as GitHubPullSummary[];
  const nowIso = new Date().toISOString();
  const maxLines = policy.maxPrChangedLines ?? 500;
  let syncedCount = 0;
  let linkedCount = 0;

  for (const pr of pulls) {
    const headBranch = pr.head?.ref ?? "";
    const headSha = pr.head?.sha ?? "";
    const baseBranch = pr.base?.ref ?? "main";
    const baseBranchRole = resolveBranchRole(policy, baseBranch);
    const authorVcsLogin = pr.user?.login ?? "unknown";
    const state = pr.draft ? "draft" : "open";
    const additions = Number(pr.additions ?? 0);
    const deletions = Number(pr.deletions ?? 0);
    const isOversized = additions + deletions > maxLines;

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

    let workItemId = existing?.workItemId ?? null;
    if (!workItemId) {
      const code = extractWorkItemCode({ title: pr.title, body: pr.body, headBranch });
      if (code) {
        const matched = await deps.db
          .select({ id: workItems.id })
          .from(workItems)
          .where(and(eq(workItems.projectId, found.project.id), eq(workItems.code, code)))
          .limit(1);
        workItemId = matched[0]?.id ?? null;
      }
    }
    if (workItemId) linkedCount += 1;

    // Pull latest reviews so bot blockers and human approvals are visible immediately on Day 1.
    let reviews: GitHubPullReview[] = [];
    try {
      const revRes = await fetchImpl(
        `https://api.github.com/repos/${repoFullName}/pulls/${pr.number}/reviews?per_page=30`,
        { headers },
      );
      if (revRes.ok) {
        reviews = (await revRes.json()) as GitHubPullReview[];
      }
    } catch {
      // Non-fatal: continue syncing PR metadata even if reviews endpoint fails.
    }

    const latestByBot = new Map<string, AutomatedReviewFinding>();
    let humanReviewState: "pending" | "approved" | "changes_requested" = "pending";

    for (const review of reviews) {
      const login = review.user?.login ?? "";
      if (!login) continue;
      const reviewState = review.state.toUpperCase();
      const botMatch = matchAutomatedReviewer(policy, login);
      if (botMatch) {
        const bodyText = review.body ?? "";
        latestByBot.set(botMatch.name, {
          reviewerName: botMatch.name,
          state: reviewState,
          riskLevel: inferRiskLevel(bodyText),
          bodyExcerpt: bodyText.slice(0, 240),
          ...(review.html_url ? { url: review.html_url } : {}),
          updatedAt: review.submitted_at ?? nowIso,
        });
      } else if (reviewState === "APPROVED") {
        humanReviewState = "approved";
      } else if (reviewState === "CHANGES_REQUESTED") {
        humanReviewState = "changes_requested";
      }
    }

    const findings = [...latestByBot.values()];
    const blockingCount = findings.filter((f) => {
      const rule = policy.automatedReviewers.find((r) => r.name === f.reviewerName);
      return rule ? rule.blockingStates.includes(f.state) : f.state === "CHANGES_REQUESTED";
    }).length;

    const automatedReview: AutomatedReviewSummary = {
      status:
        blockingCount > 0
          ? "blocking"
          : findings.length > 0
            ? "pass"
            : policy.automatedReviewers.length > 0
              ? "pending"
              : "skipped",
      blockingCount,
      reviewers: findings,
    };

    const qualitySignals: QualitySignalsSnapshot = existing?.qualitySignals ?? {
      ciStatus: "pending",
      signals: {},
    };

    const triageBucket = computeTriageBucket({
      state,
      baseBranchRole,
      workItemId,
      automatedReview,
      qualitySignals,
      humanReviewState,
    });

    if (existing) {
      await deps.db
        .update(changeRequests)
        .set({
          workItemId,
          title: pr.title,
          url: pr.html_url,
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
          updatedAt: nowIso,
        })
        .where(eq(changeRequests.id, existing.id));
    } else {
      await deps.db.insert(changeRequests).values({
        id: newId("cr"),
        forgeKind: "github",
        repoFullName,
        number: pr.number,
        workItemId,
        title: pr.title,
        url: pr.html_url,
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
        mergedAt: null,
        updatedAt: nowIso,
      });
    }

    deps.broker.broadcast({
      type: "change_request.updated",
      workspaceId: found.project.workspaceId,
      projectId: found.project.id,
      repoFullName,
      number: pr.number,
      triageBucket,
      blockingCount,
    });

    syncedCount += 1;
  }

  return {
    repoFullName,
    syncedCount,
    openCount: pulls.length,
    linkedCount,
  };
}
