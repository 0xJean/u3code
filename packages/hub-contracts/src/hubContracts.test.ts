import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  ArtifactStatus,
  BranchTopology,
  DEFAULT_REPO_POLICY,
  DesignTier,
  HubWsEvent,
  PipelinePhase,
  PulseCreateInput,
  RepoPolicy,
  TeamBoardCreateInput,
  TeamBoardListResponse,
  TeamBoardMessage,
  WORKFLOW_PRESETS,
  WorkItemLifecycleMeta,
  WorkflowConfig,
  buildLifecycleAttributesPatch,
  createWorkflowConfigFromPreset,
  deriveWorkItemPipelinePhase,
  extractBoardMentions,
  isGateCurrentlyApproved,
  readWorkItemLifecycle,
  recommendPrMergeStrategy,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  standardGitHubLabels,
  suggestWorkItemBranchName,
} from "./index.ts";

const decodeDesignTier = Schema.decodeSync(DesignTier);
const decodeBranchTopology = Schema.decodeSync(BranchTopology);
const decodeArtifactStatus = Schema.decodeSync(ArtifactStatus);
const decodePipelinePhase = Schema.decodeSync(PipelinePhase);
const decodeWorkItemLifecycleMeta = Schema.decodeSync(WorkItemLifecycleMeta);

