import type { CockpitWorkItemCard, ProjectRepo } from "@u3code/hub-contracts";

const SECTION_ORDER: ReadonlyArray<{ readonly type: string; readonly heading: string }> = [
  { type: "feature", heading: "### Features" },
  { type: "bug", heading: "### Bug Fixes" },
  { type: "security", heading: "### Security" },
  { type: "refactor", heading: "### Refactors" },
  { type: "chore", heading: "### Chores" },
];

export function buildReleaseDraftFromWorkItems(input: {
  readonly selectedCards: ReadonlyArray<CockpitWorkItemCard>;
  readonly repos: ReadonlyArray<ProjectRepo>;
}): {
  readonly snapshotsText: string;
  readonly releaseNotesMd: string;
} {
  const { selectedCards, repos } = input;
  const snapshotByRepo = new Map<string, string>();

  for (const card of selectedCards) {
    for (const cr of card.changeRequests) {
      const existing = snapshotByRepo.get(cr.repoFullName);
      const shortSha = cr.headSha.slice(0, 7);
      const refLabel = shortSha ? `${cr.baseBranch}@${shortSha}` : cr.baseBranch;
      if (!existing || cr.state === "merged") {
        snapshotByRepo.set(cr.repoFullName, refLabel);
      }
    }
  }

  for (const repo of repos) {
    if (snapshotByRepo.has(repo.repoFullName)) continue;
    const releaseBranch =
      repo.repoPolicy.branches.find((b) => b.role === "release")?.name ??
      repo.repoPolicy.branches[0]?.name ??
      "main";
    snapshotByRepo.set(repo.repoFullName, releaseBranch);
  }

  const snapshotsText = [...snapshotByRepo.entries()]
    .map(([repoName, ref]) => `${repoName}=${ref}`)
    .join("\n");

  const sections: string[] = [];
  for (const section of SECTION_ORDER) {
    const group = selectedCards.filter((c) => c.workItem.itemType === section.type);
    if (group.length === 0) continue;
    const rows = group.map((card) => {
      const prRefs = card.changeRequests
        .map((cr) => `${cr.repoFullName.split("/").at(-1)}#${cr.number}`)
        .join(", ");
      const acTag =
        card.checklistTotalCount > 0
          ? ` [AC ${card.checklistVerifiedCount}/${card.checklistTotalCount}]`
          : "";
      const prTag = prRefs ? ` (${prRefs})` : "";
      return `- **${card.workItem.code}** ${card.workItem.title}${prTag}${acTag}`;
    });
    sections.push(`${section.heading}\n${rows.join("\n")}`);
  }

  return {
    snapshotsText,
    releaseNotesMd: sections.join("\n\n"),
  };
}
