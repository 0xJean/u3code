import {
  COCKPIT_PROMPT_SLOTS,
  readWorkItemLifecycle,
  recommendPrMergeStrategy,
  standardGitHubLabels,
  suggestWorkItemBranchName,
  type BranchTopology,
  type ChangeRequestAudit,
  type CockpitPromptSlot,
  type Project,
  type ProjectMemory,
  type ProjectRepo,
  type WorkItem,
} from "@u3code/hub-contracts";

export { COCKPIT_PROMPT_SLOTS, type CockpitPromptSlot };

export interface LocalWorkspaceProjectLike {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export type PullRequestActionMode = "fix" | "review" | "audit_and_comment";

const PR_LINE_BUDGET = 400;

export const PROMPT_SLOT_VARIABLES: Readonly<Record<CockpitPromptSlot, ReadonlyArray<string>>> = {
  prd: [
    "code",
    "title",
    "project",
    "repo",
    "schedule",
    "designTier",
    "workItemId",
    "spec",
    "checklist",
    "directives",
    "responseLanguage",
  ],
  prototype: [
    "code",
    "title",
    "project",
    "repo",
    "prototypeUrl",
    "workItemId",
    "spec",
    "checklist",
    "directives",
    "responseLanguage",
  ],
  issue_dispatch: [
    "code",
    "title",
    "project",
    "repo",
    "assignee",
    "labels",
    "branch",
    "ghCommand",
    "workItemId",
    "spec",
    "checklist",
    "directives",
    "responseLanguage",
  ],
  dev_branch: [
    "code",
    "title",
    "project",
    "repo",
    "branch",
    "baseBranch",
    "branchCommand",
    "issueRef",
    "labels",
    "workItemId",
    "spec",
    "checklist",
    "directives",
    "responseLanguage",
  ],
  pr_audit: [
    "prRef",
    "prTitle",
    "prUrl",
    "headBranch",
    "baseBranch",
    "prAuthor",
    "prDiff",
    "mergeStrategy",
    "diffBudget",
    "issueCheck",
    "reviewFindings",
    "directives",
    "responseLanguage",
  ],
  pr_fix: [
    "prRef",
    "prTitle",
    "prUrl",
    "headBranch",
    "baseBranch",
    "prAuthor",
    "prDiff",
    "reviewFindings",
    "spec",
    "checklist",
    "directives",
    "responseLanguage",
  ],
  repo_governance: ["project", "repo", "topologyLabel", "directives", "responseLanguage"],
};

function normalizeMatchToken(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isChineseLocale(locale?: string | null): boolean {
  return (locale ?? "").trim().toLowerCase().startsWith("zh");
}

export function resolvePromptLanguageName(locale?: string | null): string {
  const normalized = (locale ?? "en").trim().toLowerCase();
  if (normalized.startsWith("zh")) return "简体中文";
  if (normalized.startsWith("ja")) return "日本語";
  if (normalized.startsWith("ko")) return "한국어";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("de")) return "Deutsch";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("fr")) return "Français";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("es")) return "Español";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("pt")) return "Português (Brasil)";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("ru")) return "Русский";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  if (normalized.startsWith("sv")) return "Svenska";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- native language endonym sent in agent prompt
  return "English";
}

export function findMatchingWorkspaceProject<T extends LocalWorkspaceProjectLike>(
  localProjects: ReadonlyArray<T>,
  hubRepos: ReadonlyArray<Pick<ProjectRepo, "repoFullName">>,
  projectHint?: Pick<Project, "key" | "name"> | null,
): T | null {
  if (localProjects.length === 0) return null;

  const repoNames = new Set(
    hubRepos
      .map((r) => r.repoFullName.split("/").at(-1)?.trim().toLowerCase() ?? "")
      .filter((name) => name.length > 0),
  );
  if (repoNames.size > 0) {
    const repoMatch = localProjects.find((proj) => {
      const folderName = proj.workspaceRoot.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
      return repoNames.has(proj.title.trim().toLowerCase()) || repoNames.has(folderName);
    });
    if (repoMatch) return repoMatch;
  }

  if (projectHint) {
    const hintTokens = [
      normalizeMatchToken(projectHint.name),
      normalizeMatchToken(projectHint.key),
    ].filter((token) => token.length >= 2);
    if (hintTokens.length > 0) {
      const exactHintMatch = localProjects.find((proj) => {
        const folderToken = normalizeMatchToken(proj.workspaceRoot.split(/[\\/]/).at(-1));
        const titleToken = normalizeMatchToken(proj.title);
        return hintTokens.some((hint) => hint === titleToken || hint === folderToken);
      });
      if (exactHintMatch) return exactHintMatch;

      const partialHintMatch = localProjects.find((proj) => {
        const folderToken = normalizeMatchToken(proj.workspaceRoot.split(/[\\/]/).at(-1));
        const titleToken = normalizeMatchToken(proj.title);
        return hintTokens.some(
          (hint) =>
            (titleToken.length >= 2 && (hint.includes(titleToken) || titleToken.includes(hint))) ||
            (folderToken.length >= 2 && (hint.includes(folderToken) || folderToken.includes(hint))),
        );
      });
      if (partialHintMatch) return partialHintMatch;
    }
  }

  return null;
}

export function pickMatchingWorkspaceProject<T extends LocalWorkspaceProjectLike>(
  localProjects: ReadonlyArray<T>,
  hubRepos: ReadonlyArray<Pick<ProjectRepo, "repoFullName">>,
  projectHint?: Pick<Project, "key" | "name"> | null,
): T | null {
  if (localProjects.length === 0) return null;
  return (
    findMatchingWorkspaceProject(localProjects, hubRepos, projectHint) ?? localProjects[0] ?? null
  );
}

