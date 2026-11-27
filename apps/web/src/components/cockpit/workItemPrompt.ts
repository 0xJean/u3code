import type {
  ChangeRequestAudit,
  Project,
  ProjectMemory,
  ProjectRepo,
  WorkItem,
} from "@u3code/hub-contracts";

export interface LocalWorkspaceProjectLike {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export function findMatchingWorkspaceProject<T extends LocalWorkspaceProjectLike>(
  localProjects: ReadonlyArray<T>,
  hubRepos: ReadonlyArray<Pick<ProjectRepo, "repoFullName">>,
): T | null {
  if (localProjects.length === 0 || hubRepos.length === 0) return null;
  const repoNames = new Set(
    hubRepos
      .map((r) => r.repoFullName.split("/").at(-1)?.trim().toLowerCase() ?? "")
      .filter((name) => name.length > 0),
  );
  if (repoNames.size === 0) return null;
  return (
    localProjects.find((proj) => {
      const folderName = proj.workspaceRoot.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
      return repoNames.has(proj.title.trim().toLowerCase()) || repoNames.has(folderName);
    }) ?? null
  );
}

export function pickMatchingWorkspaceProject<T extends LocalWorkspaceProjectLike>(
  localProjects: ReadonlyArray<T>,
  hubRepos: ReadonlyArray<Pick<ProjectRepo, "repoFullName">>,
): T | null {
  if (localProjects.length === 0) return null;
  return findMatchingWorkspaceProject(localProjects, hubRepos) ?? localProjects[0] ?? null;
}

export function buildWorkItemThreadPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly changeRequests?: ReadonlyArray<ChangeRequestAudit> | undefined;
}): string {
  const { workItem, project, memory, changeRequests = [] } = input;
  const lines: string[] = [
    `Work Item: [${workItem.code}] ${workItem.title}`,
    `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, stage=${workItem.stage}, health=${workItem.health}, workItemId=${workItem.id}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }

  const trimmedSpec = workItem.specMarkdown.trim();
  if (trimmedSpec.length > 0) {
    lines.push("", "## Specification", trimmedSpec);
  }

  if (workItem.checklistItems.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const item of workItem.checklistItems) {
      lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
    }
  }

  const activeDirectives = (memory?.directives ?? []).filter((d) => d.active);
  if (activeDirectives.length > 0) {
    lines.push("", "## Locked Project Directives");
    for (const directive of activeDirectives) {
      lines.push(`- ${directive.text}`);
    }
  }

  if (changeRequests.length > 0) {
    lines.push("", "## Linked Pull Requests");
    for (const cr of changeRequests) {
      lines.push(`- ${cr.repoFullName}#${cr.number} (${cr.state}): ${cr.title} (${cr.url})`);
    }
  }

  lines.push(
    "",
    "## Team Hub Sync",
    `Please implement or investigate [${workItem.code}] following the specification and acceptance criteria above. When ACs are verified or key decisions/blockers emerge, update Team Hub via \`team_hub_update_work_item\` (workItemId: \`${workItem.id}\`) and \`team_hub_publish_pulse\`.`,
  );

  return lines.join("\n");
}

export function buildPullRequestActionPrompt(input: {
  readonly mode: "fix" | "review";
  readonly changeRequest: ChangeRequestAudit;
  readonly linkedWorkItem?: WorkItem | null | undefined;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
}): string {
  const { mode, changeRequest: cr, linkedWorkItem, project, memory } = input;
  const lines: string[] = [
    mode === "fix"
      ? `Fix Review & CI Blockers for PR ${cr.repoFullName}#${cr.number}: ${cr.title}`
      : `Review Pull Request ${cr.repoFullName}#${cr.number}: ${cr.title}`,
    `PR URL: ${cr.url}`,
    `Branches: ${cr.headBranch} -> ${cr.baseBranch} (${cr.baseBranchRole})`,
    `Author: @${cr.authorVcsLogin} | Diff: +${cr.additions}/-${cr.deletions} | CI: ${cr.qualitySignals.ciStatus}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }

  if (linkedWorkItem) {
    lines.push(
      `Linked Work Item: [${linkedWorkItem.code}] ${linkedWorkItem.title} (workItemId=${linkedWorkItem.id})`,
    );
    if (linkedWorkItem.specMarkdown.trim()) {
      lines.push("", "## Linked Specification", linkedWorkItem.specMarkdown.trim());
    }
    if (linkedWorkItem.checklistItems.length > 0) {
      lines.push("", "## Acceptance Criteria");
      for (const item of linkedWorkItem.checklistItems) {
        lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
      }
    }
  }

  if (cr.automatedReview.reviewers.length > 0) {
    lines.push("", "## Automated Reviewer Findings");
    for (const finding of cr.automatedReview.reviewers) {
      lines.push(`- ${finding.reviewerName} [${finding.state}]: ${finding.bodyExcerpt}`);
    }
  }

  const activeDirectives = (memory?.directives ?? []).filter((d) => d.active);
  if (activeDirectives.length > 0) {
    lines.push("", "## Locked Project Directives");
    for (const directive of activeDirectives) {
      lines.push(`- ${directive.text}`);
    }
  }

  lines.push(
    "",
    "## Instructions",
    mode === "fix"
      ? `Inspect branch \`${cr.headBranch}\`, reproduce and resolve every blocking automated review comment or CI issue above, verify with tests, and summarize the fix. If a linked WorkItem exists, publish a short pulse via \`team_hub_publish_pulse\`.`
      : `Inspect PR #${cr.number} (\`${cr.headBranch}\` -> \`${cr.baseBranch}\`), review correctness, edge cases, adherence to the locked project directives, and acceptance criteria, then provide concise actionable review feedback.`,
  );

  return lines.join("\n");
}
