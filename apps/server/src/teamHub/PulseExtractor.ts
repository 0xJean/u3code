import type { PulseDraft } from "@u3code/hub-contracts";
import type { TeamHubExtractPulseDraftInput } from "@t3tools/contracts";

const WORK_ITEM_CODE_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;

export function extractWorkItemCodeFromThread(input: {
  readonly threadTitle: string;
  readonly branchName?: string | null | undefined;
}): string | null {
  const fromTitle = WORK_ITEM_CODE_RE.exec(input.threadTitle);
  if (fromTitle?.[1]) return fromTitle[1].toUpperCase();
  if (input.branchName) {
    const fromBranch = /(?:^|\/)([A-Z][A-Z0-9]{1,9}-\d+)(?:[-_/]|$)/i.exec(input.branchName);
    if (fromBranch?.[1]) return fromBranch[1].toUpperCase();
  }
  return null;
}

export function buildPulseDraftFromThread(input: TeamHubExtractPulseDraftInput): PulseDraft {
  const workItemCode = extractWorkItemCodeFromThread({
    threadTitle: input.threadTitle,
    branchName: input.branchName,
  });

  const excerpts = (input.recentExcerpts ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const decisions: string[] = [];
  const blockers: Array<{ text: string; needsAttentionRoles?: string[] }> = [];
  const acIds = new Set<string>();

  for (const chunk of excerpts) {
    for (const acMatch of chunk.matchAll(/\b(AC-\d+)\b/gi)) {
      if (acMatch[1]) acIds.add(acMatch[1].toUpperCase());
    }
    for (const line of chunk.split("\n")) {
      const trimmed = line.replace(/^[-*•]\s*/, "").trim();
      if (trimmed.length < 6) continue;
      if (/(?:decision|decided|architecture|选用|决定|采用|方案)[:：\s]/i.test(trimmed)) {
        if (decisions.length < 5) decisions.push(trimmed.slice(0, 200));
      } else if (
        /(?:blocker|blocked|waiting on|need.*confirm|阻塞|卡点|待拍板|风险)[:：\s]/i.test(trimmed)
      ) {
        if (blockers.length < 5) {
          blockers.push({ text: trimmed.slice(0, 200), needsAttentionRoles: ["owner"] });
        }
      }
    }
  }

  const latestSummarySource = excerpts.at(-1) ?? input.threadTitle;
  const doneSummary =
    latestSummarySource.length > 260
      ? `${latestSummarySource.slice(0, 257)}...`
      : latestSummarySource || `Updated work on ${input.threadTitle}`;

  return {
    workItemId: null,
    workItemCode,
    health: blockers.length > 0 ? "blocked" : "on_track",
    doneSummary,
    decisions,
    blockers,
    nextStep: blockers.length > 0 ? "Resolve blocker(s) and continue implementation." : "",
    progressedAcIds: [...acIds],
  };
}