export function renderPromptTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return Object.hasOwn(variables, key) ? (variables[key] ?? "") : "";
  });
  return rendered
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getDefaultPromptTemplate(slot: CockpitPromptSlot, locale?: string | null): string {
  const zh = isChineseLocale(locale);
  switch (slot) {
    case "prd":
      return zh
        ? [
            "为工作项 [{{code}}] {{title}} 撰写产品需求文档（PRD）并进行技术设计分级",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{scheduleLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "{{memorySection}}",
            "",
            "## 输出要求",
            "- 请全程使用 {{responseLanguage}} 撰写 PRD、验收标准与团队协作板汇报（代码符号、路径与命令保持英文规范）。",
            "1. 输出结构清晰的 Markdown PRD，包含：问题背景与目标、用户故事与范围、非目标（Non-Goals）、交互与边界情况、数据/接口影响、发布与回滚方案。",
            "2. 编写具体可测试的验收标准（`AC-1`、`AC-2` ...，初始 `verified: false`）。",
            "3. 按 `jean-skills/github-team-workflow`（`tech-design.md`）评定**技术设计分级**：",
            "   - `small`：局部改动（< 1 天），无表结构或 API 契约变更；PR 描述即可。",
            "   - `medium`：单仓库多文件功能；设计说明写在 PRD 与 PR 描述中。",
            "   - `large`：新子系统、数据库迁移或公开 API 变更；开发前需登记独立设计文档路径（`docs/design/...`）。",
            "   - `cross_repo`：跨多仓库或破坏性契约变更；开发前需先完成跨仓库契约冻结。",
            "",
            "## 同步回 Team Hub",
            '- 使用 `team_hub_update_work_item`（`workItemId: "{{workItemId}}"`）回写 `specMarkdown`、`checklistItems`，并设置 `attributes: { prdStatus: "draft", designTier: "<small|medium|large|cross_repo>" }`（若为 `large`/`cross_repo` 请一并写入 `designDocPath`）。',
            "- 使用 `hub_board_post` 在团队协作板发布一条关联 `{{code}}` 的简短汇报，说明选定的设计分级与 AC 数量，方便 PM 与研发评审确认。",
          ].join("\n")
        : [
            "Draft AI PRD & Technical Design Classification for [{{code}}] {{title}}",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{scheduleLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "{{memorySection}}",
            "",
            "## Deliverable",
            "- Respond and write all PRD content, acceptance criteria, and Team Board updates in {{responseLanguage}} (keep code identifiers, paths, and CLI commands in English).",
            "1. Produce a clear, concise Product Requirements Document (PRD) in Markdown covering: Problem & Goal, User Stories & Scope, Non-Goals, UX & Edge Cases, Data / API Impact, and Rollout / Rollback Notes.",
            "2. Author concrete, testable Acceptance Criteria items (`AC-1`, `AC-2`, ...) with `verified: false`.",
            "3. Classify the **Technical Design Tier** following `jean-skills/github-team-workflow` (`tech-design.md`):",
            "   - `small`: localized change (< 1 day), no schema or API contract change; PR description is enough.",
            "   - `medium`: single-repo multi-file feature; design notes live inside this PRD and the PR body.",
            "   - `large`: new subsystem, schema migration, or public API change; record a dedicated design doc path (`docs/design/...`) before implementation.",
            "   - `cross_repo`: spans multiple repositories or breaking contracts; require cross-repo contract freeze before coding.",
            "",
            "## Team Hub Sync",
            '- Save the PRD, AC checklist, and lifecycle attributes back to Team Hub using `team_hub_update_work_item` with `workItemId: "{{workItemId}}"`, setting `specMarkdown`, `checklistItems`, and `attributes: { prdStatus: "draft", designTier: "<small|medium|large|cross_repo>" }` (include `designDocPath` for `large` or `cross_repo`).',
            "- Announce the drafted PRD on the Team Board using `hub_board_post` referencing `{{code}}`, stating the chosen design tier and AC count so PM and engineering reviewers can sign off.",
          ].join("\n");

    case "prototype":
      return zh
        ? [
            "为工作项 [{{code}}] {{title}} 设计并构建可交互 UI 原型",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{prototypeLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "",
            "## 输出要求",
            "- 原型界面文案、交互说明与团队协作板汇报请使用 {{responseLanguage}}。",
            "1. 基于上述 PRD 与验收标准，构建可点击交互的 UI / HTML 设计原型。",
            "2. 完整覆盖主流程及关键状态（默认数据态、空状态、加载/保存反馈、错误提示与响应式布局）。",
            "3. 交付前自行检查渲染效果，确保视觉层级、间距呼吸感、可读性与操作顺手度达到上线水准。",
            "",
            "## 同步回 Team Hub",
            '- 使用 `team_hub_update_work_item`（`workItemId: "{{workItemId}}"`）回写 `previewUrls` 及 `attributes: { prototypeStatus: "draft", prototypeUrl: "<previewUrlOrPath>" }`。',
            "- 使用 `hub_board_post` 在团队协作板发布带 `@mention` 的原型评审交接动态，关联 `{{code}}` 并附上预览地址与关键交互决策。",
          ].join("\n")
        : [
            "Build Interactive UI Prototype for [{{code}}] {{title}}",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{prototypeLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "",
            "## Deliverable",
            "- Author prototype copy, interaction notes, and Team Board updates in {{responseLanguage}}.",
            "1. Design and build an interactive, clickable UI / HTML design prototype grounded in the PRD and acceptance criteria above.",
            "2. Cover primary user flows plus key interactive states (default populated view, empty state, loading/saving feedback, error handling, and responsive layout).",
            "3. Inspect the rendered prototype carefully to verify visual hierarchy, spacing, readability, and ergonomics before handing off.",
            "",
            "## Team Hub Sync",
            '- Record the prototype URL or preview path back in Team Hub using `team_hub_update_work_item` with `workItemId: "{{workItemId}}"`, setting `previewUrls` and `attributes: { prototypeStatus: "draft", prototypeUrl: "<previewUrlOrPath>" }`.',
            "- Post a concise `@mention` review handoff on the Team Board via `hub_board_post` referencing `{{code}}`, including the prototype preview URL/path and key interaction decisions for PM and design review.",
          ].join("\n");

    case "issue_dispatch":
      return zh
        ? [
            "为工作项 [{{code}}] {{title}} 创建并派发 GitHub Issue",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{assigneeLine}}",
            "{{scheduleLine}}",
            "{{prototypeLine}}",
            "{{issueLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub Issue 创建规范（`jean-skills/github-team-workflow`）",
            "- Issue 正文与协作板交接内容请使用 {{responseLanguage}}（标签与命令保持规范英文）。",
            "1. 使用 `gh issue create` 创建带标准标签（{{labelsFormatted}}，并按仓库目录补充合适的 `area:*` 标签）的 Issue：",
            "   `{{ghCommand}}`",
            "2. Issue 正文需结构化包含：PRD 摘要、技术设计分级、原型预览链接（如有）、验收标准清单以及推荐分支名（`{{branch}}`）。",
            "   提示：若指派对象为 AI Agent / 机器人而非 GitHub 真人账号，请省略 `--assignee` 并在正文中说明负责人。",
            "",
            "## 同步回 Team Hub 并交接",
            '- 解析创建成功的 Issue 编号与链接，调用 `team_hub_update_work_item`（`workItemId: "{{workItemId}}"`）写入 `attributes: { githubIssueNumber: <issueNumber>, githubIssueUrl: "<issueUrl>", githubLabels: {{labelsJson}} }`。',
            "- {{boardHandoffInstruction}}",
          ].join("\n")
        : [
            "Submit & Dispatch GitHub Issue for [{{code}}] {{title}}",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{assigneeLine}}",
            "{{scheduleLine}}",
            "{{prototypeLine}}",
            "{{issueLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub Issue Creation Instructions (`jean-skills/github-team-workflow`)",
            "- Write the Issue body and Team Board handoff in {{responseLanguage}} (keep standard labels and CLI flags in English).",
            "1. Create the GitHub Issue using `gh issue create` with standard taxonomy labels ({{labelsFormatted}}, plus an appropriate `area:*` label if defined in the repo):",
            "   `{{ghCommand}}`",
            "2. Include a structured body containing: PRD summary, Technical Design Tier, Prototype URL (if available), Acceptance Criteria checklist, and suggested branch name (`{{branch}}`).",
            "   Note: If the assignee handle is a bot/agent rather than a GitHub user, omit `--assignee` and mention the owner in the issue body instead.",
            "",
            "## Team Hub Sync & Handoff",
            '- Parse the created issue number and URL, then persist them via `team_hub_update_work_item` with `workItemId: "{{workItemId}}"` and `attributes: { githubIssueNumber: <issueNumber>, githubIssueUrl: "<issueUrl>", githubLabels: {{labelsJson}} }`.',
            "- {{boardHandoffInstruction}}",
          ].join("\n");

    case "dev_branch":
      return zh
        ? [
            "按规范分支开发工作项 [{{code}}] {{title}}",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{scheduleLine}}",
            "{{issueLine}}",
            "{{specSection}}",
            "{{previewSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "{{linkedPrsSection}}",
            "",
            "## GitHub 团队协作开发护栏",
            "- 请使用 {{responseLanguage}} 进行沟通、汇报进展与编写说明（代码、提交类型前缀与分支名保持英文规范）。",
            "- 分支拓扑：`{{topology}}`（目标合入分支：`{{baseBranch}}`）。",
            "- 从远端最新基线切出规范任务分支：",
            "  `{{branchCommand}}`",
            "- 保持单个 PR 聚焦且变更行数 <= 400 行；较大需求拆分为多个小 PR 分步提交。",
            "- 遵循 Conventional Commits 规范（`feat(scope): ...`、`fix(scope): ...`、`refactor(scope): ...`、`chore(scope): ...`）。",
            "- {{issueLinkHint}}",
            "- 标准标签：{{labelsFormatted}}。",
            "- 合并策略：任务分支使用 Squash 合并到 `{{baseBranch}}`（严禁对 `main -> dev` 或 `release/* -> main` 使用 Squash）。",
            "",
            "## 同步回 Team Hub",
            '请严格按照上述 PRD 与验收标准实现 [{{code}}]。完成关键进展或勾选 AC 时，调用 `team_hub_update_work_item`（`workItemId: "{{workItemId}}"`）与 `team_hub_publish_pulse`，提交 PR 或遇到阻塞时通过 `hub_board_post` 在团队协作板同步交接。',
          ].join("\n")
        : [
            "Work Item: [{{code}}] {{title}}",
            "{{metadata}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{scheduleLine}}",
            "{{issueLine}}",
            "{{specSection}}",
            "{{previewSection}}",
            "{{checklistSection}}",
            "{{directivesSection}}",
            "{{linkedPrsSection}}",
            "",
            "## GitHub Team Workflow Guardrails",
            "- Communicate progress, summaries, and Team Board updates in {{responseLanguage}} (keep code, Conventional Commit prefixes, and branch names in English).",
            "- Branch topology: `{{topology}}` (target base: `{{baseBranch}}`).",
            "- Cut the branch from fresh origin ref using:",
            "  `{{branchCommand}}`",
            "- Keep PR diffs focused and <= 400 changed lines; split larger changes into incremental PRs.",
            "- Follow Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `chore(scope): ...`).",
            "- {{issueLinkHint}}",
            "- Standard PR labels: {{labelsFormatted}}.",
            "- Merge strategy: Squash merge task branches into `{{baseBranch}}` (never squash `main -> dev` or `release/* -> main`).",
            "",
            "## Team Hub Sync",
            "Please implement or investigate [{{code}}] following the specification and acceptance criteria above. Persist progress and verified ACs via `team_hub_update_work_item` (workItemId: `{{workItemId}}`), publish concise progress pulses via `team_hub_publish_pulse`, and post PR handoffs or blockers on the Team Board via `hub_board_post`.",
          ].join("\n");

    case "pr_audit":
      return zh
        ? [
            "自动审核并评审 Pull Request {{prRef}}：{{prTitle}}",
            "PR 链接：{{prUrl}}",
            "分支：{{headBranch}} -> {{baseBranch}}（{{baseBranchRole}}）",
            "作者：@{{prAuthor}} | 变更量：{{prDiff}} | CI：{{ciStatus}}",
            "{{projectLine}}",
            "{{linkedWorkItemLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{reviewFindingsSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub 团队协作检查项",
            "- 推荐合并策略：{{mergeStrategy}}",
            "- PR 体积检查：{{diffBudget}}",
            "- Issue / 工作项关联检查：{{issueCheck}}",
            "",
            "## 执行指令",
            "- 评审意见与协作板汇报请使用 {{responseLanguage}}。",
            "{{prInstructions}}",
          ].join("\n")
        : [
            "{{prHeading}}",
            "PR URL: {{prUrl}}",
            "Branches: {{headBranch}} -> {{baseBranch}} ({{baseBranchRole}})",
            "Author: @{{prAuthor}} | Diff: {{prDiff}} | CI: {{ciStatus}}",
            "{{projectLine}}",
            "{{linkedWorkItemLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{reviewFindingsSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub Team Workflow Checks",
            "- Recommended merge strategy: {{mergeStrategy}}",
            "- Diff size check: {{diffBudget}}",
            "- Linked Issue / Work Item check: {{issueCheck}}",
            "",
            "## Instructions",
            "- Write review feedback and Team Board summaries in {{responseLanguage}}.",
            "{{prInstructions}}",
          ].join("\n");

    case "pr_fix":
      return zh
        ? [
            "修复 PR {{prRef}} 的评审阻塞与 CI 问题：{{prTitle}}",
            "PR 链接：{{prUrl}}",
            "分支：{{headBranch}} -> {{baseBranch}}（{{baseBranchRole}}）",
            "作者：@{{prAuthor}} | 变更量：{{prDiff}} | CI：{{ciStatus}}",
            "{{projectLine}}",
            "{{linkedWorkItemLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{reviewFindingsSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub 团队协作检查项",
            "- 推荐合并策略：{{mergeStrategy}}",
            "- PR 体积检查：{{diffBudget}}",
            "- Issue / 工作项关联检查：{{issueCheck}}",
            "",
            "## 执行指令",
            "- 修复总结与协作板动态请使用 {{responseLanguage}}。",
            "{{prInstructions}}",
          ].join("\n")
        : [
            "Fix Review & CI Blockers for PR {{prRef}}: {{prTitle}}",
            "PR URL: {{prUrl}}",
            "Branches: {{headBranch}} -> {{baseBranch}} ({{baseBranchRole}})",
            "Author: @{{prAuthor}} | Diff: {{prDiff}} | CI: {{ciStatus}}",
            "{{projectLine}}",
            "{{linkedWorkItemLine}}",
            "{{specSection}}",
            "{{checklistSection}}",
            "{{reviewFindingsSection}}",
            "{{directivesSection}}",
            "",
            "## GitHub Team Workflow Checks",
            "- Recommended merge strategy: {{mergeStrategy}}",
            "- Diff size check: {{diffBudget}}",
            "- Linked Issue / Work Item check: {{issueCheck}}",
            "",
            "## Instructions",
            "- Write fix summaries and Team Board updates in {{responseLanguage}}.",
            "{{prInstructions}}",
          ].join("\n");

    case "repo_governance":
      return zh
        ? [
            "审计并初始化仓库 GitHub 团队协作规范（`jean-skills/github-team-workflow`）",
            "分支拓扑：{{topologyLabel}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{directivesSection}}",
            "",
            "## 非破坏性审计原则",
            "- 请使用 {{responseLanguage}} 输出审计结论与团队协作板汇报（配置文件与工作流 YAML 保持规范英文）。",
            "- 先完整检查仓库现有结构再做任何写入或修改。",
            "- 绝不盲目覆盖团队已定制的 workflow、模板或 `CODEOWNERS`；保留既有约定，仅补齐缺失护栏或做最小化增量改进。",
            "",
            "## 治理检查与初始化清单",
            "1. **GitHub 模板（`.github/`）**：",
            "   - `.github/ISSUE_TEMPLATE/`（按标准标签配置的 feature / bug / hotfix 表单）。",
            "   - `.github/PULL_REQUEST_TEMPLATE.md`（包含 `Closes #`/`Refs #` 关联、`<= 400 行` 自检、验证证据、发布/回滚说明）。",
            "2. **拆分 CI 门禁（`.github/workflows/`）**：",
            "{{ciWorkflowBullets}}",
            "3. **代码归属与 Agent 指南**：",
            "   - `.github/CODEOWNERS` 映射关键路径责任人。",
            "   - `AGENTS.md` 控制在 `<= 200 行`，沉淀构建/测试命令、切分支规则与不可妥协护栏。",
            "4. **标准 GitHub 标签体系（`init-labels.sh`）**：",
            "   - 通过 `gh label create --force` 补齐：`type:feature`、`type:bug`、`type:hotfix`、`type:refactor`、`type:chore`、`priority:p0`、`priority:p1`、`priority:p2`、`priority:p3`、`qa-approved`、`blocked`、`needs-info` 以及仓库 `area:*` 标签。",
            "5. **分支保护与 Ruleset 检查**：",
            "   - {{rulesetBullet}}",
            "",
            "## 同步回 Team Hub",
            "- 通过 `hub_board_post` 在团队协作板汇总审计缺口、已创建/更新的治理文件，以及仍需管理员在 GitHub UI 手动确认的 Ruleset 项。",
          ].join("\n")
        : [
            "Audit & Bootstrap Repository Governance (`jean-skills/github-team-workflow`)",
            "Workflow Topology: {{topologyLabel}}",
            "{{projectLine}}",
            "{{repoLine}}",
            "{{directivesSection}}",
            "",
            "## Non-Destructive Audit Rules",
            "- Write audit reports and Team Board summaries in {{responseLanguage}} (keep YAML workflows and config syntax standard).",
            "- Inspect the existing repository first before writing or editing anything.",
            "- Never blindly overwrite customized workflows, templates, or `CODEOWNERS`; preserve existing conventions and add only missing guardrails or minimal targeted improvements.",
            "",
            "## Governance Checklist to Audit / Bootstrap",
            "1. **GitHub Templates (`.github/`)**:",
            "   - `.github/ISSUE_TEMPLATE/` (feature, bug, and hotfix forms aligned to standard labels).",
            "   - `.github/PULL_REQUEST_TEMPLATE.md` (Issue link `Closes #` / `Refs #`, `<= 400 lines` self-check, verification evidence, rollout/rollback notes).",
            "2. **Split CI Workflows (`.github/workflows/`)**:",
            "{{ciWorkflowBullets}}",
            "3. **Ownership & Agent Guidance**:",
            "   - `.github/CODEOWNERS` mapping critical paths to responsible owners.",
            "   - `AGENTS.md` kept crisp and `<= 200 lines`, recording build/test commands, branch cut rules, and non-negotiable guardrails.",
            "4. **Standard GitHub Labels Taxonomy (`init-labels.sh`)**:",
            "   - Ensure standard labels exist via `gh label create --force`: `type:feature`, `type:bug`, `type:hotfix`, `type:refactor`, `type:chore`, `priority:p0`, `priority:p1`, `priority:p2`, `priority:p3`, `qa-approved`, `blocked`, `needs-info`, plus repository `area:*` labels.",
            "5. **Branch Protection & Ruleset Verification**:",
            "   - {{rulesetBullet}}",
            "",
            "## Team Hub Sync",
            "- Summarize audit gaps, created/updated governance files, and any manual GitHub Ruleset actions needed on the Team Board via `hub_board_post`.",
          ].join("\n");
  }
}

function resolveTemplate(
  slot: CockpitPromptSlot,
  project?: Project | null,
  locale?: string | null,
  overrideTemplate?: string | null,
): string {
  const explicit = overrideTemplate?.trim();
  if (explicit) return explicit;
  const saved = project?.workflowConfig.promptTemplates?.[slot]?.trim();
  if (saved) return saved;
  return getDefaultPromptTemplate(slot, locale);
}

function formatDirectivesBlock(
  memory: ProjectMemory | null | undefined,
  zh: boolean,
): {
  readonly raw: string;
  readonly section: string;
} {
  const activeDirectives = (memory?.directives ?? []).filter((d) => d.active);
  if (activeDirectives.length === 0) return { raw: "", section: "" };
  const raw = activeDirectives.map((directive) => `- ${directive.text}`).join("\n");
  const heading = zh ? "## 项目锁定红线指令" : "## Locked Project Directives";
  return { raw, section: `\n${heading}\n${raw}` };
}

function formatChecklistBlock(
  workItem: Pick<WorkItem, "checklistItems">,
  zh: boolean,
): {
  readonly raw: string;
  readonly section: string;
} {
  if (workItem.checklistItems.length === 0) return { raw: "", section: "" };
  const raw = workItem.checklistItems
    .map((item) => `- [${item.verified ? "x" : " "}] ${item.id}: ${item.text}`)
    .join("\n");
  const heading = zh ? "## 验收标准（Acceptance Criteria）" : "## Acceptance Criteria";
  return { raw, section: `\n${heading}\n${raw}` };
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
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const {
    workItem,
    project,
    memory,
    changeRequests = [],
    repoFullName,
    topology,
    locale,
    customTemplate,
  } = input;
  const zh = isChineseLocale(locale);
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
  const trimmedSpec = workItem.specMarkdown.trim();
  const directives = formatDirectivesBlock(memory, zh);
  const checklist = formatChecklistBlock(workItem, zh);

  const issueTag =
    lifecycle.githubIssueNumber !== null
      ? `#${lifecycle.githubIssueNumber}`
      : lifecycle.githubIssueUrl
        ? zh
          ? "已关联 Issue"
          : "Linked Issue"
        : "";
  const issueRef =
    issueTag && lifecycle.githubIssueUrl
      ? `${issueTag} (${lifecycle.githubIssueUrl})`
      : issueTag || (lifecycle.githubIssueUrl ?? "");

  const schedule =
    lifecycle.plannedStartAt || lifecycle.dueAt
      ? `start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`
      : "";

  const previewSection =
    previewLinks.length > 0
      ? `\n${zh ? "## 原型与预览链接" : "## Prototype & Preview Links"}\n${previewLinks.map((url) => `- ${url}`).join("\n")}`
      : "";

  const linkedPrsSection =
    changeRequests.length > 0
      ? `\n${zh ? "## 已关联的 Pull Requests" : "## Linked Pull Requests"}\n${changeRequests
          .map((cr) => `- ${cr.repoFullName}#${cr.number} (${cr.state}): ${cr.title} (${cr.url})`)
          .join("\n")}`
      : "";

  const issueLinkHint =
    lifecycle.githubIssueNumber !== null
      ? zh
        ? `在 PR 描述中使用 \`Closes #${lifecycle.githubIssueNumber}\` 关联 Issue #${lifecycle.githubIssueNumber}（多 PR 拆分系列的中间 PR 请用 \`Refs #${lifecycle.githubIssueNumber}\`）。`
        : `Link the PR to Issue #${lifecycle.githubIssueNumber} using \`Closes #${lifecycle.githubIssueNumber}\` (or \`Refs #${lifecycle.githubIssueNumber}\` for intermediate PRs in a multi-PR series).`
      : zh
        ? "在 PR 描述中使用 `Closes #<num>`（多 PR 功能中间提交用 `Refs #<num>`）关联对应 GitHub Issue。"
        : "Reference the linked GitHub Issue in the PR body using `Closes #<num>` (or `Refs #<num>` for multi-PR features).";

  const template = resolveTemplate("dev_branch", project, locale, customTemplate);
  return renderPromptTemplate(template, {
    code: workItem.code,
    title: workItem.title,
    workItemId: workItem.id,
    metadata: `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, stage=${workItem.stage}, health=${workItem.health}, designTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    repo: repoFullName ?? "",
    repoLine: repoFullName ? `${zh ? "代码仓库：" : "Repository: "}${repoFullName}` : "",
    schedule,
    scheduleLine: schedule ? `${zh ? "排期：" : "Schedule: "}${schedule}` : "",
    issueRef,
    issueLine: issueRef ? `${zh ? "关联 GitHub Issue：" : "Linked GitHub Issue: "}${issueRef}` : "",
    spec: trimmedSpec,
    specSection: trimmedSpec
      ? `\n${zh ? "## 需求规格（PRD / Specification）" : "## Specification"}\n${trimmedSpec}`
      : "",
    previewSection,
    checklist: checklist.raw,
    checklistSection: checklist.section,
    directives: directives.raw,
    directivesSection: directives.section,
    linkedPrsSection,
    topology: resolvedTopology,
    branch: suggestedBranch,
    baseBranch,
    branchCommand,
    labels: labels.join(", "),
    labelsFormatted: labels.map((label) => `\`${label}\``).join(", "),
    issueLinkHint,
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function buildPrdGenerationPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const { workItem, project, memory, repoFullName, locale, customTemplate } = input;
  const zh = isChineseLocale(locale);
  const lifecycle = readWorkItemLifecycle(workItem);
  const trimmedSpec = workItem.specMarkdown.trim();
  const directives = formatDirectivesBlock(memory, zh);
  const checklist = formatChecklistBlock(workItem, zh);

  const memoryParts: string[] = [];
  if ((memory?.architectureDecisions.length ?? 0) > 0) {
    memoryParts.push(
      `${zh ? "## 相关架构决策（ADR）" : "## Relevant Architecture Decisions"}\n${(
        memory?.architectureDecisions.slice(0, 5) ?? []
      )
        .map((decision) => {
          const rationaleSuffix = decision.rationale.trim()
            ? ` (${decision.rationale.trim()})`
            : "";
          return `- ${decision.summary}${rationaleSuffix}`;
        })
        .join("\n")}`,
    );
  }
  const activeRisks = (memory?.recurringRisks ?? []).filter((risk) => risk.active);
  if (activeRisks.length > 0) {
    memoryParts.push(
      `${zh ? "## 高频项目风险" : "## Recurring Project Risks"}\n${activeRisks
        .slice(0, 5)
        .map((risk) => `- [${risk.severity}] ${risk.title} (mitigation: ${risk.mitigation})`)
        .join("\n")}`,
    );
  }

  const schedule =
    lifecycle.plannedStartAt || lifecycle.dueAt
      ? `start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`
      : "";

  const template = resolveTemplate("prd", project, locale, customTemplate);
  return renderPromptTemplate(template, {
    code: workItem.code,
    title: workItem.title,
    workItemId: workItem.id,
    designTier: lifecycle.designTier,
    metadata: `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, stage=${workItem.stage}, currentDesignTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    repo: repoFullName ?? "",
    repoLine: repoFullName ? `${zh ? "代码仓库：" : "Repository: "}${repoFullName}` : "",
    schedule,
    scheduleLine: schedule ? `${zh ? "目标排期：" : "Target Schedule: "}${schedule}` : "",
    spec: trimmedSpec,
    specSection: trimmedSpec
      ? `\n${zh ? "## 已有需求简述" : "## Existing Requirement Brief"}\n${trimmedSpec}`
      : "",
    checklist: checklist.raw,
    checklistSection: checklist.section,
    directives: directives.raw,
    directivesSection: directives.section,
    memorySection: memoryParts.length > 0 ? `\n${memoryParts.join("\n\n")}` : "",
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function buildPrototypeGenerationPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const { workItem, project, memory, repoFullName, locale, customTemplate } = input;
  const zh = isChineseLocale(locale);
  const lifecycle = readWorkItemLifecycle(workItem);
  const trimmedSpec = workItem.specMarkdown.trim();
  const directives = formatDirectivesBlock(memory, zh);
  const checklist = formatChecklistBlock(workItem, zh);

  const template = resolveTemplate("prototype", project, locale, customTemplate);
  return renderPromptTemplate(template, {
    code: workItem.code,
    title: workItem.title,
    workItemId: workItem.id,
    metadata: `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, designTier=${lifecycle.designTier}, prdStatus=${lifecycle.prdStatus}, workItemId=${workItem.id}`,
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    repo: repoFullName ?? "",
    repoLine: repoFullName ? `${zh ? "代码仓库：" : "Repository: "}${repoFullName}` : "",
    prototypeUrl: lifecycle.prototypeUrl ?? "",
    prototypeLine: lifecycle.prototypeUrl
      ? `${zh ? "当前原型地址：" : "Current Prototype URL: "}${lifecycle.prototypeUrl}`
      : "",
    spec: trimmedSpec,
    specSection: trimmedSpec
      ? `\n${zh ? "## PRD 需求规格" : "## PRD Specification"}\n${trimmedSpec}`
      : "",
    checklist: checklist.raw,
    checklistSection: checklist.section,
    directives: directives.raw,
    directivesSection: directives.section,
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function buildIssueDispatchPrompt(input: {
  readonly workItem: WorkItem;
  readonly project?: Project | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly assigneeHandle?: string | null | undefined;
  readonly assigneeDisplayName?: string | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const {
    workItem,
    project,
    repoFullName,
    assigneeHandle,
    assigneeDisplayName,
    memory,
    locale,
    customTemplate,
  } = input;
  const zh = isChineseLocale(locale);
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
  const trimmedSpec = workItem.specMarkdown.trim();
  const directives = formatDirectivesBlock(memory, zh);
  const checklist = formatChecklistBlock(workItem, zh);

  const labelArgs = labels.map((label) => `--label "${label}"`).join(" ");
  const repoFlag = repoFullName ? ` --repo "${repoFullName}"` : "";
  const assigneeFlag = cleanHandle ? ` --assignee "${cleanHandle}"` : "";
  const ghCommand = `gh issue create${repoFlag} --title "[${workItem.code}] ${workItem.title}" ${labelArgs}${assigneeFlag} --body-file -`;

  const displaySuffix =
    cleanHandle && assigneeDisplayName && assigneeDisplayName.trim() !== cleanHandle
      ? ` (${assigneeDisplayName.trim()})`
      : "";
  const assigneeText = cleanHandle ? `@${cleanHandle}${displaySuffix}` : "";
  const schedule =
    lifecycle.plannedStartAt || lifecycle.dueAt
      ? `start=${lifecycle.plannedStartAt ?? "unset"}, due=${lifecycle.dueAt ?? "unset"}`
      : "";
  const issueLine = lifecycle.githubIssueUrl
    ? `${zh ? "已有联动 Issue：" : "Existing Linked Issue: "}${lifecycle.githubIssueNumber !== null ? `#${lifecycle.githubIssueNumber} ` : ""}${lifecycle.githubIssueUrl}`
    : "";

  const boardHandoffInstruction = cleanHandle
    ? zh
      ? `通过 \`hub_board_post\` 在团队协作板发布交接动态，提及 \`@${cleanHandle}\`，附上 \`${workItem.code}\`、新建的 Issue \`#<issueNumber>\` 链接与建议开发分支名。`
      : `Post a Team Board handoff via \`hub_board_post\` mentioning \`@${cleanHandle}\` with \`${workItem.code}\`, the created Issue \`#<issueNumber>\` link, and the branch name to start development.`
    : zh
      ? `通过 \`hub_board_post\` 在团队协作板发布更新，附上 \`${workItem.code}\` 与新建的 Issue \`#<issueNumber>\` 链接，方便研发认领。`
      : `Post a Team Board update via \`hub_board_post\` with \`${workItem.code}\` and the created Issue \`#<issueNumber>\` link so an engineer can pick it up.`;

  const template = resolveTemplate("issue_dispatch", project, locale, customTemplate);
  return renderPromptTemplate(template, {
    code: workItem.code,
    title: workItem.title,
    workItemId: workItem.id,
    metadata: `Metadata: type=${workItem.itemType}, priority=${workItem.priority.toUpperCase()}, designTier=${lifecycle.designTier}, workItemId=${workItem.id}`,
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    repo: repoFullName ?? "",
    repoLine: repoFullName ? `${zh ? "目标仓库：" : "Target Repository: "}${repoFullName}` : "",
    assignee: assigneeText,
    assigneeLine: assigneeText ? `${zh ? "指派负责人：" : "Assignee: "}${assigneeText}` : "",
    schedule,
    scheduleLine: schedule ? `${zh ? "排期：" : "Schedule: "}${schedule}` : "",
    prototypeUrl: lifecycle.prototypeUrl ?? "",
    prototypeLine: lifecycle.prototypeUrl
      ? `${zh ? "原型地址：" : "Prototype URL: "}${lifecycle.prototypeUrl}`
      : "",
    issueLine,
    spec: trimmedSpec,
    specSection: trimmedSpec ? `\n${zh ? "## PRD 摘要" : "## PRD Summary"}\n${trimmedSpec}` : "",
    checklist: checklist.raw,
    checklistSection: checklist.section,
    directives: directives.raw,
    directivesSection: directives.section,
    labels: labels.join(", "),
    labelsFormatted: labels.map((label) => `\`${label}\``).join(", "),
    labelsJson: JSON.stringify(labels),
    branch: suggestedBranch,
    ghCommand,
    boardHandoffInstruction,
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function buildRepoGovernanceBootstrapPrompt(input: {
  readonly project?: Project | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly topology?: BranchTopology | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const { project, repoFullName, topology = "dual_trunk", memory, locale, customTemplate } = input;
  const zh = isChineseLocale(locale);
  const isDualTrunk = topology === "dual_trunk";
  const directives = formatDirectivesBlock(memory, zh);
  const topologyLabel = isDualTrunk
    ? zh
      ? "标准双主干（main + dev + release/* + hotfix/*）"
      : "Standard Dual-Trunk (main + dev + release/* + hotfix/*)"
    : zh
      ? "轻量单主干（main + feat/*）"
      : "Lite Single-Trunk (main + feat/*)";

  const ciWorkflowBullets = isDualTrunk
    ? zh
      ? [
          "   - `pr-dev.yml`：面向 `dev` 的快速 lint、类型检查与单测门禁。",
          "   - `pr-main.yml`：面向 `main` 的完整发布/热修验证门禁。",
          "   - `sync-main-to-dev.yml`：自动发起 `main -> dev` 回合并 PR，强制使用 Merge commit（严禁 Squash）。",
        ].join("\n")
      : [
          "   - `pr-dev.yml`: fast lint, typecheck, and unit tests for task PRs targeting `dev`.",
          "   - `pr-main.yml`: full release/hotfix verification gates for PRs targeting `main`.",
          "   - `sync-main-to-dev.yml`: automated back-merge PR from `main` to `dev` using Merge commit (never Squash merge `main -> dev`).",
        ].join("\n")
    : zh
      ? "   - `pr-main.yml`：面向 `main` 的 lint、类型检查与测试门禁。"
      : "   - `pr-main.yml`: lint, typecheck, and test verification gates for task PRs targeting `main`.";

  const rulesetBullet = isDualTrunk
    ? zh
      ? "核对 `main`（`release/*`/`hotfix/*` 使用 Merge commit，不可变 `v*` 标签规则集）与 `dev`（任务分支 Squash 合并，`main -> dev` 回合并使用 Merge commit）。"
      : "Verify `main` (Merge commit for `release/*`/`hotfix/*`, immutable `v*` tag ruleset) and `dev` (Squash merge for task branches, Merge commit for `main -> dev` back-merges)."
    : zh
      ? "核对 `main`（强制 PR + CI，任务分支 Squash 合并，不可变 `v*` 标签规则集）。"
      : "Verify `main` (PR + CI required, Squash merge for task branches, immutable `v*` tag ruleset).";

  const template = resolveTemplate("repo_governance", project, locale, customTemplate);
  return renderPromptTemplate(template, {
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    repo: repoFullName ?? "",
    repoLine: repoFullName ? `${zh ? "目标仓库：" : "Target Repository: "}${repoFullName}` : "",
    topologyLabel,
    ciWorkflowBullets,
    rulesetBullet,
    directives: directives.raw,
    directivesSection: directives.section,
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function buildPullRequestActionPrompt(input: {
  readonly mode: PullRequestActionMode;
  readonly changeRequest: ChangeRequestAudit;
  readonly linkedWorkItem?: WorkItem | null | undefined;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly topology?: BranchTopology | undefined;
  readonly locale?: string | null | undefined;
  readonly customTemplate?: string | null | undefined;
}): string {
  const {
    mode,
    changeRequest: cr,
    linkedWorkItem,
    project,
    memory,
    topology,
    locale,
    customTemplate,
  } = input;
  const zh = isChineseLocale(locale);
  const strategy = recommendPrMergeStrategy({
    headBranch: cr.headBranch,
    baseBranch: cr.baseBranch,
    ...(topology ? { topology } : {}),
  });
  const totalChangedLines = cr.additions + cr.deletions;
  const isOverLineBudget = totalChangedLines > PR_LINE_BUDGET;
  const linkedLifecycle = linkedWorkItem ? readWorkItemLifecycle(linkedWorkItem) : null;
  const directives = formatDirectivesBlock(memory, zh);
  const checklist = linkedWorkItem
    ? formatChecklistBlock(linkedWorkItem, zh)
    : { raw: "", section: "" };
  const trimmedSpec = linkedWorkItem?.specMarkdown.trim() ?? "";

  const prRef = `${cr.repoFullName}#${cr.number}`;
  const prDiff = `+${cr.additions}/-${cr.deletions}`;

  const prHeading =
    mode === "fix"
      ? `Fix Review & CI Blockers for PR ${prRef}: ${cr.title}`
      : mode === "audit_and_comment"
        ? `Auto-Audit & Review Pull Request ${prRef}: ${cr.title}`
        : `Review Pull Request ${prRef}: ${cr.title}`;

  const reviewFindingsRaw = cr.automatedReview.reviewers
    .map((finding) => `- ${finding.reviewerName} [${finding.state}]: ${finding.bodyExcerpt}`)
    .join("\n");
  const reviewFindingsSection = reviewFindingsRaw
    ? `\n${zh ? "## 自动评审意见" : "## Automated Reviewer Findings"}\n${reviewFindingsRaw}`
    : "";

  const mergeMethodSummary =
    strategy.method === "merge_commit"
      ? `Merge commit -> ${cr.baseBranch} (${strategy.ruleLabel})${strategy.isBackMerge ? (zh ? "（严禁对回合并到 dev 使用 Squash！）" : " (NEVER squash back-merges into dev!)") : ""}`
      : `Squash -> ${cr.baseBranch} (${strategy.ruleLabel})`;

  const diffBudgetSummary = isOverLineBudget
    ? zh
      ? `变更 ${totalChangedLines} 行（超过 <= ${PR_LINE_BUDGET} 行护栏，请评估是否应拆分为多个小 PR）`
      : `${totalChangedLines} changed lines (exceeds <= ${PR_LINE_BUDGET} lines guardrail; check if this PR should be split)`
    : zh
      ? `变更 ${totalChangedLines} 行（符合 <= ${PR_LINE_BUDGET} 行护栏）`
      : `${totalChangedLines} changed lines (within <= ${PR_LINE_BUDGET} lines guardrail)`;

  const issueCheckSummary = linkedWorkItem
    ? linkedLifecycle?.githubIssueNumber !== null &&
      linkedLifecycle?.githubIssueNumber !== undefined
      ? zh
        ? `已关联 [${linkedWorkItem.code}] 与 GitHub Issue #${linkedLifecycle.githubIssueNumber}`
        : `Linked to [${linkedWorkItem.code}] and GitHub Issue #${linkedLifecycle.githubIssueNumber}`
      : zh
        ? `已关联 [${linkedWorkItem.code}]（请核对 PR 描述是否包含 Closes/Refs # Issue 链接）`
        : `Linked to [${linkedWorkItem.code}] (verify PR body links the GitHub Issue via Closes/Refs #)`
    : zh
      ? "未检测到关联工作项（请核对 PR 描述是否关联 GitHub Issue 或说明独立变更原因）"
      : "No linked Work Item detected (verify PR body references a GitHub Issue or explain why it is standalone)";

  const prInstructions =
    mode === "fix"
      ? zh
        ? `检查分支 \`${cr.headBranch}\`，复现并修复上述每条阻塞的自动评审意见或 CI 问题，跑通验证测试并总结修复内容。尽量控制变更在 <= ${PR_LINE_BUDGET} 行以内。若存在关联工作项，请调用 \`team_hub_publish_pulse\` 同步进展，并通过 \`hub_board_post\` 在团队协作板汇报。`
        : `Inspect branch \`${cr.headBranch}\`, reproduce and resolve every blocking automated review comment or CI issue above, verify with tests, and summarize the fix. Keep changes scoped within the <= ${PR_LINE_BUDGET} lines guardrail where practical. If a linked WorkItem exists, publish a short pulse via \`team_hub_publish_pulse\` and post a concise update on the Team Board via \`hub_board_post\`.`
      : mode === "audit_and_comment"
        ? zh
          ? [
              `1. 使用 \`gh pr diff ${cr.number} --repo ${cr.repoFullName}\` 审阅 PR #${cr.number}（\`${cr.headBranch}\` -> \`${cr.baseBranch}\`），重点检查正确性、边界条件、安全性、测试覆盖、<= ${PR_LINE_BUDGET} 行范围、关联 Issue 以及合并策略（\`${strategy.method}\`）。`,
              `2. 使用 \`gh pr review ${cr.number} --repo ${cr.repoFullName}\` 直接在 GitHub 提交结构化评审：无阻塞时使用 \`--approve\`，存在缺陷时使用 \`--request-changes\`，一般建议用 \`--comment\`。`,
              `3. 通过 \`hub_board_post\` 在团队协作板发布简明审核结论，提及 \`@${cr.authorVcsLogin}\`${linkedWorkItem ? ` 并关联 \`${linkedWorkItem.code}\`` : ""}。`,
            ].join("\n")
          : [
              `1. Inspect PR #${cr.number} (\`${cr.headBranch}\` -> \`${cr.baseBranch}\`) with \`gh pr diff ${cr.number} --repo ${cr.repoFullName}\` and audit correctness, edge cases, security, tests, <= ${PR_LINE_BUDGET} lines scope, linked Issue reference, and merge strategy (\`${strategy.method}\`).`,
              `2. Submit your structured review directly on GitHub using \`gh pr review ${cr.number} --repo ${cr.repoFullName}\` with \`--approve\` (when ready), \`--request-changes\` (when blocking defects exist), or \`--comment\` (for non-blocking observations).`,
              `3. Post a concise audit summary on the Team Board via \`hub_board_post\` mentioning \`@${cr.authorVcsLogin}\`${linkedWorkItem ? ` and referencing \`${linkedWorkItem.code}\`` : ""}.`,
            ].join("\n")
        : zh
          ? `审阅 PR #${cr.number}（\`${cr.headBranch}\` -> \`${cr.baseBranch}\`），检查代码正确性、边界情况、项目锁定红线指令、<= ${PR_LINE_BUDGET} 行约束与验收标准，并给出简洁可执行的评审意见。`
          : `Inspect PR #${cr.number} (\`${cr.headBranch}\` -> \`${cr.baseBranch}\`), review correctness, edge cases, adherence to the locked project directives, <= ${PR_LINE_BUDGET} lines discipline, and acceptance criteria, then provide concise actionable review feedback.`;

  const slot: CockpitPromptSlot = mode === "fix" ? "pr_fix" : "pr_audit";
  const template = resolveTemplate(slot, project, locale, customTemplate);

  return renderPromptTemplate(template, {
    prHeading,
    prRef,
    prTitle: cr.title,
    prUrl: cr.url,
    headBranch: cr.headBranch,
    baseBranch: cr.baseBranch,
    baseBranchRole: cr.baseBranchRole,
    prAuthor: cr.authorVcsLogin,
    prDiff,
    ciStatus: cr.qualitySignals.ciStatus,
    project: project ? `${project.key} (${project.name})` : "",
    projectLine: project
      ? `${zh ? "所属项目：" : "Hub Project: "}${project.key} (${project.name})`
      : "",
    linkedWorkItemLine: linkedWorkItem
      ? `${zh ? "关联工作项：" : "Linked Work Item: "}[${linkedWorkItem.code}] ${linkedWorkItem.title} (workItemId=${linkedWorkItem.id})`
      : "",
    spec: trimmedSpec,
    specSection: trimmedSpec
      ? `\n${zh ? "## 关联需求规格" : "## Linked Specification"}\n${trimmedSpec}`
      : "",
    checklist: checklist.raw,
    checklistSection: checklist.section,
    reviewFindings: reviewFindingsRaw,
    reviewFindingsSection,
    directives: directives.raw,
    directivesSection: directives.section,
    mergeStrategy: mergeMethodSummary,
    diffBudget: diffBudgetSummary,
    issueCheck: issueCheckSummary,
    prInstructions,
    responseLanguage: resolvePromptLanguageName(locale),
  });
}

export function previewCockpitPromptSlot(input: {
  readonly slot: CockpitPromptSlot;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repoFullName?: string | null | undefined;
  readonly locale?: string | null | undefined;
  readonly templateOverride?: string | null | undefined;
}): string {
  const { slot, project, memory, repoFullName, locale, templateOverride } = input;
  const zh = isChineseLocale(locale);
  const projectKey = project?.key ?? "CORE";
  const sampleRepo = repoFullName ?? "org/app";
  const nowIso = "2026-11-27T00:00:00.000Z";
  const sampleWorkItem: WorkItem = {
    id: "wi_sample_preview",
    projectId: project?.id ?? "prj_sample",
    seqNo: 1,
    code: `${projectKey}-1`,
    // oxlint-disable-next-line t3code/no-untranslated-copy -- sample agent prompt preview fixture
    title: zh ? "支持多语言与团队自定义提示词模板" : "Support multilingual team prompt templates",
    itemType: "feature",
    priority: "p1",
    stage: "scoping",
    health: "on_track",
    assigneeType: "human",
    assigneeUserId: "usr_demo",
    assigneeRunnerId: null,
    specMarkdown: zh
      ? "允许团队按项目配置 PRD、原型、Issue、开发分支与 PR 审核模板，并随界面语言自动切换。"
      : "Allow teams to customize per-project prompt templates across the delivery lifecycle with automatic locale adaptation.",
    specUrl: null,
    previewUrls: [],
    checklistItems: [
      {
        id: "AC-1",
        text: zh
          ? // oxlint-disable-next-line t3code/no-untranslated-copy -- sample agent prompt preview fixture
            "中文界面默认生成中文 Prompt 并要求中文输出"
          : // oxlint-disable-next-line t3code/no-untranslated-copy -- sample agent prompt preview fixture
            "Default prompts adapt to active UI locale",
        verified: false,
      },
    ],
    attributes: {
      plannedStartAt: "2026-11-27",
      dueAt: "2026-12-02",
      designTier: "medium",
      branchTopology: "dual_trunk",
    },
    createdBy: "usr_demo",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const sampleCr: ChangeRequestAudit = {
    id: "cr_sample_preview",
    forgeKind: "github",
    repoFullName: sampleRepo,
    number: 101,
    workItemId: sampleWorkItem.id,
    title: `feat(cockpit): ${sampleWorkItem.code} ${sampleWorkItem.title}`,
    url: `https://github.com/${sampleRepo}/pull/101`,
    headBranch: `feat/101-prompt-templates`,
    baseBranch: "dev",
    baseBranchRole: "integration",
    headSha: "abc1234",
    authorVcsLogin: "alice-dev",
    state: "open",
    additions: 148,
    deletions: 24,
    isOversized: false,
    automatedReview: {
      status: "blocking",
      blockingCount: 1,
      reviewers: [
        {
          reviewerName: "dotsbot[bot]",
          state: "changes_requested",
          riskLevel: "medium",
          bodyExcerpt: zh
            ? "保存空模板时应清理对应键，避免覆盖默认多语言模板。"
            : "Strip blank template overrides on save so localized defaults continue to apply.",
          updatedAt: nowIso,
        },
      ],
    },
    qualitySignals: { ciStatus: "success", signals: {} },
    humanReviewState: "pending",
    triageBucket: "bot_blocked",
    mergedAt: null,
    updatedAt: nowIso,
  };

  switch (slot) {
    case "prd":
      return buildPrdGenerationPrompt({
        workItem: sampleWorkItem,
        project,
        memory,
        repoFullName: sampleRepo,
        locale,
        customTemplate: templateOverride,
      });
    case "prototype":
      return buildPrototypeGenerationPrompt({
        workItem: sampleWorkItem,
        project,
        memory,
        repoFullName: sampleRepo,
        locale,
        customTemplate: templateOverride,
      });
    case "issue_dispatch":
      return buildIssueDispatchPrompt({
        workItem: sampleWorkItem,
        project,
        memory,
        repoFullName: sampleRepo,
        assigneeHandle: "alice-dev",
        assigneeDisplayName: "Alice Chen",
        locale,
        customTemplate: templateOverride,
      });
    case "dev_branch":
      return buildWorkItemThreadPrompt({
        workItem: sampleWorkItem,
        project,
        memory,
        repoFullName: sampleRepo,
        locale,
        customTemplate: templateOverride,
      });
    case "pr_audit":
      return buildPullRequestActionPrompt({
        mode: "audit_and_comment",
        changeRequest: sampleCr,
        linkedWorkItem: sampleWorkItem,
        project,
        memory,
        locale,
        customTemplate: templateOverride,
      });
    case "pr_fix":
      return buildPullRequestActionPrompt({
        mode: "fix",
        changeRequest: sampleCr,
        linkedWorkItem: sampleWorkItem,
        project,
        memory,
        locale,
        customTemplate: templateOverride,
      });
    case "repo_governance":
      return buildRepoGovernanceBootstrapPrompt({
        project,
        memory,
        repoFullName: sampleRepo,
        locale,
        customTemplate: templateOverride,
      });
  }
}
