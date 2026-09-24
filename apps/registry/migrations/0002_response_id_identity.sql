-- Team identity moves from submitter_email to (response_id, env): the
-- Google Form no longer collects email addresses (everyone registers in
-- person, same room), but a form response id is stable across "edit your
-- response" edits, so it's the new identity. submitter_email is now
-- optional and may repeat (typically '') across many teams in the same
-- env, which the old UNIQUE(submitter_email, env) constraint forbids — so
-- rebuild the table without it.
--
-- Safe to run even with existing rows: production is currently empty, and
-- any staging rows already have one row per response_id (the old upsert
-- kept at most one row per email, and each row's response_id reflects its
-- most recent submission), so the new UNIQUE(response_id, env) constraint
-- cannot be violated by the copy below.

CREATE TABLE teams_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id     TEXT NOT NULL,
  submitter_email TEXT NOT NULL DEFAULT '',
  team_name       TEXT NOT NULL,
  repo_url        TEXT NOT NULL,
  members_json    TEXT NOT NULL DEFAULT '[]',
  env             TEXT NOT NULL DEFAULT 'production', -- production | staging
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(repo_url, env)
);

INSERT INTO teams_new (id, response_id, submitter_email, team_name, repo_url, members_json, env, created_at, updated_at)
SELECT id, response_id, COALESCE(submitter_email, ''), team_name, repo_url, members_json, env, created_at, updated_at
FROM teams;

DROP TABLE teams;
ALTER TABLE teams_new RENAME TO teams;

CREATE INDEX IF NOT EXISTS idx_teams_response_id ON teams(response_id);
CREATE INDEX IF NOT EXISTS idx_teams_env ON teams(env);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_response_id_env ON teams(response_id, env);
