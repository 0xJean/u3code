import type { ChangeRequestAudit, Project, ProjectMemory, WorkItem } from "@u3code/hub-contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildIssueDispatchPrompt,
  buildPrdGenerationPrompt,
  buildPrototypeGenerationPrompt,
  buildPullRequestActionPrompt,
  buildRepoGovernanceBootstrapPrompt,
  buildWorkItemThreadPrompt,
  findMatchingWorkspaceProject,
  pickMatchingWorkspaceProject,
} from "./workItemPrompt";

const sampleWorkItem: WorkItem = {
  id: "wi_42",
  projectId: "prj_1",
  seqNo: 42,
  code: "CORE-42",
  title: "Idempotent settlement outbox",
  itemType: "feature",
  priority: "p0",
  stage: "dev",
  health: "on_track",
  assigneeType: "unassigned",
  assigneeUserId: null,
  assigneeRunnerId: null,
  specMarkdown: "Use transactional outbox table.",
  specUrl: null,
  previewUrls: [],
  checklistItems: [
    { id: "AC-1", text: "Duplicate events ignored", verified: true },
    { id: "AC-2", text: "Retry backoff bounded", verified: false },
  ],
  attributes: {},
  createdBy: "usr_1",
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

const sampleMemory: ProjectMemory = {
  id: "mem_1",
  projectId: "prj_1",
  version: 2,
  architectureDecisions: [
    {
      id: "adr_1",
      date: "2026-11-27",
      repoFullName: "acme/nexus-go",
      summary: "Transactional outbox",
      rationale: "Guarantees at-least-once delivery.",
      sourceRef: null,
    },
  ],
  moduleMap: [],
  recurringRisks: [
    {
      id: "risk_1",
      title: "Duplicate webhook replay",
      severity: "high",
      occurrences: 2,
      mitigation: "Enforce unique idempotency key index.",
      active: true,
    },
  ],
  directives: [
    {
      id: "d1",
      text: "Never auto-merge main.",
      createdBy: "usr_1",
      createdAt: "2026-11-27T00:00:00.000Z",
      active: true,
    },
    {
      id: "d2",
      text: "Old inactive rule.",
      createdBy: "usr_1",
      createdAt: "2026-11-27T00:00:00.000Z",
      active: false,
    },
  ],
  updatedBy: "usr_1",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

const sampleProject: Project = {
  id: "prj_1",
  workspaceId: "ws_1",
  key: "CORE",
  name: "Core Settlement",
  description: "Settlement platform",
  status: "active",
  workflowConfig: {
    preset: "lean",
    stages: [],
    gates: [],
  },
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

const sampleChangeRequest: ChangeRequestAudit = {
  id: "cr_101",
  forgeKind: "github",
  repoFullName: "acme/nexus-go",
  number: 101,
  workItemId: "wi_42",
  title: "feat(outbox): add idempotent settlement relay",
  url: "https://github.com/acme/nexus-go/pull/101",
  headBranch: "feat/CORE-42-outbox",
  baseBranch: "main",
  baseBranchRole: "release",
  headSha: "abc123def456",
  authorVcsLogin: "alice",
  state: "open",
  additions: 240,
  deletions: 18,
  isOversized: false,
  automatedReview: {
    status: "blocking",
    blockingCount: 1,
    reviewers: [
      {
        reviewerName: "dotsbot[bot]",
        state: "changes_requested",
        riskLevel: "high",
        bodyExcerpt: "Missing idempotency key unique index on outbox_events.",
        updatedAt: "2026-11-27T01:00:00.000Z",
      },
    ],
  },
  qualitySignals: {
    ciStatus: "failure",
    signals: {},
  },
  humanReviewState: "pending",
  triageBucket: "bot_blocked",
  mergedAt: null,
  updatedAt: "2026-11-27T01:00:00.000Z",
};

describe("workItemPrompt", () => {
  it("matches local workspace project by linked hub repository name", () => {
    const localProjects = [
      { id: "p1", title: "admin-web", workspaceRoot: "/work/admin-web" },
      { id: "p2", title: "backend", workspaceRoot: "/work/nexus-go" },
    ];
    const hubRepos = [
      {
        id: "r1",
        projectId: "prj_1",
        forgeKind: "github" as const,
        repoFullName: "acme/nexus-go",
        tags: [],
        repoPolicy: {
          branches: [],
          automatedReviewers: [],
          qualitySignals: [],
          maxPrChangedLines: 500,
          environments: {},
        },
        createdAt: "2026-11-27T00:00:00.000Z",
      },
    ];
    expect(pickMatchingWorkspaceProject(localProjects, hubRepos)?.id).toBe("p2");
    expect(
      findMatchingWorkspaceProject(localProjects, [{ repoFullName: "acme/unknown" }]),
    ).toBeNull();
    expect(
      pickMatchingWorkspaceProject(localProjects, [{ repoFullName: "acme/unknown" }])?.id,
    ).toBe("p1");
  });

  it("formats spec, ACs, branch cut command, guardrails, and Team Hub sync hints", () => {
    const richWorkItem: WorkItem = {
      ...sampleWorkItem,
      previewUrls: ["https://preview.example.com/core-42"],
      attributes: {
        githubIssueNumber: 88,
        githubIssueUrl: "https://github.com/acme/nexus-go/issues/88",
        prototypeUrl: "https://preview.example.com/core-42",
      },
    };
    const prompt = buildWorkItemThreadPrompt({
      workItem: richWorkItem,
      memory: sampleMemory,
    });

    expect(prompt).toContain("[CORE-42] Idempotent settlement outbox");
    expect(prompt).toContain("Use transactional outbox table.");
    expect(prompt).toContain("- [x] AC-1: Duplicate events ignored");
    expect(prompt).toContain("- [ ] AC-2: Retry backoff bounded");
    expect(prompt).toContain("Never auto-merge main.");
    expect(prompt).not.toContain("Old inactive rule.");
    expect(prompt).toContain("git fetch origin dev && git switch --no-track -c");
    expect(prompt).toContain("FETCH_HEAD^{commit}");
    expect(prompt).toContain("https://preview.example.com/core-42");
    expect(prompt).toContain("Closes #88");
    expect(prompt).toContain("<= 400 changed lines");
    expect(prompt).toContain("Conventional Commits");
    expect(prompt).toContain("team_hub_update_work_item");
    expect(prompt).toContain("team_hub_publish_pulse");
    expect(prompt).toContain("hub_board_post");
    expect(prompt).toContain("wi_42");
  });

  it("switches branch cut base to origin main for single-trunk topology", () => {
    const prompt = buildWorkItemThreadPrompt({
      workItem: sampleWorkItem,
      topology: "single_trunk",
    });

    expect(prompt).toContain("git fetch origin main && git switch --no-track -c");
    expect(prompt).toContain("Branch topology: `single_trunk`");
  });

  it("builds a structured PRD generation prompt with design tier guidance and hub sync", () => {
    const prompt = buildPrdGenerationPrompt({
      workItem: sampleWorkItem,
      project: sampleProject,
      memory: sampleMemory,
    });

    expect(prompt).toContain("[CORE-42] Idempotent settlement outbox");
    expect(prompt).toContain("Hub Project: CORE (Core Settlement)");
    expect(prompt).toContain("Technical Design Tier");
    expect(prompt).toContain("`small`");
    expect(prompt).toContain("`medium`");
    expect(prompt).toContain("`large`");
    expect(prompt).toContain("`cross_repo`");
    expect(prompt).toContain("team_hub_update_work_item");
    expect(prompt).toContain('prdStatus: "draft"');
    expect(prompt).toContain("hub_board_post");
    expect(prompt).toContain("Transactional outbox");
    expect(prompt).toContain("Duplicate webhook replay");
    expect(prompt).not.toContain("Old inactive rule.");
  });

  it("builds a prototype generation prompt recording previewUrls and board handoff", () => {
    const prompt = buildPrototypeGenerationPrompt({
      workItem: sampleWorkItem,
      project: sampleProject,
      memory: sampleMemory,
    });

    expect(prompt).toContain("Build Interactive UI Prototype for [CORE-42]");
    expect(prompt).toContain("Use transactional outbox table.");
    expect(prompt).toContain("team_hub_update_work_item");
    expect(prompt).toContain("previewUrls");
    expect(prompt).toContain('prototypeStatus: "draft"');
    expect(prompt).toContain("prototypeUrl");
    expect(prompt).toContain("hub_board_post");
  });

  it("builds a GitHub issue dispatch prompt with standard labels, assignee, and board handoff", () => {
    const prompt = buildIssueDispatchPrompt({
      workItem: sampleWorkItem,
      project: sampleProject,
      repoFullName: "acme/nexus-go",
      assigneeHandle: "alice",
      assigneeDisplayName: "Alice Chen",
    });

    expect(prompt).toContain("gh issue create");
    expect(prompt).toContain('--repo "acme/nexus-go"');
    expect(prompt).toContain('--label "type:feature"');
    expect(prompt).toContain('--label "priority:p0"');
    expect(prompt).toContain('--assignee "alice"');
    expect(prompt).toContain("githubIssueNumber");
    expect(prompt).toContain("githubIssueUrl");
    expect(prompt).toContain("team_hub_update_work_item");
    expect(prompt).toContain("hub_board_post");
    expect(prompt).toContain("@alice");
  });

  it("builds a non-destructive repo governance bootstrap prompt for dual-trunk and single-trunk", () => {
    const dualPrompt = buildRepoGovernanceBootstrapPrompt({
      project: sampleProject,
      repoFullName: "acme/nexus-go",
      topology: "dual_trunk",
    });

    expect(dualPrompt).toContain("Standard Dual-Trunk");
    expect(dualPrompt).toContain("pr-dev.yml");
    expect(dualPrompt).toContain("pr-main.yml");
    expect(dualPrompt).toContain("sync-main-to-dev.yml");
    expect(dualPrompt).toContain("CODEOWNERS");
    expect(dualPrompt).toContain("AGENTS.md");
    expect(dualPrompt).toContain("<= 200 lines");
    expect(dualPrompt).toContain("init-labels.sh");
    expect(dualPrompt).toContain("type:hotfix");

    const singlePrompt = buildRepoGovernanceBootstrapPrompt({
      project: sampleProject,
      repoFullName: "acme/nexus-go",
      topology: "single_trunk",
    });

    expect(singlePrompt).toContain("Lite Single-Trunk");
    expect(singlePrompt).toContain("pr-main.yml");
    expect(singlePrompt).not.toContain("sync-main-to-dev.yml");
  });

  it("builds a PR fix prompt with bot findings, linked work item ACs, and active directives only", () => {
    const prompt = buildPullRequestActionPrompt({
      mode: "fix",
      changeRequest: sampleChangeRequest,
      linkedWorkItem: sampleWorkItem,
      project: sampleProject,
      memory: sampleMemory,
    });

    expect(prompt).toContain(
      "Fix Review & CI Blockers for PR acme/nexus-go#101: feat(outbox): add idempotent settlement relay",
    );
    expect(prompt).toContain("PR URL: https://github.com/acme/nexus-go/pull/101");
    expect(prompt).toContain("Branches: feat/CORE-42-outbox -> main (release)");
    expect(prompt).toContain("Author: @alice | Diff: +240/-18 | CI: failure");
    expect(prompt).toContain("Hub Project: CORE (Core Settlement)");
    expect(prompt).toContain("Linked Work Item: [CORE-42] Idempotent settlement outbox");
    expect(prompt).toContain("## Linked Specification\nUse transactional outbox table.");
    expect(prompt).toContain("- [x] AC-1: Duplicate events ignored");
    expect(prompt).toContain("- [ ] AC-2: Retry backoff bounded");
    expect(prompt).toContain("## Automated Reviewer Findings");
    expect(prompt).toContain(
      "- dotsbot[bot] [changes_requested]: Missing idempotency key unique index on outbox_events.",
    );
    expect(prompt).toContain("## Locked Project Directives");
    expect(prompt).toContain("- Never auto-merge main.");
    expect(prompt).not.toContain("Old inactive rule.");
    expect(prompt).toContain("Inspect branch `feat/CORE-42-outbox`");
    expect(prompt).toContain("team_hub_publish_pulse");
  });

  it("builds a concise PR review prompt when no linked work item or findings are present", () => {
    const cleanCr: ChangeRequestAudit = {
      ...sampleChangeRequest,
      workItemId: null,
      automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
      qualitySignals: { ciStatus: "success", signals: {} },
      triageBucket: "ready_for_human_review",
    };

    const prompt = buildPullRequestActionPrompt({
      mode: "review",
      changeRequest: cleanCr,
      linkedWorkItem: null,
      project: sampleProject,
      memory: sampleMemory,
    });

    expect(prompt).toContain(
      "Review Pull Request acme/nexus-go#101: feat(outbox): add idempotent settlement relay",
    );
    expect(prompt).toContain("CI: success");
    expect(prompt).not.toContain("## Linked Specification");
    expect(prompt).not.toContain("## Acceptance Criteria");
    expect(prompt).not.toContain("## Automated Reviewer Findings");
    expect(prompt).toContain("- Never auto-merge main.");
    expect(prompt).not.toContain("Old inactive rule.");
    expect(prompt).toContain("Inspect PR #101 (`feat/CORE-42-outbox` -> `main`)");
    expect(prompt).toContain("actionable review feedback");
  });

  it("builds an audit_and_comment PR prompt with merge strategy, >400 line guardrail, and gh pr review guidance", () => {
    const oversizedBackMerge: ChangeRequestAudit = {
      ...sampleChangeRequest,
      headBranch: "main",
      baseBranch: "dev",
      additions: 360,
      deletions: 90,
      isOversized: true,
    };

    const prompt = buildPullRequestActionPrompt({
      mode: "audit_and_comment",
      changeRequest: oversizedBackMerge,
      linkedWorkItem: sampleWorkItem,
      project: sampleProject,
      memory: sampleMemory,
    });

    expect(prompt).toContain("Auto-Audit & Review Pull Request acme/nexus-go#101");
    expect(prompt).toContain("Merge commit -> dev");
    expect(prompt).toContain("NEVER squash back-merges into dev!");
    expect(prompt).toContain("exceeds <= 400 lines guardrail");
    expect(prompt).toContain("gh pr review 101 --repo acme/nexus-go");
    expect(prompt).toContain("--approve");
    expect(prompt).toContain("--request-changes");
    expect(prompt).toContain("--comment");
    expect(prompt).toContain("hub_board_post");
    expect(prompt).toContain("@alice");
  });

  it("matches local workspace project by Hub project name when no repo is linked yet", () => {
    const localProjects = [
      { id: "p1", title: "server", workspaceRoot: "/repo/u3code/apps/server" },
      { id: "p2", title: "tabula", workspaceRoot: "/repo/tabula" },
    ];
    expect(
      pickMatchingWorkspaceProject(localProjects, [], { key: "JEAN1", name: "Tabula" })?.id,
    ).toBe("p2");
  });

  it("generates Simplified Chinese prompts when locale is zh and respects project custom prompt templates", () => {
    const zhPrd = buildPrdGenerationPrompt({
      workItem: sampleWorkItem,
      project: sampleProject,
      memory: sampleMemory,
      locale: "zh",
    });
    expect(zhPrd).toContain("撰写产品需求文档（PRD）");
    expect(zhPrd).toContain("简体中文");
    expect(zhPrd).toContain("同步回 Team Hub");

    const customProject: Project = {
      ...sampleProject,
      workflowConfig: {
        ...sampleProject.workflowConfig,
        promptTemplates: {
          prd: "【团队定制 PRD】任务 {{code}}：{{title}}（输出语言：{{responseLanguage}}）\n{{directives}}",
        },
      },
    };
    const customPrompt = buildPrdGenerationPrompt({
      workItem: sampleWorkItem,
      project: customProject,
      memory: sampleMemory,
      locale: "zh",
    });
    expect(customPrompt).toBe(
      "【团队定制 PRD】任务 CORE-42：Idempotent settlement outbox（输出语言：简体中文）\n- Never auto-merge main.",
    );
  });
});
