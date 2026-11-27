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

export function pickMatchingWorkspaceProject<T extends LocalWorkspaceProjectLike>(
  localProjects: ReadonlyArray<T>,
  hubRepos: ReadonlyArray<ProjectRepo>,
): T | null {
  if (localProjects.length === 0) return null;
  const repoNames = new Set(
    hubRepos
      .map((r) => r.repoFullName.split("/").at(-1)?.trim().toLowerCase() ?? "")
      .filter((name) => name.length > 0),
  );
  if (repoNames.size > 0) {
    const matched = localProjects.find((proj) => {
      const folderName = proj.workspaceRoot.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
      return repoNames.has(proj.title.trim().toLowerCase()) || repoNames.has(folderName);
    });
    if (matched) return matched;
  }
  return localProjects[0] ?? null;
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
