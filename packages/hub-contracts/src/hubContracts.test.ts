import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_REPO_POLICY,
  HubWsEvent,
  PulseCreateInput,
  RepoPolicy,
  TeamBoardCreateInput,
  TeamBoardListResponse,
  TeamBoardMessage,
  WORKFLOW_PRESETS,
  WorkflowConfig,
  createWorkflowConfigFromPreset,
  extractBoardMentions,
  isGateCurrentlyApproved,
  resolveLatestGateApprovals,
} from "./index.ts";

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
});
