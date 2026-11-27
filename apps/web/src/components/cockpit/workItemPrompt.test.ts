import type { ChangeRequestAudit, Project, ProjectMemory, WorkItem } from "@u3code/hub-contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildPullRequestActionPrompt,
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
  architectureDecisions: [],
  moduleMap: [],
  recurringRisks: [],
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

  it("formats spec, ACs, active directives, and Team Hub sync hints into prompt", () => {
    const prompt = buildWorkItemThreadPrompt({
      workItem: sampleWorkItem,
      memory: sampleMemory,
    });

    expect(prompt).toContain("[CORE-42] Idempotent settlement outbox");
    expect(prompt).toContain("Use transactional outbox table.");
    expect(prompt).toContain("- [x] AC-1: Duplicate events ignored");
    expect(prompt).toContain("- [ ] AC-2: Retry backoff bounded");
    expect(prompt).toContain("Never auto-merge main.");
    expect(prompt).not.toContain("Old inactive rule.");
    expect(prompt).toContain("team_hub_update_work_item");
    expect(prompt).toContain("wi_42");
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
});
