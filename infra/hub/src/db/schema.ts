import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ArchitectureDecision,
  AutomatedReviewSummary,
  ChecklistItem,
  ModuleProgressEntry,
  NotificationHandles,
  ProjectDirective,
  PulseBlocker,
  QualitySignalsSnapshot,
  RecurringRisk,
  RepoPolicy,
  WorkflowConfig,
} from "@u3code/hub-contracts";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    primaryVcsLogin: text("primary_vcs_login"),
    notificationHandles: jsonb("notification_handles")
      .notNull()
      .$type<NotificationHandles>()
      .default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_users_primary_vcs_login").on(table.primaryVcsLogin)],
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    externalUsername: text("external_username"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_user_identities_provider_ext").on(table.provider, table.externalId),
  ],
);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  settings: jsonb("settings")
    .notNull()
    .$type<Record<string, unknown>>()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`ARRAY['member']::text[]`),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    workflowConfig: jsonb("workflow_config")
      .notNull()
      .$type<WorkflowConfig>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("uidx_projects_workspace_key").on(table.workspaceId, table.key)],
);

export const projectRepos = pgTable(
  "project_repos",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    forgeKind: text("forge_kind").notNull().default("github"),
    repoFullName: text("repo_full_name").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    repoPolicy: jsonb("repo_policy")
      .notNull()
      .$type<RepoPolicy>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_project_repos_unique").on(
      table.projectId,
      table.forgeKind,
      table.repoFullName,
    ),
    index("idx_project_repos_lookup").on(table.forgeKind, table.repoFullName),
  ],
);

export const workItems = pgTable(
  "work_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seqNo: integer("seq_no").notNull(),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    itemType: text("item_type").notNull().default("feature"),
    priority: text("priority").notNull().default("p1"),
    stage: text("stage").notNull(),
    health: text("health").notNull().default("on_track"),
    assigneeType: text("assignee_type").notNull().default("unassigned"),
    assigneeUserId: text("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    assigneeRunnerId: text("assignee_runner_id"),
    specMarkdown: text("spec_markdown").notNull().default(""),
    specUrl: text("spec_url"),
    previewUrls: jsonb("preview_urls")
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    checklistItems: jsonb("checklist_items")
      .notNull()
      .$type<ChecklistItem[]>()
      .default(sql`'[]'::jsonb`),
    attributes: jsonb("attributes")
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_work_items_project_seq").on(table.projectId, table.seqNo),
    index("idx_work_items_project_stage").on(table.projectId, table.stage),
  ],
);

export const workItemLinks = pgTable(
  "work_item_links",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    repoFullName: text("repo_full_name"),
    externalId: text("external_id").notNull(),
    url: text("url"),
    title: text("title"),
    metadata: jsonb("metadata")
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_work_item_links_unique").on(
      table.workItemId,
      table.linkType,
      table.repoFullName,
      table.externalId,
    ),
  ],
);

export const pulses = pgTable(
  "pulses",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    runnerId: text("runner_id"),
    sourceThreadId: text("source_thread_id"),
    repoFullName: text("repo_full_name"),
    stageAtTime: text("stage_at_time").notNull(),
    health: text("health").notNull().default("on_track"),
    doneSummary: text("done_summary").notNull(),
    decisions: jsonb("decisions")
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    blockers: jsonb("blockers")
      .notNull()
      .$type<PulseBlocker[]>()
      .default(sql`'[]'::jsonb`),
    nextStep: text("next_step").notNull().default(""),
    progressedAcIds: text("progressed_ac_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_pulses_work_item_created").on(table.workItemId, table.createdAt)],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: text("id").primaryKey(),
    forgeKind: text("forge_kind").notNull().default("github"),
    repoFullName: text("repo_full_name").notNull(),
    number: integer("number").notNull(),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    baseBranchRole: text("base_branch_role").notNull().default("release"),
    headSha: text("head_sha").notNull(),
    authorVcsLogin: text("author_vcs_login").notNull(),
    state: text("state").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    isOversized: boolean("is_oversized").notNull().default(false),
    automatedReview: jsonb("automated_review")
      .notNull()
      .$type<AutomatedReviewSummary>()
      .default(sql`'{"status":"pending","blockingCount":0,"reviewers":[]}'::jsonb`),
    qualitySignals: jsonb("quality_signals")
      .notNull()
      .$type<QualitySignalsSnapshot>()
      .default(sql`'{"ciStatus":"pending","signals":{}}'::jsonb`),
    humanReviewState: text("human_review_state").notNull().default("pending"),
    triageBucket: text("triage_bucket").notNull().default("ci_blocked"),
    mergedAt: timestamp("merged_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_change_requests_unique").on(
      table.forgeKind,
      table.repoFullName,
      table.number,
    ),
    index("idx_change_requests_triage").on(table.triageBucket, table.updatedAt),
    index("idx_change_requests_work_item").on(table.workItemId),
  ],
);

