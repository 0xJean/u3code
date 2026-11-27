import { describe, expect, it } from "vite-plus/test";
import { buildReleaseDraftFromWorkItems } from "./releaseDraft";

describe("releaseDraft", () => {
  it("builds repo snapshots and grouped markdown release notes from selected work items", () => {
    const draft = buildReleaseDraftFromWorkItems({
      selectedCards: [
        {
          workItem: {
            id: "wi_1",
            projectId: "prj_1",
            seqNo: 1,
            code: "CORE-1",
            title: "Outbox worker",
            itemType: "feature",
            priority: "p0",
            stage: "staging",
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
            createdAt: "2026-11-27T00:00:00.000Z",
            updatedAt: "2026-11-27T00:00:00.000Z",
          },
          latestPulse: null,
          changeRequests: [
            {
              id: "cr_1",
              forgeKind: "github",
              repoFullName: "acme/backend",
              number: 18,
              workItemId: "wi_1",
              title: "feat: outbox",
              url: "https://github.com/acme/backend/pull/18",
              headBranch: "feat/CORE-1",
              baseBranch: "main",
              baseBranchRole: "release",
              headSha: "abcdef1234567890",
              authorVcsLogin: "alice",
              state: "merged",
              additions: 120,
              deletions: 10,
              isOversized: false,
              automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
              qualitySignals: { ciStatus: "success", signals: {} },
              humanReviewState: "approved",
              triageBucket: "merged",
              mergedAt: "2026-11-27T01:00:00.000Z",
              updatedAt: "2026-11-27T01:00:00.000Z",
            },
          ],
          gateApprovals: [],
          checklistVerifiedCount: 2,
          checklistTotalCount: 2,
        },
      ],
      repos: [
        {
          id: "r1",
          projectId: "prj_1",
          forgeKind: "github",
          repoFullName: "acme/backend",
          tags: [],
          repoPolicy: {
            branches: [{ name: "main", role: "release", mergePolicy: "manual" }],
            automatedReviewers: [],
            qualitySignals: [],
            maxPrChangedLines: 500,
            environments: {},
          },
          createdAt: "2026-11-27T00:00:00.000Z",
        },
        {
          id: "r2",
          projectId: "prj_1",
          forgeKind: "github",
          repoFullName: "acme/web",
          tags: [],
          repoPolicy: {
            branches: [{ name: "release", role: "release", mergePolicy: "manual" }],
            automatedReviewers: [],
            qualitySignals: [],
            maxPrChangedLines: 500,
            environments: {},
          },
          createdAt: "2026-11-27T00:00:00.000Z",
        },
      ],
    });

    expect(draft.snapshotsText).toBe("acme/backend=main@abcdef1\nacme/web=release");
    expect(draft.releaseNotesMd).toContain("### Features");
    expect(draft.releaseNotesMd).toContain("**CORE-1** Outbox worker (backend#18) [AC 2/2]");
  });
});
