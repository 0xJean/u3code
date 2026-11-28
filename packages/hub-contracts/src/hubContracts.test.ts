import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  AgileHorizon,
  ArtifactStatus,
  BranchTopology,
  CycleStatus,
  DEFAULT_REPO_POLICY,
  DesignTier,
  HubWsEvent,
  MilestoneStatus,
  MilestoneTone,
  PipelinePhase,
  ProjectCycle,
  ProjectMilestone,
  PulseCreateInput,
  RepoPolicy,
  STORY_POINT_SCALE,
  TeamBoardCreateInput,
  TeamBoardListResponse,
  TeamBoardMessage,
  WORKFLOW_PRESETS,
  WorkItemLifecycleMeta,
  WorkflowConfig,
  buildCycleBurnupSeries,
  buildLifecycleAttributesPatch,
  computeCycleProgress,
  computeMilestoneProgress,
  computeTeamVelocity,
  createWorkflowConfigFromPreset,
  deriveWorkItemPipelinePhase,
  extractBoardMentions,
  isGateCurrentlyApproved,
  readWorkItemLifecycle,
  recommendPrMergeStrategy,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  standardGitHubLabels,
  suggestNextCycleDraft,
  suggestWorkItemBranchName,
  type CockpitWorkItemCard,
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
      cycleId: null,
      milestoneId: null,
      roadmapHorizon: null,
      storyPoints: null,
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

  it("validates agile cycle/milestone schemas, clones them in presets, and patches lifecycle agile attributes including null clears", () => {
    const decodeHorizon = Schema.decodeSync(AgileHorizon);
    const decodeMilestoneStatus = Schema.decodeSync(MilestoneStatus);
    const decodeMilestoneTone = Schema.decodeSync(MilestoneTone);
    const decodeCycleStatus = Schema.decodeSync(CycleStatus);
    const decodeMilestone = Schema.decodeUnknownSync(ProjectMilestone);
    const decodeCycle = Schema.decodeUnknownSync(ProjectCycle);
    const decodeWorkflow = Schema.decodeUnknownSync(WorkflowConfig);

    expect(STORY_POINT_SCALE).toEqual([1, 2, 3, 5, 8, 13]);
    expect(decodeHorizon("now")).toBe("now");
    expect(decodeMilestoneStatus("active")).toBe("active");
    expect(decodeMilestoneTone("violet")).toBe("violet");
    expect(decodeCycleStatus("active")).toBe("active");

    const cycle = decodeCycle({
      id: "cyc_1",
      number: 1,
      name: "Cycle 1",
      goal: "Ship Agile planning",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      status: "active",
      capacityPoints: 24,
      completedPoints: null,
      completedAt: null,
    });
    const milestone = decodeMilestone({
      id: "mls_1",
      name: "Q4 Cockpit GA",
      description: "Core delivery cockpit launch",
      horizon: "now",
      status: "active",
      targetDate: "2026-12-15",
      colorTone: "primary",
      createdAt: "2026-11-01T00:00:00.000Z",
    });

    const cloned = createWorkflowConfigFromPreset("full-delivery", {
      cycles: [cycle],
      milestones: [milestone],
    });
    expect(decodeWorkflow(cloned).cycles).toEqual([cycle]);
    expect(decodeWorkflow(cloned).milestones).toEqual([milestone]);
    expect(WORKFLOW_PRESETS["full-delivery"].cycles).toBeUndefined();
    expect(WORKFLOW_PRESETS["full-delivery"].milestones).toBeUndefined();

    const parsedLifecycle = readWorkItemLifecycle({
      itemType: "feature",
      priority: "p1",
      code: "AGL-1",
      title: "Cycle burnup chart",
      specMarkdown: "",
      previewUrls: [],
      attributes: {
        cycleId: " cyc_1 ",
        milestoneId: " mls_1 ",
        roadmapHorizon: "next",
        storyPoints: "8",
      },
    });
    expect(parsedLifecycle.cycleId).toBe("cyc_1");
    expect(parsedLifecycle.milestoneId).toBe("mls_1");
    expect(parsedLifecycle.roadmapHorizon).toBe("next");
    expect(parsedLifecycle.storyPoints).toBe(8);

    const invalidLifecycle = readWorkItemLifecycle({
      itemType: "bug",
      priority: "p2",
      code: "AGL-2",
      title: "Edge validation",
      specMarkdown: "",
      previewUrls: [],
      attributes: {
        cycleId: "   ",
        milestoneId: 123,
        roadmapHorizon: "someday",
        storyPoints: 101,
      },
    });
    expect(invalidLifecycle.cycleId).toBeNull();
    expect(invalidLifecycle.milestoneId).toBeNull();
    expect(invalidLifecycle.roadmapHorizon).toBeNull();
    expect(invalidLifecycle.storyPoints).toBeNull();

    const zeroPoints = readWorkItemLifecycle({
      itemType: "chore",
      priority: "p3",
      code: "AGL-3",
      title: "Zero points invalid",
      specMarkdown: "",
      previewUrls: [],
      attributes: { storyPoints: 0 },
    });
    expect(zeroPoints.storyPoints).toBeNull();

    const patchSet = buildLifecycleAttributesPatch({
      cycleId: " cyc_1 ",
      milestoneId: " mls_1 ",
      roadmapHorizon: "now",
      storyPoints: 5,
    });
    expect(patchSet).toEqual({
      cycleId: "cyc_1",
      milestoneId: "mls_1",
      roadmapHorizon: "now",
      storyPoints: 5,
    });

    const patchClear = buildLifecycleAttributesPatch({
      cycleId: null,
      milestoneId: null,
      roadmapHorizon: null,
      storyPoints: null,
    });
    expect(patchClear).toEqual({
      cycleId: null,
      milestoneId: null,
      roadmapHorizon: null,
      storyPoints: null,
    });
    expect("dueAt" in patchClear).toBe(false);
  });

  it("computes cycle progress, burnup series, team velocity, milestone progress, and next cycle drafts deterministically", () => {
    const makeCard = (
      id: string,
      overrides: Partial<CockpitWorkItemCard["workItem"]> = {},
      changeRequests: CockpitWorkItemCard["changeRequests"] = [],
    ): CockpitWorkItemCard => ({
      workItem: {
        id,
        projectId: "prj_1",
        seqNo: 1,
        code: `AGL-${id}`,
        title: `Item ${id}`,
        itemType: "feature",
        priority: "p1",
        stage: "dev",
        health: "on_track",
        assigneeType: "unassigned",
        assigneeUserId: null,
        assigneeRunnerId: null,
        specMarkdown: "",
        specUrl: null,
        previewUrls: [],
        checklistItems: [],
        attributes: {},
        createdBy: "usr_1",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-05T00:00:00.000Z",
        ...overrides,
      },
      latestPulse: null,
      changeRequests,
      gateApprovals: [],
      checklistVerifiedCount: 0,
      checklistTotalCount: 0,
    });

    const activeCycle: ProjectCycle = {
      id: "cyc_2",
      number: 2,
      name: "Cycle 2",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      status: "active",
      capacityPoints: 20,
    };

    const cards: CockpitWorkItemCard[] = [
      makeCard("1", {
        stage: "done",
        updatedAt: "2026-11-03T15:00:00.000Z",
        attributes: { cycleId: "cyc_2", milestoneId: "mls_1", storyPoints: 5 },
      }),
      makeCard("2", {
        stage: "done",
        updatedAt: "2026-11-06T12:00:00.000Z",
        attributes: { cycleId: "cyc_2", milestoneId: "mls_1", storyPoints: 3 },
      }),
      makeCard("3", {
        stage: "dev",
        health: "on_track",
        attributes: { cycleId: "cyc_2", milestoneId: "mls_1", storyPoints: 8, dueAt: "2026-11-05" },
      }),
      makeCard("4", {
        stage: "prd",
        health: "blocked",
        attributes: {
          cycleId: "cyc_other",
          milestoneId: "mls_1",
          storyPoints: 5,
          dueAt: "2026-11-20",
        },
      }),
      makeCard("5", {
        stage: "review",
        attributes: { milestoneId: "mls_1", storyPoints: 3, dueAt: "2026-11-20" },
      }),
    ];

    const healthyProgress = computeCycleProgress(activeCycle, cards, "2026-11-07");
    expect(healthyProgress).toEqual({
      totalItems: 3,
      doneItems: 2,
      activeItems: 1,
      blockedItems: 0,
      totalPoints: 16,
      donePoints: 8,
      itemCompletionPct: 67,
      pointsCompletionPct: 50,
      daysTotal: 14,
      daysElapsed: 7,
      daysRemaining: 7,
      idealPacePct: 50,
      capacityPoints: 20,
      capacityUtilizationPct: 80,
      scopeHealth: "healthy",
    });

    // Near end of sprint with <75% items done triggers at_risk
    const nearEndProgress = computeCycleProgress(activeCycle, cards, "2026-11-12");
    expect(nearEndProgress.daysRemaining).toBe(2);
    expect(nearEndProgress.scopeHealth).toBe("at_risk");

    // Overcommitted when points exceed capacityPoints
    const overcommittedProgress = computeCycleProgress(
      { ...activeCycle, capacityPoints: 12 },
      cards,
      "2026-11-07",
    );
    expect(overcommittedProgress.capacityUtilizationPct).toBe(133);
    expect(overcommittedProgress.scopeHealth).toBe("overcommitted");

    // Unestimated cycle falls back pointsCompletionPct to itemCompletionPct
    const unestimatedCards = [
      makeCard("u1", { stage: "done", updatedAt: "2026-11-02", attributes: { cycleId: "cyc_u" } }),
      makeCard("u2", { stage: "dev", attributes: { cycleId: "cyc_u" } }),
    ];
    const unestimatedCycle: ProjectCycle = {
      id: "cyc_u",
      number: 1,
      name: "Unestimated",
      startDate: "2026-11-01",
      endDate: "2026-11-10",
      status: "active",
    };
    const unestimatedProgress = computeCycleProgress(
      unestimatedCycle,
      unestimatedCards,
      "2026-11-03",
    );
    expect(unestimatedProgress.totalPoints).toBe(0);
    expect(unestimatedProgress.itemCompletionPct).toBe(50);
    expect(unestimatedProgress.pointsCompletionPct).toBe(50);

    // Burnup series for 14-day cycle has 14 day-by-day points, null after today
    const burnup = buildCycleBurnupSeries(activeCycle, cards, "2026-11-07");
    expect(burnup).toHaveLength(14);
    expect(burnup[0]).toEqual({
      dayIndex: 0,
      date: "2026-11-01",
      idealPoints: 0,
      scopePoints: 16,
      completedPoints: 0,
    });
    expect(burnup[2]?.date).toBe("2026-11-03");
    expect(burnup[2]?.completedPoints).toBe(5);
    expect(burnup[5]?.date).toBe("2026-11-06");
    expect(burnup[5]?.completedPoints).toBe(8);
    expect(burnup[6]?.date).toBe("2026-11-07");
    expect(burnup[6]?.completedPoints).toBe(8);
    expect(burnup[7]?.date).toBe("2026-11-08");
    expect(burnup[7]?.completedPoints).toBeNull();
    expect(burnup[13]?.idealPoints).toBe(16);

    // Unestimated burnup uses item count as scale
    const unestimatedBurnup = buildCycleBurnupSeries(
      unestimatedCycle,
      unestimatedCards,
      "2026-11-03",
    );
    expect(unestimatedBurnup[0]?.scopePoints).toBe(2);
    expect(unestimatedBurnup[1]?.completedPoints).toBe(1);

    // Long cycle (>15 days) samples down to 15 evenly spaced points from startDate to endDate
    const longBurnup = buildCycleBurnupSeries(
      { ...activeCycle, startDate: "2026-11-01", endDate: "2026-12-30" },
      cards,
      "2026-11-15",
    );
    expect(longBurnup).toHaveLength(15);
    expect(longBurnup[0]?.date).toBe("2026-11-01");
    expect(longBurnup[14]?.date).toBe("2026-12-30");

    // Velocity calculation across completed cycles (respects completedPoints ?? donePointsFromCards)
    expect(computeTeamVelocity([], cards)).toEqual({
      completedCycles: 0,
      averagePoints: 0,
      latestPoints: 0,
      trend: "none",
    });
    const velocity = computeTeamVelocity(
      [
        {
          id: "cyc_3",
          number: 3,
          name: "Cycle 3",
          startDate: "2026-10-15",
          endDate: "2026-10-28",
          status: "completed",
          completedPoints: 24,
        },
        {
          id: "cyc_1",
          number: 1,
          name: "Cycle 1",
          startDate: "2026-10-01",
          endDate: "2026-10-14",
          status: "completed",
          completedPoints: 16,
        },
        activeCycle,
      ],
      cards,
    );
    expect(velocity).toEqual({
      completedCycles: 2,
      averagePoints: 20,
      latestPoints: 24,
      trend: "up",
    });

    const cardFallbackVelocity = computeTeamVelocity(
      [
        {
          id: "cyc_prev",
          number: 1,
          name: "Cycle 1",
          startDate: "2026-10-01",
          endDate: "2026-10-14",
          status: "completed",
          completedPoints: 20,
        },
        {
          id: "cyc_2",
          number: 2,
          name: "Cycle 2",
          startDate: "2026-11-01",
          endDate: "2026-11-14",
          status: "completed",
        },
      ],
      cards,
    );
    expect(cardFallbackVelocity).toEqual({
      completedCycles: 2,
      averagePoints: 14,
      latestPoints: 8,
      trend: "down",
    });

    // Milestone progress summary
    const milestone: ProjectMilestone = {
      id: "mls_1",
      name: "Core Launch",
      horizon: "now",
      status: "active",
      targetDate: "2026-12-01",
    };
    const milestoneProgress = computeMilestoneProgress(milestone, cards, "2026-11-07");
    expect(milestoneProgress).toEqual({
      totalItems: 5,
      doneItems: 2,
      activeItems: 3,
      overdueItems: 1,
      blockedItems: 1,
      totalPoints: 24,
      donePoints: 8,
      completionPct: 33,
      prdCount: 1,
      devCount: 1,
      reviewCount: 1,
    });

    // Next cycle draft suggestions
    expect(suggestNextCycleDraft([], "2026-11-28")).toEqual({
      number: 1,
      name: "Cycle 1",
      startDate: "2026-11-28",
      endDate: "2026-12-11",
      capacityPoints: 20,
    });

    expect(
      suggestNextCycleDraft(
        [
          {
            id: "cyc_1",
            number: 1,
            name: "Cycle 1",
            startDate: "2026-11-01",
            endDate: "2026-11-14",
            status: "completed",
            completedPoints: 18,
          },
          {
            id: "cyc_2",
            number: 2,
            name: "Cycle 2",
            startDate: "2026-11-15",
            endDate: "2026-11-28",
            status: "completed",
            completedPoints: 25,
          },
        ],
        "2026-11-20",
      ),
    ).toEqual({
      number: 3,
      name: "Cycle 3",
      startDate: "2026-11-29",
      endDate: "2026-12-12",
      capacityPoints: 22,
    });

    // When all existing cycles ended in the past, starts today
    expect(
      suggestNextCycleDraft(
        [
          {
            id: "cyc_1",
            number: 4,
            name: "Cycle 4",
            startDate: "2026-10-01",
            endDate: "2026-10-14",
            status: "completed",
            completedPoints: 15,
          },
        ],
        "2026-11-28",
      ),
    ).toEqual({
      number: 5,
      name: "Cycle 5",
      startDate: "2026-11-28",
      endDate: "2026-12-11",
      capacityPoints: 15,
    });
  });
});
