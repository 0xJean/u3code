import {
  readWorkItemLifecycle,
  recommendPrMergeStrategy,
  standardGitHubLabels,
  suggestWorkItemBranchName,
  type BranchTopology,
  type ChangeRequestAudit,
  type Project,
  type ProjectMemory,
  type ProjectRepo,
  type WorkItem,
} from "@u3code/hub-contracts";

export interface LocalWorkspaceProjectLike {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export type PullRequestActionMode = "fix" | "review" | "audit_and_comment";

const PR_LINE_BUDGET = 400;

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

function appendActiveDirectives(lines: string[], memory?: ProjectMemory | null): void {
  const activeDirectives = (memory?.directives ?? []).filter((d) => d.active);
  if (activeDirectives.length > 0) {
    lines.push("", "## Locked Project Directives");
    for (const directive of activeDirectives) {
      lines.push(`- ${directive.text}`);
    }
  }
}

function resolveDefaultBaseBranch(workItem: WorkItem, topology: BranchTopology): string {
  if (topology === "single_trunk") {
    return "main";
  }
  if (
    workItem.priority === "p0" &&
    (workItem.itemType === "bug" || workItem.itemType === "security")
  ) {
    return "main";
  }
  return "dev";
}

function buildBranchCutCommand(baseBranch: string, branchName: string): string {
  return `git fetch origin ${baseBranch} && git switch --no-track -c ${branchName} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')"`;
}

function mergeUniqueLabels(
  primary: ReadonlyArray<string>,
  secondary: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const label of [...primary, ...secondary]) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

export function buildWorkItemThreadPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly changeRequests?: ReadonlyArray<ChangeRequestAudit> | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly topology?: BranchTopology | undefined;
}): string {
  const { workItem, project, memory, changeRequests = [], repoFullName, topology } = input;
  const lifecycle = readWorkItemLifecycle(workItem);
  const resolvedTopology: BranchTopology = topology ?? lifecycle.branchTopology;
  const suggestedBranch =
    lifecycle.branchName ??
    suggestWorkItemBranchName({
      itemType: workItem.itemType,
      priority: workItem.priority,
      code: workItem.code,
      title: workItem.title,
      githubIssueNumber: lifecycle.githubIssueNumber,
    });
  const baseBranch = lifecycle.targetBranch ?? resolveDefaultBaseBranch(workItem, resolvedTopology);
  const branchCommand = buildBranchCutCommand(baseBranch, suggestedBranch);
  const labels = mergeUniqueLabels(
    standardGitHubLabels(workItem.itemType, workItem.priority),
    lifecycle.githubLabels,
  );
  const previewLinks = mergeUniqueLabels(
    lifecycle.prototypeUrl ? [lifecycle.prototypeUrl] : [],
    workItem.previewUrls,
  );

  const lines: string[] = [
    `Work Item: [${workItem.code}] ${workItem.title}`,
    `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, stage=${workItem.stage}, health=${workItem.health}, designTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }

  if (repoFullName) {
    lines.push(`Repository: ${repoFullName}`);
  }

  if (lifecycle.plannedStartAt || lifecycle.dueAt) {
    lines.push(
      `Schedule: start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`,
    );
  }

  if (lifecycle.githubIssueNumber !== null || lifecycle.githubIssueUrl) {
    const issueTag =
      lifecycle.githubIssueNumber !== null ? `#${lifecycle.githubIssueNumber}` : "Linked Issue";
    const issueSuffix = lifecycle.githubIssueUrl ? ` (${lifecycle.githubIssueUrl})` : "";
    lines.push(`Linked GitHub Issue: ${issueTag}${issueSuffix}`);
  }

  const trimmedSpec = workItem.specMarkdown.trim();
  if (trimmedSpec.length > 0) {
    lines.push("", "## Specification", trimmedSpec);
  }

  if (previewLinks.length > 0) {
    lines.push("", "## Prototype & Preview Links");
    for (const url of previewLinks) {
      lines.push(`- ${url}`);
    }
  }

  if (workItem.checklistItems.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const item of workItem.checklistItems) {
      lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
    }
  }

  appendActiveDirectives(lines, memory);

  if (changeRequests.length > 0) {
    lines.push("", "## Linked Pull Requests");
    for (const cr of changeRequests) {
      lines.push(`- ${cr.repoFullName}#${cr.number} (${cr.state}): ${cr.title} (${cr.url})`);
    }
  }

  const issueLinkHint =
    lifecycle.githubIssueNumber !== null
      ? `Link the PR to Issue #${lifecycle.githubIssueNumber} using \`Closes #${lifecycle.githubIssueNumber}\` (or \`Refs #${lifecycle.githubIssueNumber}\` for intermediate PRs in a multi-PR series).`
      : "Reference the linked GitHub Issue in the PR body using `Closes #<num>` (or `Refs #<num>` for multi-PR features).";

  lines.push(
    "",
    "## GitHub Team Workflow Guardrails",
    `- Branch topology: \`${resolvedTopology}\` (target base: \`${baseBranch}\`).`,
    `- Cut the branch from fresh origin ref using:\n  \`${branchCommand}\``,
    `- Keep PR diffs focused and <= ${PR_LINE_BUDGET} changed lines; split larger changes into incremental PRs.`,
    "- Follow Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `chore(scope): ...`).",
    `- ${issueLinkHint}`,
    `- Standard PR labels: ${labels.map((label) => `\`${label}\``).join(", ")}.`,
    `- Merge strategy: Squash merge task branches into \`${baseBranch}\` (never squash \`main -> dev\` or \`release/* -> main\`).`,
    "",
    "## Team Hub Sync",
    `Please implement or investigate [${workItem.code}] following the specification and acceptance criteria above. Persist progress and verified ACs via \`team_hub_update_work_item\` (workItemId: \`${workItem.id}\`), publish concise progress pulses via \`team_hub_publish_pulse\`, and post PR handoffs or blockers on the Team Board via \`hub_board_post\`.`,
  );

  return lines.join("\n");
}

