import { describe, expect, it } from "vite-plus/test";
import { applyMemoryPatch, synthesizeDeterministicDigest } from "./engine.ts";

describe("living project memory and digest engine", () => {
  it("merges new decisions and increments recurring risks while preserving locked directives", () => {
    const lockedDirective = {
      id: "dir_1",
      text: "Freeze billing schema before Q4 cutover",
      createdBy: "usr_owner",
      createdAt: "2026-11-26T00:00:00.000Z",
      active: true,
    };

    const next = applyMemoryPatch(
      {
        architectureDecisions: [
          {
            id: "adr_1",
            date: "2026-11-25",
            repoFullName: "org/nexus-go",
            summary: "Use stateless JWT for edge auth",
            rationale: "Avoid session store lookups",
            sourceRef: "pls_1",
          },
        ],
        moduleMap: [
          {
            name: "Auth",
            repoFullName: "org/nexus-go",
            status: "in_progress",
            progressPct: 50,
            notes: "Working on refresh rotation",
            ownerVcsLogin: "alice",
          },
        ],
        recurringRisks: [
          {
            id: "rsk_1",
            title: "Missing replay protection",
            severity: "medium",
            occurrences: 1,
            mitigation: "Add family revocation",
            active: true,
          },
        ],
        directives: [lockedDirective],
      },
      {
        newDecisions: [
          {
            id: "adr_dup",
            date: "2026-11-26",
            repoFullName: "org/nexus-go",
            summary: "use stateless jwt for edge auth",
            rationale: "duplicate",
            sourceRef: "pls_2",
          },
          {
            id: "adr_2",
            date: "2026-11-26",
            repoFullName: "org/app-rn",
            summary: "Generate TS API client from OpenAPI spec",
            rationale: "Eliminate manual drift",
            sourceRef: "pls_3",
          },
        ],
        moduleUpdates: [
          {
            name: "Auth",
            repoFullName: "org/nexus-go",
            status: "completed",
            progressPct: 100,
            notes: "Merged into dev",
            ownerVcsLogin: "alice",
          },
        ],
        riskSignals: [{ title: "Missing replay protection", severity: "high" }],
      },
    );

    expect(next.architectureDecisions).toHaveLength(2);
    expect(next.moduleMap[0]?.progressPct).toBe(100);
    expect(next.recurringRisks[0]?.occurrences).toBe(2);
    expect(next.recurringRisks[0]?.severity).toBe("high");
    expect(next.directives).toEqual([lockedDirective]);
  });

  it("synthesizes a structured cockpit digest deterministically without requiring an external LLM", () => {
    const result = synthesizeDeterministicDigest({
      projectName: "Nexus Core (NEX)",
      directives: [
        {
          id: "dir_1",
          text: "No Friday afternoon production deploys",
          createdBy: "usr_owner",
          createdAt: "2026-11-26T00:00:00.000Z",
          active: true,
        },
      ],
      existingDecisions: [],
      recentPulses: [
        {
          id: "pls_1",
          workItemId: "wi_1",
          sourceType: "human_thread",
          authorUserId: "usr_1",
          runnerId: null,
          sourceThreadId: "thr_1",
          repoFullName: "org/nexus-go",
          stageAtTime: "dev",
          health: "blocked",
          doneSummary: "Finished auth middleware split",
          decisions: ["Move token verification into edge middleware"],
          blockers: [{ text: "Need owner sign-off on legacy 30-day token window" }],
          nextStep: "Roll out to staging",
          progressedAcIds: ["AC-1"],
          createdAt: "2026-11-26T10:00:00.000Z",
        },
      ],
      openChangeRequests: [],
      mergedChangeRequests: [],
      activeWorkItems: [
        {
          id: "wi_1",
          projectId: "prj_1",
          seqNo: 1,
          code: "NEX-1",
          title: "Auth middleware refactor",
          itemType: "refactor",
          priority: "p0",
          stage: "dev",
          health: "blocked",
          assigneeType: "human",
          assigneeUserId: "usr_1",
          assigneeRunnerId: null,
          specMarkdown: "",
          specUrl: null,
          previewUrls: [],
          checklistItems: [],
          attributes: {},
          createdBy: "usr_1",
          createdAt: "2026-11-25T10:00:00.000Z",
          updatedAt: "2026-11-26T10:00:00.000Z",
        },
      ],
    });

    expect(result.markdownBody).toContain("NEX-1");
    expect(result.markdownBody).toContain("Need owner sign-off on legacy 30-day token window");
    expect(result.markdownBody).toContain("Move token verification into edge middleware");
    expect(result.markdownBody).toContain("No Friday afternoon production deploys");
    expect(result.memoryPatch.newDecisions).toHaveLength(1);
  });
});
