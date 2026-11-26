import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type {
  ArchitectureDecision,
  DigestTriggerType,
  ModuleProgressEntry,
  ProjectDirective,
  RecurringRisk,
} from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import {
  changeRequests,
  cockpitDigests,
  projectMemories,
  projectRepos,
  projects,
  pulses,
  workItems,
} from "../db/schema.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import { newId } from "../utils/crypto.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

export interface MemoryPatch {
  readonly newDecisions?: readonly ArchitectureDecision[];
  readonly moduleUpdates?: readonly ModuleProgressEntry[];
  readonly riskSignals?: ReadonlyArray<{
    readonly title: string;
    readonly severity: "low" | "medium" | "high";
    readonly mitigation?: string;
  }>;
}

export interface DigestSynthesisResult {
  readonly markdownBody: string;
  readonly structuredJson: Record<string, unknown>;
  readonly memoryPatch: MemoryPatch;
}

export type DigestSynthesizer = (input: {
  readonly projectName: string;
  readonly directives: readonly ProjectDirective[];
  readonly existingDecisions: readonly ArchitectureDecision[];
  readonly recentPulses: ReadonlyArray<typeof pulses.$inferSelect>;
  readonly openChangeRequests: ReadonlyArray<typeof changeRequests.$inferSelect>;
  readonly mergedChangeRequests: ReadonlyArray<typeof changeRequests.$inferSelect>;
  readonly activeWorkItems: ReadonlyArray<typeof workItems.$inferSelect>;
}) => Promise<DigestSynthesisResult>;

export function applyMemoryPatch(
  existing: {
    readonly architectureDecisions: readonly ArchitectureDecision[];
    readonly moduleMap: readonly ModuleProgressEntry[];
    readonly recurringRisks: readonly RecurringRisk[];
    readonly directives: readonly ProjectDirective[];
  },
  patch: MemoryPatch,
): {
  readonly architectureDecisions: ArchitectureDecision[];
  readonly moduleMap: ModuleProgressEntry[];
  readonly recurringRisks: RecurringRisk[];
  readonly directives: ProjectDirective[];
} {
  const decisions = [...existing.architectureDecisions];
  const seenSummaries = new Set(decisions.map((d) => d.summary.trim().toLowerCase()));
  for (const dec of patch.newDecisions ?? []) {
    const key = dec.summary.trim().toLowerCase();
    if (!key || seenSummaries.has(key)) continue;
    seenSummaries.add(key);
    decisions.push(dec);
  }

  const moduleMap = [...existing.moduleMap];
  for (const update of patch.moduleUpdates ?? []) {
    const idx = moduleMap.findIndex(
      (m) =>
        m.name.toLowerCase() === update.name.toLowerCase() &&
        (m.repoFullName ?? "") === (update.repoFullName ?? ""),
    );
    if (idx >= 0) {
      moduleMap[idx] = update;
    } else {
      moduleMap.push(update);
    }
  }

  const recurringRisks = existing.recurringRisks.map((r) => ({ ...r }));
  for (const sig of patch.riskSignals ?? []) {
    const idx = recurringRisks.findIndex(
      (r) => r.title.toLowerCase() === sig.title.trim().toLowerCase(),
    );
    if (idx >= 0) {
      const current = recurringRisks[idx]!;
      recurringRisks[idx] = {
        ...current,
        occurrences: current.occurrences + 1,
        severity: sig.severity === "high" ? "high" : current.severity,
        active: true,
        mitigation: sig.mitigation || current.mitigation,
      };
    } else {
      recurringRisks.push({
        id: newId("rsk"),
        title: sig.title.trim(),
        severity: sig.severity,
        occurrences: 1,
        mitigation: sig.mitigation ?? "Capture in team AGENTS.md / review rules.",
        active: true,
      });
    }
  }

  return {
    architectureDecisions: decisions,
    moduleMap,
    recurringRisks,
    // Directives are human-locked project constraints; automated patches never mutate or erase them.
    directives: [...existing.directives],
  };
}

