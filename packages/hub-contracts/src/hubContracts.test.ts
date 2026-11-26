import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_REPO_POLICY,
  HubWsEvent,
  PulseCreateInput,
  RepoPolicy,
  WORKFLOW_PRESETS,
  WorkflowConfig,
  createWorkflowConfigFromPreset,
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
});
