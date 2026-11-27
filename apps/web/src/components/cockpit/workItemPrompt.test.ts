import { describe, expect, it } from "vite-plus/test";
import { buildWorkItemThreadPrompt, pickMatchingWorkspaceProject } from "./workItemPrompt";

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
  });

  it("formats spec, ACs, active directives, and Team Hub sync hints into prompt", () => {
    const prompt = buildWorkItemThreadPrompt({
      workItem: {
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
      },
      memory: {
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
      },
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
});