export function synthesizeDeterministicDigest(
  input: Parameters<DigestSynthesizer>[0],
): DigestSynthesisResult {
  const today = new Date().toISOString().slice(0, 10);
  const blockers: Array<{ code: string; text: string }> = [];
  const newDecisions: ArchitectureDecision[] = [];
  const workItemById = new Map(input.activeWorkItems.map((wi) => [wi.id, wi]));

  for (const p of input.recentPulses) {
    const code = workItemById.get(p.workItemId)?.code ?? p.workItemId;
    for (const b of p.blockers) {
      blockers.push({ code, text: b.text });
    }
    for (const d of p.decisions) {
      newDecisions.push({
        id: newId("adr"),
        date: today,
        repoFullName: p.repoFullName,
        summary: d,
        rationale: p.doneSummary,
        sourceRef: p.sourceThreadId ?? p.id,
      });
    }
  }

  const botBlockedCrs = input.openChangeRequests.filter((cr) => cr.triageBucket === "bot_blocked");
  const readyForReviewCrs = input.openChangeRequests.filter(
    (cr) => cr.triageBucket === "ready_for_human_review",
  );
  const orphanCrs = input.openChangeRequests.filter((cr) => cr.triageBucket === "orphan");

  const riskSignals: Array<{ title: string; severity: "low" | "medium" | "high" }> = [];
  for (const cr of botBlockedCrs) {
    for (const rev of cr.automatedReview.reviewers) {
      if (rev.state === "CHANGES_REQUESTED") {
        riskSignals.push({
          title: `${rev.reviewerName} block on ${cr.repoFullName}: ${rev.bodyExcerpt.slice(0, 80) || cr.title}`,
          severity: rev.riskLevel === "high" ? "high" : "medium",
        });
      }
    }
  }

  const activeDirectives = input.directives.filter((d) => d.active);
  const lines: string[] = [
    `# ${input.projectName} — Cockpit Digest (${today})`,
    "",
    "## 1. Needs Attention & Blockers",
  ];

  if (blockers.length === 0 && botBlockedCrs.length === 0) {
    lines.push("- No active blockers or automated review blocks.");
  } else {
    for (const b of blockers.slice(0, 8)) {
      lines.push(`- **[${b.code}]** ${b.text}`);
    }
    for (const cr of botBlockedCrs) {
      lines.push(
        `- **[PR #${cr.number} · ${cr.repoFullName}]** Blocked by automated reviewer (${cr.automatedReview.blockingCount} finding(s)) — ${cr.title}`,
      );
    }
  }

  lines.push("", "## 2. Delivery & PR Triage Snapshot");
  lines.push(`- Active work items: **${input.activeWorkItems.length}**`);
  lines.push(`- Ready for human review: **${readyForReviewCrs.length}**`);
  lines.push(`- Automated review blocked: **${botBlockedCrs.length}**`);
  lines.push(`- Merged in period: **${input.mergedChangeRequests.length}**`);
  if (orphanCrs.length > 0) {
    lines.push(`- ⚠️ Unlinked (orphan) PRs: **${orphanCrs.length}**`);
  }

  if (newDecisions.length > 0) {
    lines.push("", "## 3. New Architecture & Product Decisions");
    for (const dec of newDecisions) {
      lines.push(`- **${dec.summary}** (${dec.repoFullName ?? "workspace"})`);
    }
  }

  if (activeDirectives.length > 0) {
    lines.push("", "## 4. Active Project Directives");
    for (const dir of activeDirectives) {
      lines.push(`- 🔒 ${dir.text}`);
    }
  }

  return {
    markdownBody: lines.join("\n"),
    structuredJson: {
      blockerCount: blockers.length,
      botBlockedCount: botBlockedCrs.length,
      readyForReviewCount: readyForReviewCrs.length,
      mergedCount: input.mergedChangeRequests.length,
      orphanCount: orphanCrs.length,
      newDecisionCount: newDecisions.length,
      topBlockers: blockers.slice(0, 5),
    },
    memoryPatch: {
      newDecisions,
      riskSignals,
    },
  };
}