export function buildPrdGenerationPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repoFullName?: string | null | undefined;
}): string {
  const { workItem, project, memory, repoFullName } = input;
  const lifecycle = readWorkItemLifecycle(workItem);
  const lines: string[] = [
    `Draft AI PRD & Technical Design Classification for [${workItem.code}] ${workItem.title}`,
    `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, stage=${workItem.stage}, currentDesignTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }
  if (repoFullName) {
    lines.push(`Repository: ${repoFullName}`);
  }
  if (lifecycle.plannedStartAt || lifecycle.dueAt) {
    lines.push(
      `Target Schedule: start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`,
    );
  }

  const existingBrief = workItem.specMarkdown.trim();
  if (existingBrief.length > 0) {
    lines.push("", "## Existing Requirement Brief", existingBrief);
  }

  if (workItem.checklistItems.length > 0) {
    lines.push("", "## Existing Acceptance Criteria");
    for (const item of workItem.checklistItems) {
      lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
    }
  }

  appendActiveDirectives(lines, memory);

  if ((memory?.architectureDecisions.length ?? 0) > 0) {
    lines.push("", "## Relevant Architecture Decisions");
    for (const decision of memory?.architectureDecisions.slice(0, 5) ?? []) {
      const rationaleSuffix = decision.rationale.trim() ? ` (${decision.rationale.trim()})` : "";
      lines.push(`- ${decision.summary}${rationaleSuffix}`);
    }
  }

  const activeRisks = (memory?.recurringRisks ?? []).filter((risk) => risk.active);
  if (activeRisks.length > 0) {
    lines.push("", "## Recurring Project Risks");
    for (const risk of activeRisks.slice(0, 5)) {
      lines.push(`- [${risk.severity}] ${risk.title} (mitigation: ${risk.mitigation})`);
    }
  }

  lines.push(
    "",
    "## Deliverable",
    "1. Produce a clear, concise Product Requirements Document (PRD) in Markdown covering: Problem & Goal, User Stories & Scope, Non-Goals, UX & Edge Cases, Data / API Impact, and Rollout / Rollback Notes.",
    "2. Author concrete, testable Acceptance Criteria items (`AC-1`, `AC-2`, ...) with `verified: false`.",
    "3. Classify the **Technical Design Tier** following `jean-skills/github-team-workflow` (`tech-design.md`):",
    "   - `small`: localized change (< 1 day), no schema or API contract change; PR description is enough.",
    "   - `medium`: single-repo multi-file feature; design notes live inside this PRD and the PR body.",
    "   - `large`: new subsystem, schema migration, or public API change; record a dedicated design doc path (`docs/design/...`) before implementation.",
    "   - `cross_repo`: spans multiple repositories or breaking contracts; require cross-repo contract freeze before coding.",
    "",
    "## Team Hub Sync",
    `- Save the PRD, AC checklist, and lifecycle attributes back to Team Hub using \`team_hub_update_work_item\` with \`workItemId: "${workItem.id}"\`, setting \`specMarkdown\`, \`checklistItems\`, and \`attributes: { prdStatus: "draft", designTier: "<small|medium|large|cross_repo>" }\` (include \`designDocPath\` for \`large\` or \`cross_repo\`).`,
    `- Announce the drafted PRD on the Team Board using \`hub_board_post\` referencing \`${workItem.code}\`, stating the chosen design tier and AC count so PM and engineering reviewers can sign off.`,
  );

  return lines.join("\n");
}