export const gateApprovals = pgTable(
  "gate_approvals",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    gateKey: text("gate_key").notNull(),
    status: text("status").notNull(),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => users.id),
    note: text("note").notNull().default(""),
    evidenceUrls: jsonb("evidence_urls")
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_gate_approvals_target").on(table.targetType, table.targetId, table.gateKey),
  ],
);

export const releases = pgTable("releases", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  status: text("status").notNull().default("planning"),
  repoSnapshots: jsonb("repo_snapshots")
    .notNull()
    .$type<Record<string, unknown>>()
    .default(sql`'{}'::jsonb`),
  rollbackPlan: text("rollback_plan").notNull().default(""),
  releaseNotesMd: text("release_notes_md").notNull().default(""),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  releasedAt: timestamp("released_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const releaseItems = pgTable(
  "release_items",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.workItemId] })],
);

export const projectMemories = pgTable("project_memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  architectureDecisions: jsonb("architecture_decisions")
    .notNull()
    .$type<ArchitectureDecision[]>()
    .default(sql`'[]'::jsonb`),
  moduleMap: jsonb("module_map")
    .notNull()
    .$type<ModuleProgressEntry[]>()
    .default(sql`'[]'::jsonb`),
  recurringRisks: jsonb("recurring_risks")
    .notNull()
    .$type<RecurringRisk[]>()
    .default(sql`'[]'::jsonb`),
  directives: jsonb("directives")
    .notNull()
    .$type<ProjectDirective[]>()
    .default(sql`'[]'::jsonb`),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const cockpitDigests = pgTable("cockpit_digests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true, mode: "string" }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true, mode: "string" }).notNull(),
  markdownBody: text("markdown_body").notNull(),
  structuredJson: jsonb("structured_json")
    .notNull()
    .$type<Record<string, unknown>>()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const notificationChannels = pgTable("notification_channels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  driver: text("driver").notNull(),
  name: text("name").notNull(),
  events: text("events").array().notNull(),
  configEncrypted: text("config_encrypted").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  familyId: text("family_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  forgeKind: text("forge_kind").notNull(),
  eventName: text("event_name").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const boardMessages = pgTable(
  "board_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull().default("message"),
    authorType: text("author_type").notNull().default("human"),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorHandle: text("author_handle").notNull(),
    authorDisplayName: text("author_display_name").notNull(),
    mentions: text("mentions")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    body: text("body").notNull(),
    workItemId: text("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    workItemCode: text("work_item_code"),
    changeRequestId: text("change_request_id").references(() => changeRequests.id, {
      onDelete: "set null",
    }),
    changeRequestRef: text("change_request_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uidx_board_messages_workspace_seq").on(table.workspaceId, table.seq),
    index("idx_board_messages_workspace_seq").on(table.workspaceId, table.seq),
    index("idx_board_messages_workspace_project_seq").on(
      table.workspaceId,
      table.projectId,
      table.seq,
    ),
  ],
);
