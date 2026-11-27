import type { CockpitWorkItemCard, ReleaseCard } from "@u3code/hub-contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildGanttTimeline, shiftIsoDate } from "./CockpitGanttView";
import type { CockpitTeamMember } from "./CockpitSwarmAvatar";

function makeCard(
  overrides: {
    readonly id?: string;
    readonly code?: string;
    readonly title?: string;
    readonly stage?: string;
    readonly priority?: "p0" | "p1" | "p2" | "p3";
    readonly health?: "on_track" | "at_risk" | "blocked";
    readonly assigneeType?: "unassigned" | "human" | "runner";
    readonly assigneeUserId?: string | null;
    readonly attributes?: Record<string, unknown>;
    readonly checklistVerifiedCount?: number;
    readonly checklistTotalCount?: number;
    readonly createdAt?: string;
  } = {},
): CockpitWorkItemCard {
  return {
    workItem: {
      id: overrides.id ?? "wi_1",
      projectId: "prj_1",
      seqNo: 1,
      code: overrides.code ?? "CORE-1",
      title: overrides.title ?? "Lark interactive gate",
      itemType: "feature",
      priority: overrides.priority ?? "p1",
      stage: overrides.stage ?? "dev",
      health: overrides.health ?? "on_track",
      assigneeType: overrides.assigneeType ?? "human",
      assigneeUserId: overrides.assigneeUserId ?? "usr_1",
      assigneeRunnerId: null,
      specMarkdown: "Full specification document with more than forty characters of detail.",
      specUrl: null,
      previewUrls: [],
      checklistItems: [],
      attributes: overrides.attributes ?? {},
      createdBy: "usr_1",
      createdAt: overrides.createdAt ?? "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    },
    latestPulse: null,
    changeRequests: [],
    gateApprovals: [],
    checklistVerifiedCount: overrides.checklistVerifiedCount ?? 0,
    checklistTotalCount: overrides.checklistTotalCount ?? 0,
  };
}

function makeRelease(
  overrides: {
    readonly id?: string;
    readonly versionLabel?: string;
    readonly status?: "planning" | "staging" | "ready" | "released" | "rolled_back";
    readonly releasedAt?: string | null;
    readonly workItemIds?: string[];
  } = {},
): ReleaseCard {
  return {
    release: {
      id: overrides.id ?? "rel_1",
      projectId: "prj_1",
      versionLabel: overrides.versionLabel ?? "v0.9.0-rc.1",
      status: overrides.status ?? "staging",
      repoSnapshots: {},
      rollbackPlan: "",
      releaseNotesMd: "",
      createdBy: "usr_1",
      releasedAt: overrides.releasedAt ?? null,
      createdAt: "2026-11-20T00:00:00.000Z",
      updatedAt: "2026-12-03T00:00:00.000Z",
    },
    workItemIds: overrides.workItemIds ?? [],
    gateApprovals: [],
  };
}

const sampleRoster: CockpitTeamMember[] = [
  {
    id: "usr_1",
    handle: "alice",
    displayName: "Alice Chen",
    kind: "human",
    isOwner: true,
    roles: ["owner"],
    subtitle: "alice",
    state: "working",
    currentActivity: null,
    currentWorkItemId: null,
    currentChangeRequestId: null,
    latestPost: null,
    activeItemCount: 1,
    openPrCount: 0,
    postCount: 0,
  },
];

describe("CockpitGanttView timeline helpers", () => {
  it("shifts ISO dates safely across month, leap-year, and year boundaries in UTC", () => {
    expect(shiftIsoDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftIsoDate("2026-12-31", 2)).toBe("2027-01-02");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftIsoDate("2026-11-27T18:30:00.000Z", -3)).toBe("2026-11-24");
  });

  it("computes bar positions, AC progress, overdue flags, and release markers in 2w zoom", () => {
    const onTrackCard = makeCard({
      id: "wi_1",
      code: "CORE-1",
      attributes: {
        plannedStartAt: "2026-11-25",
        dueAt: "2026-12-01",
      },
      checklistVerifiedCount: 3,
      checklistTotalCount: 4,
    });
    const overdueCard = makeCard({
      id: "wi_2",
      code: "CORE-2",
      assigneeType: "unassigned",
      assigneeUserId: null,
      attributes: {
        plannedStartAt: "2026-11-24",
        dueAt: "2026-11-26",
      },
    });
    const release = makeRelease({
      id: "rel_1",
      versionLabel: "v0.9.0-rc.1",
      workItemIds: ["wi_1"],
    });

    const timeline = buildGanttTimeline(
      [onTrackCard, overdueCard],
      [release],
      "2w",
      "2026-11-27",
      sampleRoster,
    );

    expect(timeline.startDay).toBe("2026-11-24");
    expect(timeline.endDay).toBe("2026-12-07");
    expect(timeline.totalDays).toBe(14);
    expect(timeline.columns).toHaveLength(14);
    expect(timeline.columns.find((col) => col.isToday)?.key).toBe("2026-11-27");
    expect(timeline.todayOffsetPct).toBeCloseTo((3.5 / 14) * 100, 4);

    const firstRow = timeline.rows[0];
    expect(firstRow?.startDate).toBe("2026-11-25");
    expect(firstRow?.dueDate).toBe("2026-12-01");
    expect(firstRow?.isEstimated).toBe(false);
    expect(firstRow?.isOverdue).toBe(false);
    expect(firstRow?.progressPct).toBe(75);
    expect(firstRow?.leftPct).toBeCloseTo((1 / 14) * 100, 4);
    expect(firstRow?.widthPct).toBeCloseTo((7 / 14) * 100, 4);
    expect(firstRow?.assignee?.handle).toBe("alice");

    const secondRow = timeline.rows[1];
    expect(secondRow?.isOverdue).toBe(true);
    expect(secondRow?.assignee).toBeNull();

    expect(timeline.releaseMarkers).toHaveLength(1);
    expect(timeline.releaseMarkers[0]?.versionLabel).toBe("v0.9.0-rc.1");
    expect(timeline.releaseMarkers[0]?.date).toBe("2026-12-01");
    expect(timeline.releaseMarkers[0]?.offsetPct).toBeCloseTo((7.5 / 14) * 100, 4);
  });

  it("builds weekly columns for 3m zoom and estimates unscheduled cards", () => {
    const estimatedCard = makeCard({
      id: "wi_est",
      code: "CORE-9",
      priority: "p0",
      stage: "done",
      createdAt: "2026-11-26T10:00:00.000Z",
      attributes: {},
    });

    const timeline = buildGanttTimeline([estimatedCard], [], "3m", "2026-11-27");

    expect(timeline.totalDays).toBeGreaterThanOrEqual(91);
    expect(timeline.columns.length).toBeGreaterThanOrEqual(13);
    expect(timeline.columns[0]?.label).toMatch(/^W\d+$/);
    expect(timeline.columns.some((col) => col.isToday)).toBe(true);
    expect(timeline.rows[0]?.isEstimated).toBe(true);
    expect(timeline.rows[0]?.isOverdue).toBe(false);
    expect(timeline.rows[0]?.progressPct).toBe(100);
  });
});