export function buildPrototypeGenerationPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repoFullName?: string | null | undefined;
}): string {
  const { workItem, project, memory, repoFullName } = input;
  const lifecycle = readWorkItemLifecycle(workItem);
  const lines: string[] = [
    `Build Interactive UI Prototype for [${workItem.code}] ${workItem.title}`,
    `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, designTier=${lifecycle.designTier}, prdStatus=${lifecycle.prdStatus}, workItemId=${workItem.id}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }
  if (repoFullName) {
    lines.push(`Repository: ${repoFullName}`);
  }
  if (lifecycle.prototypeUrl) {
    lines.push(`Current Prototype URL: ${lifecycle.prototypeUrl}`);
  }

  const trimmedSpec = workItem.specMarkdown.trim();
  if (trimmedSpec.length > 0) {
    lines.push("", "## PRD Specification", trimmedSpec);
  }

  if (workItem.checklistItems.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const item of workItem.checklistItems) {
      lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
    }
  }

  appendActiveDirectives(lines, memory);

  lines.push(
    "",
    "## Deliverable",
    "1. Design and build an interactive, clickable UI / HTML design prototype grounded in the PRD and acceptance criteria above.",
    "2. Cover primary user flows plus key interactive states (default populated view, empty state, loading/saving feedback, error handling, and responsive layout).",
    "3. Inspect the rendered prototype carefully to verify visual hierarchy, spacing, readability, and ergonomics before handing off.",
    "",
    "## Team Hub Sync",
    `- Record the prototype URL or preview path back in Team Hub using \`team_hub_update_work_item\` with \`workItemId: "${workItem.id}"\`, setting \`previewUrls\` and \`attributes: { prototypeStatus: "draft", prototypeUrl: "<previewUrlOrPath>" }\`.`,
    `- Post a concise \`@mention\` review handoff on the Team Board via \`hub_board_post\` referencing \`${workItem.code}\`, including the prototype preview URL/path and key interaction decisions for PM and design review.`,
  );

  return lines.join("\n");
}

