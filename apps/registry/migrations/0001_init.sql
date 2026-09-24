-- c4-registry initial schema

-- `env` distinguishes the real ('production') form from the unrestricted
-- staging copy used for scripts/staging-e2e.ts, so identity, the 32-team
-- cap, and duplicate-repo checks are scoped per environment.
CREATE TABLE IF NOT EXISTS teams (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id     TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  team_name       TEXT NOT NULL,
  repo_url        TEXT NOT NULL,
  members_json    TEXT NOT NULL DEFAULT '[]',
  env             TEXT NOT NULL DEFAULT 'production', -- production | staging
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(submitter_email, env),
  UNIQUE(repo_url, env)
);

CREATE INDEX IF NOT EXISTS idx_teams_response_id ON teams(response_id);
CREATE INDEX IF NOT EXISTS idx_teams_env ON teams(env);

-- Full history of arena results, one row per POST /api/results.
CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_url   TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  status     TEXT NOT NULL, -- building | passed | failed
  stage      TEXT NOT NULL, -- checkout | build | health | smoke
  detail     TEXT,
  log_tail   TEXT,
  at         TEXT NOT NULL, -- caller-supplied timestamp
  created_at TEXT NOT NULL  -- server receipt time
);

CREATE INDEX IF NOT EXISTS idx_results_repo_url ON results(repo_url, id);

-- Latest arena result per repo, denormalized for fast admin/status lookups
-- and change detection.
CREATE TABLE IF NOT EXISTS latest_results (
  repo_url   TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  status     TEXT NOT NULL,
  stage      TEXT NOT NULL,
  detail     TEXT,
  log_tail   TEXT,
  at         TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Cron-refreshed repo/CI status, public-safe (no arena outcomes).
CREATE TABLE IF NOT EXISTS repo_status (
  repo_url        TEXT PRIMARY KEY,
  reachability    TEXT NOT NULL DEFAULT 'unknown', -- reachable | empty | unreachable | private | unknown
  latest_commit   TEXT,
  actions_status  TEXT NOT NULL DEFAULT 'unknown', -- success | failure | in_progress | none | unknown
  actions_run_url TEXT,
  checked_at      TEXT
);

-- Append-only log of every /api/form submission attempt, for the admin page.
CREATE TABLE IF NOT EXISTS form_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id     TEXT,
  submitter_email TEXT,
  team_name       TEXT,
  repo_url        TEXT,
  env             TEXT NOT NULL DEFAULT 'production',
  outcome         TEXT NOT NULL, -- accepted | rejected
  reject_reason   TEXT,
  created_at      TEXT NOT NULL
);

-- Simple key/value settings store.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('competition_started', 'false');