describe("hub-contracts schemas and presets", () => {
  it("decodes built-in workflow presets cleanly", () => {
    const decodeWorkflow = Schema.decodeUnknownSync(WorkflowConfig);
    const lean = decodeWorkflow(WORKFLOW_PRESETS.lean);
    const full = decodeWorkflow(WORKFLOW_PRESETS["full-delivery"]);

    expect(lean.stages.map((s) => s.id)).toEqual(["backlog", "in_progress", "review", "done"]);
    expect(lean.gates).toHaveLength(0);
    expect(full.stages.length).toBe(8);
    expect(full.gates.map((g) => g.key)).toContain("prod_go");
  });

  it("clones presets safely without mutating defaults", () => {
    const custom = createWorkflowConfigFromPreset("full-delivery", {
      progressLedgers: [{ repoFullName: "org/nexus-go", path: "docs/nexus-migration.yaml" }],
    });
    expect(custom.progressLedgers).toHaveLength(1);
    expect(WORKFLOW_PRESETS["full-delivery"].progressLedgers).toHaveLength(0);
  });

  it("decodes generic repo policy supporting multiple bots and branch tiers", () => {
    const decodePolicy = Schema.decodeUnknownSync(RepoPolicy);
    const decoded = decodePolicy({
      ...DEFAULT_REPO_POLICY,
      branches: [
        { name: "dev", role: "integration", mergePolicy: "auto_on_low_risk" },
        { name: "main", role: "release", mergePolicy: "manual" },
      ],
      automatedReviewers: [
        {
          name: "Dotsbot",
          botLogins: ["dotsbot[bot]"],
          blockingStates: ["CHANGES_REQUESTED"],
        },
        {
          name: "CodeRabbit",
          botLogins: ["coderabbitai[bot]"],
          blockingStates: ["CHANGES_REQUESTED"],
        },
      ],
      qualitySignals: [
        {
          key: "diff_coverage",
          checkName: "ci/diff-coverage",
          pattern: "Diff Coverage:\\s*([0-9.]+)%",
          minValue: 75,
          unit: "%",
        },
      ],
    });

    expect(decoded.branches).toHaveLength(2);
    expect(decoded.automatedReviewers).toHaveLength(2);
    expect(decoded.qualitySignals[0]?.minValue).toBe(75);
  });

  it("validates pulse inputs and ws events", () => {
    const decodePulse = Schema.decodeUnknownSync(PulseCreateInput);
    const pulse = decodePulse({
      doneSummary: "Refactored auth middleware",
      decisions: ["Use stateless JWT"],
      blockers: [{ text: "Confirm legacy token TTL", needsAttentionRoles: ["owner"] }],
    });
    expect(pulse.blockers).toHaveLength(1);

    const decodeEvent = Schema.decodeUnknownSync(HubWsEvent);
    const event = decodeEvent({
      type: "change_request.updated",
      workspaceId: "ws_1",
      projectId: "prj_1",
      repoFullName: "org/nexus-go",
      number: 42,
      triageBucket: "bot_blocked",
      blockingCount: 1,
    });
    expect(event.type).toBe("change_request.updated");
  });

  it("resolves latest gate approval status chronologically (rejection revokes earlier approval)", () => {
    const history = [
      {
        id: "gat_1",
        targetType: "work_item" as const,
        targetId: "wi_1",
        gateKey: "qa_ac_pass",
        status: "approved" as const,
        approvedBy: "usr_qa",
        note: "Initial pass",
        evidenceUrls: [],
        createdAt: "2026-11-27T01:00:00.000Z",
      },
      {
        id: "gat_2",
        targetType: "work_item" as const,
        targetId: "wi_1",
        gateKey: "qa_ac_pass",
        status: "rejected" as const,
        approvedBy: "usr_qa",
        note: "Regression on retry path",
        evidenceUrls: [],
        createdAt: "2026-11-27T02:00:00.000Z",
      },
    ];
    expect(isGateCurrentlyApproved(history, "qa_ac_pass")).toBe(false);
    expect(resolveLatestGateApprovals(history).get("qa_ac_pass")?.note).toBe(
      "Regression on retry path",
    );

    const reapproved = [
      ...history,
      {
        id: "gat_3",
        targetType: "work_item" as const,
        targetId: "wi_1",
        gateKey: "qa_ac_pass",
        status: "approved" as const,
        approvedBy: "usr_qa",
        note: "Fix verified",
        evidenceUrls: [],
        createdAt: "2026-11-27T03:00:00.000Z",
      },
    ];
    expect(isGateCurrentlyApproved(reapproved, "qa_ac_pass")).toBe(true);
  });

  it("extracts deduplicated lowercase board mentions and validates board schemas & ws events", () => {
    expect(
      extractBoardMentions(
        "@Alice please check (@bob_dev) with @dotsbot[bot], foo@bar.com, and @alice. Also @core-lead!",
      ),
    ).toEqual(["alice", "bob_dev", "dotsbot[bot]", "core-lead"]);

    const decodeInput = Schema.decodeUnknownSync(TeamBoardCreateInput);
    const input = decodeInput({
      workspaceId: "ws_1",
      projectId: "prj_1",
      body: "@alice ready for review on CORE-1",
      workItemId: "wi_1",
      workItemCode: "CORE-1",
    });
    expect(input.workspaceId).toBe("ws_1");

    const decodeMessage = Schema.decodeUnknownSync(TeamBoardMessage);
    const msg = decodeMessage({
      id: "bmsg_1",
      workspaceId: "ws_1",
      projectId: "prj_1",
      seq: 1,
      kind: "handoff",
      authorType: "human",
      authorUserId: "usr_1",
      authorHandle: "boss",
      authorDisplayName: "Tech Founder",
      mentions: ["alice"],
      body: "@alice ready for review on CORE-1",
      workItemId: "wi_1",
      workItemCode: "CORE-1",
      changeRequestId: null,
      changeRequestRef: null,
      createdAt: "2026-11-27T10:00:00.000Z",
    });

    const decodeList = Schema.decodeUnknownSync(TeamBoardListResponse);
    const list = decodeList({ messages: [msg], head: 1 });
    expect(list.head).toBe(1);
    expect(list.messages[0]?.kind).toBe("handoff");

    const decodeEvent = Schema.decodeUnknownSync(HubWsEvent);
    const boardEvent = decodeEvent({
      type: "board.message_created",
      workspaceId: "ws_1",
      projectId: "prj_1",
      messageId: "bmsg_1",
      seq: 1,
      authorHandle: "boss",
      mentions: ["alice"],
    });
    expect(boardEvent.type).toBe("board.message_created");
  });

  it("reads work item lifecycle metadata with sensible defaults and builds clean attribute patches", () => {
    expect(decodeDesignTier("cross_repo")).toBe("cross_repo");
    expect(decodeBranchTopology("dual_trunk")).toBe("dual_trunk");
    expect(decodeArtifactStatus("approved")).toBe("approved");
    expect(decodePipelinePhase("prototype")).toBe("prototype");

    const baseDefaults = readWorkItemLifecycle({
      itemType: "feature",
      priority: "p1",
      code: "CORE-1",
      title: "Lark interactive gate",
      specMarkdown: "",
      previewUrls: [],
      attributes: {},
    });
    expect(decodeWorkItemLifecycleMeta(baseDefaults)).toEqual({
      plannedStartAt: null,
      dueAt: null,
      prdStatus: "none",
      prototypeStatus: "none",
      prototypeUrl: null,
      designTier: "medium",
      designDocPath: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubLabels: ["type:feature", "priority:p1"],
      branchTopology: "dual_trunk",
      branchName: null,
      targetBranch: null,
    });

    const inferredFromArtifacts = readWorkItemLifecycle({
      itemType: "bug",
      priority: "p0",
      code: "CORE-2",
      title: "Fix retry loop",
      specMarkdown:
        "Detailed problem statement explaining root cause, reproduction steps, and acceptance criteria.",
      previewUrls: ["https://preview.example.com/core-2"],
      attributes: {
        githubIssueUrl: "https://github.com/acme/u3code/issues/101",
      },
    });
    expect(inferredFromArtifacts.prdStatus).toBe("draft");
    expect(inferredFromArtifacts.prototypeStatus).toBe("draft");
    expect(inferredFromArtifacts.prototypeUrl).toBe("https://preview.example.com/core-2");
    expect(inferredFromArtifacts.designTier).toBe("small");
    expect(inferredFromArtifacts.githubIssueNumber).toBe(101);
    expect(inferredFromArtifacts.githubLabels).toEqual(["type:bug", "priority:p0"]);

    expect(standardGitHubLabels("security", "p0")).toEqual(["type:hotfix", "priority:p0"]);
    expect(standardGitHubLabels("refactor", "p2")).toEqual(["type:feature", "priority:p2"]);
    expect(standardGitHubLabels("bug", "p3")).toEqual(["type:bug", "priority:p3"]);

    const patch = buildLifecycleAttributesPatch({
      plannedStartAt: "2026-11-27",
      dueAt: "2026-12-04",
      prdStatus: "approved",
      prototypeUrl: "  ",
      githubIssueNumber: 101,
      githubLabels: ["type:feature", "priority:p1", "type:feature", ""],
      branchTopology: "single_trunk",
    });
    expect(patch).toEqual({
      plannedStartAt: "2026-11-27",
      dueAt: "2026-12-04",
      prdStatus: "approved",
      prototypeUrl: null,
      githubIssueNumber: 101,
      githubLabels: ["type:feature", "priority:p1"],
      branchTopology: "single_trunk",
    });
    expect("branchName" in patch).toBe(false);
  });

  it("suggests github-team-workflow branch names and recommends PR merge strategies", () => {
    expect(
      suggestWorkItemBranchName({
        itemType: "feature",
        priority: "p1",
        code: "CORE-1",
        title: "Lark Interactive Gate",
        githubIssueNumber: 101,
      }),
    ).toBe("feat/101-lark-interactive-gate");

    expect(
      suggestWorkItemBranchName({
        itemType: "feature",
        priority: "p1",
        code: "CORE-1",
        title: "Lark Interactive Gate",
      }),
    ).toBe("feat/core-1-lark-interactive-gate");

    expect(
      suggestWorkItemBranchName({
        itemType: "security",
        priority: "p0",
        code: "SEC-9",
        title: "Fix JWT Replay Vulnerability Immediately Before Release Window",
      }),
    ).toBe("hotfix/sec-9-fix-jwt-replay-vulnerability-immedia");

    expect(
      suggestWorkItemBranchName({
        itemType: "bug",
        priority: "p0",
        code: "BUG-3",
        title: "Crash on boot",
        githubIssueNumber: 42,
      }),
    ).toBe("hotfix/42-crash-on-boot");

    expect(
      suggestWorkItemBranchName({
        itemType: "bug",
        priority: "p2",
        code: "BUG-4",
        title: "Fix retry jitter",
      }),
    ).toBe("fix/bug-4-fix-retry-jitter");

    expect(
      suggestWorkItemBranchName({
        itemType: "refactor",
        priority: "p2",
        code: "REF-7",
        title: "Split auth middleware",
      }),
    ).toBe("refactor/ref-7-split-auth-middleware");

    expect(
      suggestWorkItemBranchName({
        itemType: "chore",
        priority: "p3",
        code: "OPS-2",
        title: "实现甘特图视图",
      }),
    ).toBe("chore/ops-2");

    expect(recommendPrMergeStrategy({ headBranch: "main", baseBranch: "dev" })).toEqual({
      method: "merge_commit",
      ruleLabel: "Merge commit (preserve ancestry)",
      isBackMerge: true,
      isFreezeBranch: false,
    });

    expect(recommendPrMergeStrategy({ headBranch: "release/v1.4.0", baseBranch: "dev" })).toEqual({
      method: "merge_commit",
      ruleLabel: "Merge commit (preserve ancestry)",
      isBackMerge: true,
      isFreezeBranch: true,
    });

    expect(recommendPrMergeStrategy({ headBranch: "sync/main-to-dev", baseBranch: "dev" })).toEqual(
      {
        method: "merge_commit",
        ruleLabel: "Merge commit (preserve ancestry)",
        isBackMerge: true,
        isFreezeBranch: false,
      },
    );

    expect(recommendPrMergeStrategy({ headBranch: "release/v1.4.0", baseBranch: "main" })).toEqual({
      method: "merge_commit",
      ruleLabel: "Merge commit (release/hotfix -> main)",
      isBackMerge: false,
      isFreezeBranch: true,
    });

    expect(recommendPrMergeStrategy({ headBranch: "hotfix/42-crash", baseBranch: "main" })).toEqual(
      {
        method: "merge_commit",
        ruleLabel: "Merge commit (release/hotfix -> main)",
        isBackMerge: false,
        isFreezeBranch: false,
      },
    );

    expect(
      recommendPrMergeStrategy({ headBranch: "feat/101-lark-gate", baseBranch: "dev" }),
    ).toEqual({
      method: "squash",
      ruleLabel: "Squash merge (task branch)",
      isBackMerge: false,
      isFreezeBranch: false,
    });

    expect(
      recommendPrMergeStrategy({ headBranch: "fix/102-bug", baseBranch: "release/v1.4.0" }),
    ).toEqual({
      method: "squash",
      ruleLabel: "Squash merge (task branch)",
      isBackMerge: false,
      isFreezeBranch: true,
    });
  });

  it("derives 7-phase delivery funnel and resolves Gantt schedules with overdue detection", () => {
    const makeWorkItem = (overrides: Record<string, unknown> = {}) => ({
      id: "wi_1",
      projectId: "prj_1",
      seqNo: 1,
      code: "CORE-1",
      title: "End-to-end delivery",
      itemType: "feature" as const,
      priority: "p1" as const,
      stage: "scoping",
      health: "on_track" as const,
      assigneeType: "unassigned" as const,
      assigneeUserId: null,
      assigneeRunnerId: null,
      specMarkdown: "",
      specUrl: null,
      previewUrls: [] as string[],
      checklistItems: [],
      attributes: {} as Record<string, unknown>,
      createdBy: "usr_1",
      createdAt: "2026-11-20T10:00:00.000Z",
      updatedAt: "2026-11-20T10:00:00.000Z",
      ...overrides,
    });

    expect(deriveWorkItemPipelinePhase({ workItem: makeWorkItem(), changeRequests: [] })).toBe(
      "intake",
    );
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({
          specMarkdown: "Full PRD specification exceeding forty characters for phase inference.",
        }),
        changeRequests: [],
      }),
    ).toBe("prd");
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({
          previewUrls: ["https://proto.example.com"],
        }),
        changeRequests: [],
      }),
    ).toBe("prototype");
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({ stage: "dev" }),
        changeRequests: [],
      }),
    ).toBe("dev");
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({ stage: "dev" }),
        changeRequests: [
          {
            id: "cr_1",
            forgeKind: "github",
            repoFullName: "acme/u3code",
            number: 12,
            workItemId: "wi_1",
            title: "feat: delivery",
            url: "https://github.com/acme/u3code/pull/12",
            headBranch: "feat/core-1-delivery",
            baseBranch: "dev",
            baseBranchRole: "integration",
            headSha: "abc123",
            authorVcsLogin: "alice",
            state: "open",
            additions: 120,
            deletions: 30,
            isOversized: false,
            automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
            qualitySignals: { ciStatus: "success", signals: {} },
            humanReviewState: "pending",
            triageBucket: "ready_for_human_review",
            mergedAt: null,
            updatedAt: "2026-11-21T00:00:00.000Z",
          },
        ],
      }),
    ).toBe("review");
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({ stage: "staging" }),
        changeRequests: [],
      }),
    ).toBe("release");
    expect(
      deriveWorkItemPipelinePhase({
        workItem: makeWorkItem({ stage: "done" }),
        changeRequests: [],
      }),
    ).toBe("done");

    expect(
      resolveWorkItemSchedule(makeWorkItem({ priority: "p0" }), "2026-11-23T00:00:00Z"),
    ).toEqual({
      startDate: "2026-11-20",
      dueDate: "2026-11-22",
      isEstimated: true,
      isOverdue: true,
    });

    expect(
      resolveWorkItemSchedule(
        makeWorkItem({
          stage: "done",
          priority: "p0",
        }),
        "2026-11-27T00:00:00Z",
      ),
    ).toEqual({
      startDate: "2026-11-20",
      dueDate: "2026-11-22",
      isEstimated: true,
      isOverdue: false,
    });

    expect(
      resolveWorkItemSchedule(
        makeWorkItem({
          attributes: {
            plannedStartAt: "2026-11-25T09:00:00Z",
            dueAt: "2026-12-02",
          },
        }),
        "2026-11-27",
      ),
    ).toEqual({
      startDate: "2026-11-25",
      dueDate: "2026-12-02",
      isEstimated: false,
      isOverdue: false,
    });
  });
});