export function buildIssueDispatchPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly assigneeHandle?: string | null | undefined;
  readonly assigneeDisplayName?: string | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
}): string {
  const { workItem, project, repoFullName, assigneeHandle, assigneeDisplayName, memory } = input;
  const lifecycle = readWorkItemLifecycle(workItem);
  const labels = mergeUniqueLabels(
    standardGitHubLabels(workItem.itemType, workItem.priority),
    lifecycle.githubLabels,
  );
  const cleanHandle = assigneeHandle?.trim().replace(/^@+/, "") || null;
  const suggestedBranch =
    lifecycle.branchName ??
    suggestWorkItemBranchName({
      itemType: workItem.itemType,
      priority: workItem.priority,
      code: workItem.code,
      title: workItem.title,
      githubIssueNumber: lifecycle.githubIssueNumber,
    });

  const lines: string[] = [
    `Submit & Dispatch GitHub Issue for [${workItem.code}] ${workItem.title}`,
    `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, designTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }
  if (repoFullName) {
    lines.push(`Target Repository: ${repoFullName}`);
  }
  if (cleanHandle) {
    const displaySuffix =
      assigneeDisplayName && assigneeDisplayName.trim() !== cleanHandle
        ? ` (${assigneeDisplayName.trim()})`
        : "";
    lines.push(`Assignee: @${cleanHandle}${displaySuffix}`);
  }
  if (lifecycle.plannedStartAt || lifecycle.dueAt) {
    lines.push(
      `Schedule: start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`,
    );
  }
  if (lifecycle.prototypeUrl) {
    lines.push(`Prototype URL: ${lifecycle.prototypeUrl}`);
  }
  if (lifecycle.githubIssueUrl) {
    lines.push(
      `Existing Linked Issue: ${lifecycle.githubIssueNumber !== null ? `#${lifecycle.githubIssueNumber} ` : ""}${lifecycle.githubIssueUrl}`,
    );
  }

  const trimmedSpec = workItem.specMarkdown.trim();
  if (trimmedSpec.length > 0) {
    lines.push("", "## PRD Summary", trimmedSpec);
  }

  if (workItem.checklistItems.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const item of workItem.checklistItems) {
      lines.push(`- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`);
    }
  }

  appendActiveDirectives(lines, memory);

  const labelArgs = labels.map((label) => `--label "${label}"`).join(" ");
  const repoFlag = repoFullName ? ` --repo "${repoFullName}"` : "";
  const assigneeFlag = cleanHandle ? ` --assignee "${cleanHandle}"` : "";
  const ghCommand = `gh issue create${repoFlag} --title "[${workItem.code}] ${workItem.title}" ${labelArgs}${assigneeFlag} --body-file -`;

  lines.push(
    "",
    "## GitHub Issue Creation Instructions (`jean-skills/github-team-workflow`)",
    `1. Create the GitHub Issue using \`gh issue create\` with standard taxonomy labels (${labels.map((label) => `\`${label}\``).join(", ")}, plus an appropriate \`area:*\` label if defined in the repo):`,
    `   \`${ghCommand}\``,
    "2. Include a structured body containing: PRD summary, Technical Design Tier, Prototype URL (if available), Acceptance Criteria checklist, and suggested branch name (`" +
      suggestedBranch +
      "`).",
    "   Note: If the assignee handle is a bot/agent rather than a GitHub user, omit `--assignee` and mention the owner in the issue body instead.",
    "",
    "## Team Hub Sync & Handoff",
    `- Parse the created issue number and URL, then persist them via \`team_hub_update_work_item\` with \`workItemId: "${workItem.id}"\` and \`attributes: { githubIssueNumber: <issueNumber>, githubIssueUrl: "<issueUrl>", githubLabels: ${JSON.stringify(labels)} }\`.`,
    cleanHandle
      ? `- Post a Team Board handoff via \`hub_board_post\` mentioning \`@${cleanHandle}\` with \`${workItem.code}\`, the created Issue \`#<issueNumber>\` link, and the branch name to start development.`
      : `- Post a Team Board update via \`hub_board_post\` with \`${workItem.code}\` and the created Issue \`#<issueNumber>\` link so an engineer can pick it up.`,
  );

  return lines.join("\n");
}

