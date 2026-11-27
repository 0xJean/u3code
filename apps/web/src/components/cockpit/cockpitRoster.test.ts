import type {
  ChangeRequestAudit,
  CockpitWorkItemCard,
  TeamBoardMessage,
  WorkspaceMember,
} from "@u3code/hub-contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveTeamRoster, parseMessageTokens } from "./CockpitSwarmAvatar";

const FIXED_NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");

function makeMember(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    userId: "usr_owner_1",
    displayName: "Alice Chen",
    email: "alice@example.com",
    avatarUrl: null,
    primaryVcsLogin: "alice",
    notificationHandles: {},
    roles: ["owner"],
    joinedAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

function makeCard(
  overrides: {
    id?: string;
    code?: string;
    title?: string;
    stage?: string;
    health?: "on_track" | "at_risk" | "blocked";
    priority?: "p0" | "p1" | "p2" | "p3";
    assigneeType?: "unassigned" | "human" | "runner";
    assigneeUserId?: string | null;
    assigneeRunnerId?: string | null;
    changeRequests?: ChangeRequestAudit[];
  } = {},
): CockpitWorkItemCard {
  return {
    workItem: {
      id: overrides.id ?? "wi_1",
      projectId: "prj_1",
      seqNo: 1,
      code: overrides.code ?? "CORE-1",
      title: overrides.title ?? "Add Lark interactive gate callback",
      itemType: "feature",
      priority: overrides.priority ?? "p1",
      stage: overrides.stage ?? "dev",
      health: overrides.health ?? "on_track",
      assigneeType: overrides.assigneeType ?? "human",
      assigneeUserId: overrides.assigneeUserId ?? "usr_owner_1",
      assigneeRunnerId: overrides.assigneeRunnerId ?? null,
      specMarkdown: "",
      specUrl: null,
      previewUrls: [],
      checklistItems: [],
      attributes: {},
      createdBy: "usr_owner_1",
      createdAt: "2026-11-27T08:00:00.000Z",
      updatedAt: "2026-11-27T11:00:00.000Z",
    },
    latestPulse: null,
    changeRequests: overrides.changeRequests ?? [],
    gateApprovals: [],
    checklistVerifiedCount: 0,
    checklistTotalCount: 0,
  };
}

function makeChangeRequest(overrides: Partial<ChangeRequestAudit> = {}): ChangeRequestAudit {
  return {
    id: "cr_101",
    forgeKind: "github",
    repoFullName: "acme/nexus-go",
    number: 101,
    workItemId: "wi_1",
    title: "feat(gates): add interactive callback handler",
    url: "https://github.com/acme/nexus-go/pull/101",
    headBranch: "feat/CORE-1",
    baseBranch: "main",
    baseBranchRole: "release",
    headSha: "abc1234",
    authorVcsLogin: "bob",
    state: "open",
    additions: 120,
    deletions: 14,
    isOversized: false,
    automatedReview: {
      status: "blocking",
      blockingCount: 1,
      reviewers: [
        {
          reviewerName: "dotsbot[bot]",
          state: "changes_requested",
          riskLevel: "high",
          bodyExcerpt: "Verify webhook signature before executing callback.",
          updatedAt: "2026-11-27T11:20:00.000Z",
        },
      ],
    },
    qualitySignals: {
      ciStatus: "success",
      signals: {},
    },
    humanReviewState: "pending",
    triageBucket: "bot_blocked",
    mergedAt: null,
    updatedAt: "2026-11-27T11:30:00.000Z",
    ...overrides,
  };
}

function makeBoardMessage(overrides: Partial<TeamBoardMessage> = {}): TeamBoardMessage {
  return {
    id: "msg_1",
    workspaceId: "ws_1",
    projectId: "prj_1",
    seq: 1,
    kind: "message",
    authorType: "human",
    authorUserId: "usr_owner_1",
    authorHandle: "alice",
    authorDisplayName: "Alice Chen",
    mentions: [],
    body: "Kickoff complete for CORE-1.",
    workItemId: "wi_1",
    workItemCode: "CORE-1",
    changeRequestId: null,
    changeRequestRef: null,
    createdAt: "2026-11-27T11:45:00.000Z",
    ...overrides,
  };
}

describe("deriveTeamRoster", () => {
  it("merges workspace members, PR authors, AI reviewers, runners, and board authors without duplicates", () => {
    const owner = makeMember();
    const bobMember = makeMember({
      userId: "usr_bob",
      displayName: "Bob Li",
      email: "bob@example.com",
      primaryVcsLogin: "Bob",
      roles: ["dev"],
    });
    const idleMember = makeMember({
      userId: "usr_carol",
      displayName: "Carol Wu",
      email: "carol@example.com",
      primaryVcsLogin: "carol",
      roles: ["qa"],
    });

    const openPr = makeChangeRequest({ authorVcsLogin: "bob" });
    const activeCard = makeCard({
      id: "wi_1",
      code: "CORE-1",
      assigneeType: "human",
      assigneeUserId: "usr_owner_1",
      changeRequests: [openPr],
    });
    const runnerCard = makeCard({
      id: "wi_2",
      code: "CORE-2",
      title: "Migrate hub websocket tests",
      assigneeType: "runner",
      assigneeUserId: null,
      assigneeRunnerId: "codex-runner",
    });

    const messages: TeamBoardMessage[] = [
      makeBoardMessage({
        id: "msg_1",
        seq: 1,
        authorUserId: "usr_owner_1",
        authorHandle: "alice-alt",
        body: "First note",
        createdAt: "2026-11-27T09:00:00.000Z",
      }),
      makeBoardMessage({
        id: "msg_2",
        seq: 2,
        authorUserId: "usr_owner_1",
        authorHandle: "alice",
        body: "@bob please address #101",
        mentions: ["bob"],
        createdAt: "2026-11-27T11:50:00.000Z",
      }),
      makeBoardMessage({
        id: "msg_3",
        seq: 3,
        authorType: "agent",
        authorUserId: null,
        authorHandle: "release-agent",
        authorDisplayName: "Release Agent",
        body: "Prepared staging checklist.",
        createdAt: "2026-11-27T06:00:00.000Z",
      }),
      makeBoardMessage({
        id: "msg_4",
        seq: 4,
        authorType: "system",
        authorUserId: null,
        authorHandle: "system",
        authorDisplayName: "System",
        body: "Automated system event.",
        createdAt: "2026-11-27T11:55:00.000Z",
      }),
    ];

    const roster = deriveTeamRoster({
      members: [owner, bobMember, idleMember],
      cards: [activeCard, runnerCard],
      reviewItems: [openPr],
      boardMessages: messages,
      currentUserId: "usr_owner_1",
      nowMs: FIXED_NOW_MS,
    });

    const handles = roster.map((entry) => entry.handle);
    expect(handles).not.toContain("system");
    expect(handles).not.toContain("alice-alt");
    expect(new Set(handles).size).toBe(handles.length);

    expect(roster[0]?.handle).toBe("alice");
    expect(roster[0]?.isOwner).toBe(true);
    expect(roster[0]?.state).toBe("working");
    expect(roster[0]?.postCount).toBe(2);
    expect(roster[0]?.latestPost?.seq).toBe(2);
    expect(roster[0]?.activeItemCount).toBe(1);

    const bob = roster.find((entry) => entry.handle === "bob");
    expect(bob?.state).toBe("working");
    expect(bob?.openPrCount).toBe(1);
    expect(bob?.currentChangeRequestId).toBe("cr_101");

    const dotsbot = roster.find((entry) => entry.handle === "dotsbot[bot]");
    expect(dotsbot?.kind).toBe("agent");
    expect(dotsbot?.subtitle).toBe("AI Reviewer");
    expect(dotsbot?.state).toBe("working");
    expect(dotsbot?.currentActivity).toContain("acme/nexus-go#101");

    const runner = roster.find((entry) => entry.handle === "codex-runner");
    expect(runner?.kind).toBe("agent");
    expect(runner?.subtitle).toBe("Coding Agent");
    expect(runner?.state).toBe("working");
    expect(runner?.currentWorkItemId).toBe("wi_2");

    const carol = roster.find((entry) => entry.handle === "carol");
    expect(carol?.state).toBe("standing_by");
    expect(carol?.postCount).toBe(0);

    const releaseAgent = roster.find((entry) => entry.handle === "release-agent");
    expect(releaseAgent?.kind).toBe("agent");
    expect(releaseAgent?.state).toBe("standing_by");
    expect(releaseAgent?.latestPost?.seq).toBe(3);
  });

  it("never exposes raw usr_* identifiers as handles", () => {
    const rawMember = makeMember({
      userId: "usr_9f82a1",
      displayName: "usr_9f82a1",
      email: null,
      primaryVcsLogin: null,
      roles: ["dev"],
    });

    const ghostCard = makeCard({
      id: "wi_ghost",
      assigneeType: "human",
      assigneeUserId: "usr_unmapped_42",
    });

    const rawBoardPost = makeBoardMessage({
      id: "msg_raw",
      seq: 9,
      authorUserId: null,
      authorHandle: "usr_bad_handle",
      authorDisplayName: "usr_bad_handle",
    });

    const roster = deriveTeamRoster({
      members: [rawMember],
      cards: [ghostCard],
      reviewItems: [],
      boardMessages: [rawBoardPost],
      nowMs: FIXED_NOW_MS,
    });

    expect(roster).toHaveLength(1);
    expect(roster[0]?.handle).toBe("member");
    expect(roster.every((entry) => !entry.handle.startsWith("usr_"))).toBe(true);
  });

  it("classifies completed items, merged PRs, and stale posts as standing_by while recent posts are working", () => {
    const doneMember = makeMember({
      userId: "usr_done",
      displayName: "Dana",
      primaryVcsLogin: "dana",
      roles: ["dev"],
    });
    const recentPoster = makeMember({
      userId: "usr_recent",
      displayName: "Evan",
      primaryVcsLogin: "evan",
      roles: ["dev"],
    });

    const doneCard = makeCard({
      id: "wi_done",
      stage: "done",
      assigneeUserId: "usr_done",
    });
    const mergedPr = makeChangeRequest({
      id: "cr_merged",
      authorVcsLogin: "dana",
      state: "merged",
      automatedReview: { status: "pass", blockingCount: 0, reviewers: [] },
    });
    const recentMessage = makeBoardMessage({
      id: "msg_recent",
      seq: 12,
      authorUserId: "usr_recent",
      authorHandle: "evan",
      authorDisplayName: "Evan",
      createdAt: "2026-11-27T11:40:00.000Z",
    });

    const roster = deriveTeamRoster({
      members: [doneMember, recentPoster],
      cards: [doneCard],
      reviewItems: [mergedPr],
      boardMessages: [recentMessage],
      nowMs: FIXED_NOW_MS,
    });

    expect(roster[0]?.handle).toBe("evan");
    expect(roster[0]?.state).toBe("working");
    expect(roster[1]?.handle).toBe("dana");
    expect(roster[1]?.state).toBe("standing_by");
    expect(roster[1]?.activeItemCount).toBe(0);
    expect(roster[1]?.openPrCount).toBe(0);
  });
});

describe("parseMessageTokens", () => {
  it("parses @mentions, work item codes, PR refs, and inline code spans cleanly", () => {
    const tokens = parseMessageTokens(
      "@alice and @dotsbot[bot]. Check CORE-12, acme/nexus-go#101, #42, and `vp test` (contact dev@acme.com, stage-1).",
    );

    expect(tokens).toEqual([
      { kind: "mention", value: "@alice", handle: "alice" },
      { kind: "text", value: " and " },
      { kind: "mention", value: "@dotsbot[bot]", handle: "dotsbot[bot]" },
      { kind: "text", value: ". Check " },
      { kind: "work_item", value: "CORE-12", code: "CORE-12" },
      { kind: "text", value: ", " },
      { kind: "pr", value: "acme/nexus-go#101", repoFullName: "acme/nexus-go", number: 101 },
      { kind: "text", value: ", " },
      { kind: "pr", value: "#42", repoFullName: null, number: 42 },
      { kind: "text", value: ", and " },
      { kind: "code", value: "`vp test`", code: "vp test" },
      { kind: "text", value: " (contact dev@acme.com, stage-1)." },
    ]);
  });

  it("keeps tokens inside inline backtick code spans untouched", () => {
    const tokens = parseMessageTokens("Run `@alice CORE-1 #101` before pushing.");
    expect(tokens).toEqual([
      { kind: "text", value: "Run " },
      { kind: "code", value: "`@alice CORE-1 #101`", code: "@alice CORE-1 #101" },
      { kind: "text", value: " before pushing." },
    ]);
  });
});