export function createOpenAiCompatibleSynthesizer(
  config: HubConfig,
  fetchImpl: typeof fetch = fetch,
): DigestSynthesizer {
  return async (input) => {
    const fallback = synthesizeDeterministicDigest(input);
    if (!config.llmApiKey) {
      return fallback;
    }

    const promptPayload = {
      projectName: input.projectName,
      directives: input.directives.filter((d) => d.active).map((d) => d.text),
      existingDecisions: input.existingDecisions.slice(-15).map((d) => d.summary),
      recentPulses: input.recentPulses.slice(0, 30).map((p) => ({
        sourceType: p.sourceType,
        repo: p.repoFullName,
        stage: p.stageAtTime,
        health: p.health,
        doneSummary: p.doneSummary,
        decisions: p.decisions,
        blockers: p.blockers,
        nextStep: p.nextStep,
      })),
      openPrs: input.openChangeRequests.slice(0, 25).map((cr) => ({
        repo: cr.repoFullName,
        number: cr.number,
        title: cr.title,
        baseBranch: cr.baseBranch,
        triageBucket: cr.triageBucket,
        automatedReview: cr.automatedReview,
        qualitySignals: cr.qualitySignals,
      })),
      mergedPrs: input.mergedChangeRequests.slice(0, 25).map((cr) => ({
        repo: cr.repoFullName,
        number: cr.number,
        title: cr.title,
        baseBranch: cr.baseBranch,
      })),
    };

    try {
      const res = await fetchImpl(`${config.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.llmApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.llmModel,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are an engineering cockpit synthesizer. Return JSON with keys: markdownBody (concise executive markdown digest highlighting top blockers, decisions, PR triage, and directive compliance), structuredJson (object with topBlockers array and summary string), and newDecisions (array of {summary, rationale, repoFullName}). Never invent PRs or metrics not present in the input.",
            },
            {
              role: "user",
              content: JSON.stringify(promptPayload),
            },
          ],
        }),
      });

      if (!res.ok) {
        return fallback;
      }

      const data = (await res.json()) as {
        readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) return fallback;

      const parsed = JSON.parse(raw) as {
        readonly markdownBody?: string;
        readonly structuredJson?: Record<string, unknown>;
        readonly newDecisions?: ReadonlyArray<{
          readonly summary: string;
          readonly rationale?: string;
          readonly repoFullName?: string | null;
        }>;
      };

      const today = new Date().toISOString().slice(0, 10);
      const llmDecisions: ArchitectureDecision[] = (parsed.newDecisions ?? [])
        .filter((d) => typeof d.summary === "string" && d.summary.trim().length > 0)
        .map((d) => ({
          id: newId("adr"),
          date: today,
          repoFullName: d.repoFullName ?? null,
          summary: d.summary.trim(),
          rationale: d.rationale?.trim() ?? "",
          sourceRef: "digest",
        }));

      return {
        markdownBody: parsed.markdownBody?.trim() || fallback.markdownBody,
        structuredJson: {
          ...fallback.structuredJson,
          ...parsed.structuredJson,
          synthesizedBy: config.llmModel,
        },
        memoryPatch: {
          newDecisions: [...(fallback.memoryPatch.newDecisions ?? []), ...llmDecisions],
          ...(fallback.memoryPatch.riskSignals
            ? { riskSignals: fallback.memoryPatch.riskSignals }
            : {}),
        },
      };
    } catch {
      return fallback;
    }
  };
}

export async function generateAndPersistDigest(
  deps: {
    readonly db: HubDatabase;
    readonly config: HubConfig;
    readonly broker: HubSocketBroker;
    readonly notifier: NotificationDispatcher;
    readonly synthesizer?: DigestSynthesizer;
  },
  input: {
    readonly workspaceId: string;
    readonly projectId: string | null;
    readonly triggerType: DigestTriggerType;
    readonly periodHours?: number;
    readonly actorUserId?: string | null;
  },
): Promise<{
  readonly digest: typeof cockpitDigests.$inferSelect;
  readonly updatedMemory: typeof projectMemories.$inferSelect | null;
}> {
  const periodEnd = new Date();
  const periodHours = input.periodHours ?? 24;
  const periodStart = new Date(periodEnd.getTime() - periodHours * 3600 * 1000);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();

  const workspaceProjects = await deps.db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, input.workspaceId));

  const targetProject = input.projectId
    ? (workspaceProjects.find((p) => p.id === input.projectId) ?? null)
    : null;
  const scopedProjectIds = targetProject ? [targetProject.id] : workspaceProjects.map((p) => p.id);

  const activeWorkItems =
    scopedProjectIds.length > 0
      ? await deps.db.select().from(workItems).where(inArray(workItems.projectId, scopedProjectIds))
      : [];
  const itemIds = activeWorkItems.map((i) => i.id);

  const recentPulses =
    itemIds.length > 0
      ? await deps.db
          .select()
          .from(pulses)
          .where(and(inArray(pulses.workItemId, itemIds), gte(pulses.createdAt, periodStartIso)))
          .orderBy(desc(pulses.createdAt))
      : [];

  const repos =
    scopedProjectIds.length > 0
      ? await deps.db
          .select()
          .from(projectRepos)
          .where(inArray(projectRepos.projectId, scopedProjectIds))
      : [];
  const repoNames = repos.map((r) => r.repoFullName);

  const allCrs =
    repoNames.length > 0
      ? await deps.db
          .select()
          .from(changeRequests)
          .where(inArray(changeRequests.repoFullName, repoNames))
      : [];

  const openChangeRequests = allCrs.filter((cr) => cr.state === "open");
  const mergedChangeRequests = allCrs.filter(
    (cr) => cr.state === "merged" && cr.mergedAt !== null && cr.mergedAt >= periodStartIso,
  );

  let existingMemory: typeof projectMemories.$inferSelect | null = null;
  if (targetProject) {
    const memRows = await deps.db
      .select()
      .from(projectMemories)
      .where(eq(projectMemories.projectId, targetProject.id))
      .limit(1);
    existingMemory = memRows[0] ?? null;
  }

  const synthesizer = deps.synthesizer ?? createOpenAiCompatibleSynthesizer(deps.config);
  const synthesis = await synthesizer({
    projectName: targetProject
      ? `${targetProject.name} (${targetProject.key})`
      : "Workspace Overview",
    directives: existingMemory?.directives ?? [],
    existingDecisions: existingMemory?.architectureDecisions ?? [],
    recentPulses,
    openChangeRequests,
    mergedChangeRequests,
    activeWorkItems: activeWorkItems.filter((i) => i.stage !== "done" && i.stage !== "cancelled"),
  });

  let updatedMemory: typeof projectMemories.$inferSelect | null = null;
  if (targetProject) {
    const patched = applyMemoryPatch(
      existingMemory ?? {
        architectureDecisions: [],
        moduleMap: [],
        recurringRisks: [],
        directives: [],
      },
      synthesis.memoryPatch,
    );

    if (existingMemory) {
      const updated = await deps.db
        .update(projectMemories)
        .set({
          architectureDecisions: patched.architectureDecisions,
          moduleMap: patched.moduleMap,
          recurringRisks: patched.recurringRisks,
          version: existingMemory.version + 1,
          updatedBy: input.actorUserId ?? existingMemory.updatedBy,
          updatedAt: periodEndIso,
        })
        .where(eq(projectMemories.id, existingMemory.id))
        .returning();
      updatedMemory = updated[0] ?? null;
    } else {
      const inserted = await deps.db
        .insert(projectMemories)
        .values({
          id: newId("mem"),
          projectId: targetProject.id,
          architectureDecisions: patched.architectureDecisions,
          moduleMap: patched.moduleMap,
          recurringRisks: patched.recurringRisks,
          directives: patched.directives,
          updatedBy: input.actorUserId ?? null,
          updatedAt: periodEndIso,
        })
        .returning();
      updatedMemory = inserted[0] ?? null;
    }
  }

  const digestId = newId("dig");
  const insertedDigests = await deps.db
    .insert(cockpitDigests)
    .values({
      id: digestId,
      workspaceId: input.workspaceId,
      projectId: targetProject?.id ?? null,
      triggerType: input.triggerType,
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      markdownBody: synthesis.markdownBody,
      structuredJson: synthesis.structuredJson,
    })
    .returning();
  const digest = insertedDigests[0]!;

  deps.broker.broadcast({
    type: "digest.created",
    workspaceId: input.workspaceId,
    projectId: targetProject?.id ?? null,
    digestId,
  });

  const topBlockers = (synthesis.structuredJson.topBlockers ?? []) as Array<{
    code: string;
    text: string;
  }>;
  await deps.notifier.dispatch(input.workspaceId, targetProject?.id ?? null, {
    event: "digest.ready",
    title: `Cockpit Digest — ${targetProject ? targetProject.name : "All Projects"}`,
    severity:
      Number(synthesis.structuredJson.botBlockedCount ?? 0) > 0 || topBlockers.length > 0
        ? "warning"
        : "info",
    summary: `Active: ${activeWorkItems.length} | Ready for Review: ${String(synthesis.structuredJson.readyForReviewCount ?? 0)} | Bot Blocked: ${String(synthesis.structuredJson.botBlockedCount ?? 0)} | Merged: ${String(synthesis.structuredJson.mergedCount ?? 0)}`,
    bullets:
      topBlockers.length > 0
        ? topBlockers.map((b) => `[${b.code}] ${b.text}`)
        : ["No active blockers reported in this window."],
  });

  return { digest, updatedMemory };
}