export function buildRepoGovernanceBootstrapPrompt(input: {
  readonly project?: Project | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly topology?: BranchTopology | undefined;
  readonly memory?: ProjectMemory | null | undefined;
}): string {
  const { project, repoFullName, topology = "dual_trunk", memory } = input;
  const isDualTrunk = topology === "dual_trunk";
  const lines: string[] = [
    "Audit & Bootstrap Repository Governance (`jean-skills/github-team-workflow`)",
    `Workflow Topology: ${isDualTrunk ? "Standard Dual-Trunk (main + dev + release/* + hotfix/*)" : "Lite Single-Trunk (main + feat/*)"}`,
  ];

  if (project) {
    lines.push(`Hub Project: ${project.key} (${project.name})`);
  }
  if (repoFullName) {
    lines.push(`Target Repository: ${repoFullName}`);
  }

  appendActiveDirectives(lines, memory);

  lines.push(
    "",
    "## Non-Destructive Audit Rules",
    "- Inspect the existing repository first before writing or editing anything.",
    "- Never blindly overwrite customized workflows, templates, or `CODEOWNERS`; preserve existing conventions and add only missing guardrails or minimal targeted improvements.",
    "",
    "## Governance Checklist to Audit / Bootstrap",
    "1. **GitHub Templates (`.github/`)**:",
    "   - `.github/ISSUE_TEMPLATE/` (feature, bug, and hotfix forms aligned to standard labels).",
    "   - `.github/PULL_REQUEST_TEMPLATE.md` (Issue link `Closes #` / `Refs #`, `<= 400 lines` self-check, verification evidence, rollout/rollback notes).",
    "2. **Split CI Workflows (`.github/workflows/`)**:",
    ...(isDualTrunk
      ? [
          "   - `pr-dev.yml`: fast lint, typecheck, and unit tests for task PRs targeting `dev`.",
          "   - `pr-main.yml`: full release/hotfix verification gates for PRs targeting `main`.",
          "   - `sync-main-to-dev.yml`: automated back-merge PR from `main` to `dev` using Merge commit (never Squash merge `main -> dev`).",
        ]
      : [
          "   - `pr-main.yml`: lint, typecheck, and test verification gates for task PRs targeting `main`.",
        ]),
    "3. **Ownership & Agent Guidance**:",
    "   - `.github/CODEOWNERS` mapping critical paths to responsible owners.",
    "   - `AGENTS.md` kept crisp and `<= 200 lines`, recording build/test commands, branch cut rules, and non-negotiable guardrails.",
    "4. **Standard GitHub Labels Taxonomy (`init-labels.sh`)**:",
    "   - Ensure standard labels exist via `gh label create --force`: `type:feature`, `type:bug`, `type:hotfix`, `type:refactor`, `type:chore`, `priority:p0`, `priority:p1`, `priority:p2`, `priority:p3`, `qa-approved`, `blocked`, `needs-info`, plus repository `area:*` labels.",
    "5. **Branch Protection & Ruleset Verification**:",
    isDualTrunk
      ? "   - Verify `main` (Merge commit for `release/*`/`hotfix/*`, immutable `v*` tag ruleset) and `dev` (Squash merge for task branches, Merge commit for `main -> dev` back-merges)."
      : "   - Verify `main` (PR + CI required, Squash merge for task branches, immutable `v*` tag ruleset).",
    "",
    "## Team Hub Sync",
    "- Summarize audit gaps, created/updated governance files, and any manual GitHub Ruleset actions needed on the Team Board via `hub_board_post`.",
  );

  return lines.join("\n");
}

