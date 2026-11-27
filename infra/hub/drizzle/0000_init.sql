CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  primary_vcs_login TEXT,
  notification_handles JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_primary_vcs_login ON users(primary_vcs_login);

CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roles TEXT[] NOT NULL DEFAULT ARRAY['member']::text[],
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  workflow_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS project_repos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  forge_kind TEXT NOT NULL DEFAULT 'github',
  repo_full_name TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  repo_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, forge_kind, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_project_repos_lookup ON project_repos(forge_kind, repo_full_name);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'p1',
  stage TEXT NOT NULL,
  health TEXT NOT NULL DEFAULT 'on_track',
  assignee_type TEXT NOT NULL DEFAULT 'unassigned',
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignee_runner_id TEXT,
  spec_markdown TEXT NOT NULL DEFAULT '',
  spec_url TEXT,
  preview_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, seq_no)
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_stage ON work_items(project_id, stage);

CREATE TABLE IF NOT EXISTS work_item_links (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  repo_full_name TEXT,
  external_id TEXT NOT NULL,
  url TEXT,
  title TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_item_id, link_type, repo_full_name, external_id)
);

CREATE TABLE IF NOT EXISTS pulses (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  runner_id TEXT,
  source_thread_id TEXT,
  repo_full_name TEXT,
  stage_at_time TEXT NOT NULL,
  health TEXT NOT NULL DEFAULT 'on_track',
  done_summary TEXT NOT NULL,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_step TEXT NOT NULL DEFAULT '',
  progressed_ac_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pulses_work_item_created ON pulses(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  forge_kind TEXT NOT NULL DEFAULT 'github',
  repo_full_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  base_branch_role TEXT NOT NULL DEFAULT 'release',
  head_sha TEXT NOT NULL,
  author_vcs_login TEXT NOT NULL,
  state TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  is_oversized BOOLEAN NOT NULL DEFAULT FALSE,
  automated_review JSONB NOT NULL DEFAULT '{"status":"pending","blockingCount":0,"reviewers":[]}'::jsonb,
  quality_signals JSONB NOT NULL DEFAULT '{"ciStatus":"pending","signals":{}}'::jsonb,
  human_review_state TEXT NOT NULL DEFAULT 'pending',
  triage_bucket TEXT NOT NULL DEFAULT 'ci_blocked',
  merged_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (forge_kind, repo_full_name, number)
);

CREATE INDEX IF NOT EXISTS idx_change_requests_triage ON change_requests(triage_bucket, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_requests_work_item ON change_requests(work_item_id);

CREATE TABLE IF NOT EXISTS gate_approvals (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gate_approvals_target ON gate_approvals(target_type, target_id, gate_key);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  repo_snapshots JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_plan TEXT NOT NULL DEFAULT '',
  release_notes_md TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS release_items (
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  PRIMARY KEY (release_id, work_item_id)
);

CREATE TABLE IF NOT EXISTS project_memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  architecture_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  module_map JSONB NOT NULL DEFAULT '[]'::jsonb,
  recurring_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  directives JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cockpit_digests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  markdown_body TEXT NOT NULL,
  structured_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  driver TEXT NOT NULL,
  name TEXT NOT NULL,
  events TEXT[] NOT NULL,
  config_encrypted TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  forge_kind TEXT NOT NULL,
  event_name TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',
  author_type TEXT NOT NULL DEFAULT 'human',
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_handle TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  mentions TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  body TEXT NOT NULL,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  work_item_code TEXT,
  change_request_id TEXT REFERENCES change_requests(id) ON DELETE SET NULL,
  change_request_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_board_messages_workspace_seq ON board_messages(workspace_id, seq);
CREATE INDEX IF NOT EXISTS idx_board_messages_workspace_project_seq ON board_messages(workspace_id, project_id, seq);
