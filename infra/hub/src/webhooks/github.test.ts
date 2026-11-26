import { describe, expect, it } from "vite-plus/test";
import type { RepoPolicy } from "@u3code/hub-contracts";
import {
  computeTriageBucket,
  extractQualitySignal,
  extractWorkItemCode,
  matchAutomatedReviewer,
  resolveBranchRole,
} from "./github.ts";

const samplePolicy: RepoPolicy = {
  branches: [
    { name: "dev", role: "integration", mergePolicy: "auto_on_low_risk" },
    { name: "main", role: "release", mergePolicy: "manual" },
  ],
  automatedReviewers: [
    {
      name: "Dotsbot",
      botLogins: ["dotsbot[bot]", "dotsbot"],
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
      label: "Diff Coverage",
      checkName: "ci/diff-coverage",
      pattern: "Diff Coverage:\\s*([0-9.]+)%",
      minValue: 75,
      unit: "%",
    },
  ],
  maxPrChangedLines: 500,
};

describe("github webhook normalization helpers", () => {
  it("extracts work item code from body, title, or branch name", () => {
    expect(
      extractWorkItemCode({
        title: "Refactor auth",
        body: "Refs NEX-101\nMore details",
        headBranch: "feat/auth",
      }),
    ).toBe("NEX-101");

    expect(
      extractWorkItemCode({
        title: "[APP-42] Fix RN navigation crash",
        body: "",
        headBranch: "fix/nav",
      }),
    ).toBe("APP-42");

    expect(
      extractWorkItemCode({
        title: "Clean up handler",
        body: "",
        headBranch: "refactor/core-7-cleanup",
      }),
    ).toBe("CORE-7");

    expect(
      extractWorkItemCode({
        title: "Quick typo fix",
        body: "",
        headBranch: "fix/typo",
      }),
    ).toBeNull();
  });

  it("matches arbitrary configured automated reviewers case-insensitively", () => {
    expect(matchAutomatedReviewer(samplePolicy, "Dotsbot[bot]")?.name).toBe("Dotsbot");
    expect(matchAutomatedReviewer(samplePolicy, "coderabbitai[bot]")?.name).toBe("CodeRabbit");
    expect(matchAutomatedReviewer(samplePolicy, "alice")).toBeNull();
  });

  it("resolves branch roles and extracts configurable quality signals", () => {
    expect(resolveBranchRole(samplePolicy, "dev")).toBe("integration");
    expect(resolveBranchRole(samplePolicy, "main")).toBe("release");
    expect(resolveBranchRole(samplePolicy, "exp")).toBe("other");

    const passSig = extractQualitySignal(
      samplePolicy,
      "ci/diff-coverage",
      "Diff Coverage: 84.6% (min 75.0%) | Total: 62.1%",
    );
    expect(passSig?.value).toBe(84.6);
    expect(passSig?.passed).toBe(true);

    const failSig = extractQualitySignal(
      samplePolicy,
      "ci/diff-coverage",
      "Diff Coverage: 61.2% (min 75.0%)",
    );
    expect(failSig?.value).toBe(61.2);
    expect(failSig?.passed).toBe(false);
  });

  it("computes deterministic triage buckets across dev and main flows", () => {
    expect(
      computeTriageBucket({
        state: "open",
        baseBranchRole: "integration",
        workItemId: "wi_1",
        automatedReview: { status: "blocking", blockingCount: 1, reviewers: [] },
        qualitySignals: { ciStatus: "success", signals: {} },
        humanReviewState: "pending",
      }),
    ).toBe("bot_blocked");

    expect(
      computeTriageBucket({
        state: "merged",
        baseBranchRole: "integration",
        workItemId: "wi_1",
        automatedReview: { status: "auto_merged", blockingCount: 0, reviewers: [] },
        qualitySignals: { ciStatus: "success", signals: {} },
        humanReviewState: "pending",
      }),
    ).toBe("auto_merged_integration");

    expect(
      computeTriageBucket({
        state: "open",
        baseBranchRole: "release",
        workItemId: "wi_1",
        automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
        qualitySignals: {
          ciStatus: "success",
          signals: { diff_coverage: { key: "diff_coverage", value: 88, passed: true } },
        },
        humanReviewState: "pending",
      }),
    ).toBe("ready_for_human_review");

    expect(
      computeTriageBucket({
        state: "open",
        baseBranchRole: "release",
        workItemId: null,
        automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
        qualitySignals: { ciStatus: "success", signals: {} },
        humanReviewState: "pending",
      }),
    ).toBe("orphan");
  });
});