export function buildPullRequestActionPrompt(input: {
  readonly mode: PullRequestActionMode;
  readonly changeRequest: ChangeRequestAudit;
  readonly linkedWorkItem?: WorkItem | null | undefined;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly topology?: BranchTopology | undefined;
}): string {
  const { mode, changeRequest: cr, linkedWorkItem, project, memory, topology } = input;
  const strategy = recommendPrMergeStrategy({
    headBranch: cr.headBranch,
    baseBranch: cr.baseBranch,
    ...(topology ? { topology } : {}),
  });
  const totalChangedLines = cr.additions + cr.deletions;
  const isOverLineBudget = totalChangedLines > PR_LINE_BUDGET;
  const linkedLifecycle = linkedWorkItem ? readWorkItemLifecycle(linkedWorkItem) : null;

  const heading =
    mode === "fix"
      ? `Fix Review & CI Blockers for PR ${cr.repoFullName}#${cr.number}: ${cr.title}`
      : mode === "audit_and_comment"
        ? `Auto-Audit & Review Pull Request ${cr.repoFullName}#${cr.number}: ${cr.title}`
        : `Review Pull Request ${cr.repoFullName}#${cr.number}: ${cr.title}`;

  const lines: string[] = [
    heading,
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

  appendActiveDirectives(lines, memory);

  const mergeMethodSummary =
    strategy.method === "merge_commit"
      ? `Merge commit -> ${cr.baseBranch} (${strategy.ruleLabel})`
      : `Squash -> ${cr.baseBranch} (${strategy.ruleLabel})`;
  const diffBudgetSummary = isOverLineBudget
    ? `${totalChangedLines} changed lines (exceeds <= ${PR_LINE_BUDGET} lines guardrail; check if this PR should be split)`
    : `${totalChangedLines} changed lines (within <= ${PR_LINE_BUDGET} lines guardrail)`;
  const issueCheckSummary = linkedWorkItem
    ? linkedLifecycle?.githubIssueNumber !== null &&
      linkedLifecycle?.githubIssueNumber !== undefined
      ? `Linked to [${linkedWorkItem.code}] and GitHub Issue #${linkedLifecycle.githubIssueNumber}`
      : `Linked to [${linkedWorkItem.code}] (verify PR body links the GitHub Issue via Closes/Refs #)`
    : "No linked Work Item detected (verify PR body references a GitHub Issue or explain why it is standalone)";

  lines.push(
    "",
    "## GitHub Team Workflow Checks",
    `- Recommended merge strategy: ${mergeMethodSummary}${strategy.isBackMerge ? " (NEVER squash back-merges into dev!)" : ""}`,
    `- Diff size check: ${diffBudgetSummary}`,
    `- Linked Issue / Work Item check: ${issueCheckSummary}`,
  );

  if (mode === "fix") {
    lines.push(
      "",
      "## Instructions",
      `Inspect branch \`${cr.headBranch}\`, reproduce and resolve every blocking automated review comment or CI issue above, verify with tests, and summarize the fix. Keep changes scoped within the <= ${PR_LINE_BUDGET} lines guardrail where practical. If a linked WorkItem exists, publish a short pulse via \`team_hub_publish_pulse\` and post a concise update on the Team Board via \`hub_board_post\`.`,
    );
  } else if (mode === "audit_and_comment") {
    lines.push(
      "",
      "## Instructions",
      `1. Inspect PR #${cr.number} (\`${cr.headBranch}\` -> \`${cr.baseBranch}\`) with \`gh pr diff ${cr.number} --repo ${cr.repoFullName}\` and audit correctness, edge cases, security, tests, <= ${PR_LINE_BUDGET} lines scope, linked Issue reference, and merge strategy (\`${strategy.method}\`).`,
      `2. Submit your structured review directly on GitHub using \`gh pr review ${cr.number} --repo ${cr.repoFullName}\` with \`--approve\` (when ready), \`--request-changes\` (when blocking defects exist), or \`--comment\` (for non-blocking observations).`,
      `3. Post a concise audit summary on the Team Board via \`hub_board_post\` mentioning \`@${cr.authorVcsLogin}\`${linkedWorkItem ? ` and referencing \`${linkedWorkItem.code}\`` : ""}.`,
    );
  } else {
    lines.push(
      "",
      "## Instructions",
      `Inspect PR #${cr.number} (\`${cr.headBranch}\` -> \`${cr.baseBranch}\`), review correctness, edge cases, adherence to the locked project directives, <= ${PR_LINE_BUDGET} lines discipline, and acceptance criteria, then provide concise actionable review feedback.`,
    );
  }

  return lines.join("\n");
}
