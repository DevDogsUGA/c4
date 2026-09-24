import type {
  FormPayload,
  LatestResultRow,
  ResultsPayload,
  RepoStatusRow,
  RosterTeam,
  TeamEnv,
  TeamRow,
} from './types';

export const MAX_TEAMS = 32;

export function rowToRoster(row: TeamRow): RosterTeam {
  return {
    id: row.id,
    team_name: row.team_name,
    repo_url: row.repo_url,
    members: JSON.parse(row.members_json) as string[],
    submitter_email: row.submitter_email,
    updated_at: row.updated_at,
  };
}

/** All teams, optionally scoped to one environment (production/staging). */
export async function listTeams(db: D1Database, env?: TeamEnv): Promise<TeamRow[]> {
  if (env) {
    const { results } = await db
      .prepare('SELECT * FROM teams WHERE env = ? ORDER BY id ASC')
      .bind(env)
      .all<TeamRow>();
    return results ?? [];
  }
  const { results } = await db.prepare('SELECT * FROM teams ORDER BY id ASC').all<TeamRow>();
  return results ?? [];
}

export async function getTeamByResponseId(db: D1Database, responseId: string, env: TeamEnv): Promise<TeamRow | null> {
  return db
    .prepare('SELECT * FROM teams WHERE response_id = ? AND env = ?')
    .bind(responseId, env)
    .first<TeamRow>();
}

export async function getTeamByRepoUrl(db: D1Database, repoUrl: string, env: TeamEnv): Promise<TeamRow | null> {
  return db
    .prepare('SELECT * FROM teams WHERE repo_url = ? AND env = ?')
    .bind(repoUrl, env)
    .first<TeamRow>();
}

export async function countTeams(db: D1Database, env: TeamEnv): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM teams WHERE env = ?').bind(env).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deleteTeam(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
}

export type UpsertOutcome =
  | { ok: true; team: TeamRow; created: boolean; changed: boolean }
  | { ok: false; status: number; reason: string };

/**
 * Upsert a team registration. Identity is (response_id, env): the Google
 * Form doesn't collect email addresses (everyone registers in person), but
 * a response id is stable across "edit your response" edits, so the same
 * response_id updates the existing team rather than creating a duplicate.
 * submitter_email is stored as-is (often '') and never used for identity.
 * Enforces the 32-team cap on new teams and rejects a repo URL already
 * claimed by a *different* response_id in the same env.
 */
export async function upsertTeam(
  db: D1Database,
  payload: FormPayload,
  normalizedRepoUrl: string,
  now: string,
): Promise<UpsertOutcome> {
  const email = (payload.submitter_email ?? '').trim().toLowerCase();
  const env: TeamEnv = payload.env === 'staging' ? 'staging' : 'production';
  const responseId = payload.response_id;

  const conflicting = await getTeamByRepoUrl(db, normalizedRepoUrl, env);
  if (conflicting && conflicting.response_id !== responseId) {
    return { ok: false, status: 409, reason: 'repo_url already registered by another team' };
  }

  const existing = await getTeamByResponseId(db, responseId, env);
  const membersJson = JSON.stringify(payload.members);

  if (existing) {
    // The Apps Script re-sends every response on a timer; an identical
    // re-send must be a no-op (no write, no Discord post, no log line).
    const changed =
      existing.team_name !== payload.team_name ||
      existing.repo_url !== normalizedRepoUrl ||
      existing.members_json !== membersJson ||
      (existing.submitter_email ?? '') !== email;
    if (!changed) return { ok: true, team: existing, created: false, changed: false };
    await db
      .prepare(
        `UPDATE teams SET submitter_email = ?, team_name = ?, repo_url = ?, members_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(email, payload.team_name, normalizedRepoUrl, membersJson, now, existing.id)
      .run();
    const updated = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(existing.id).first<TeamRow>();
    return { ok: true, team: updated as TeamRow, created: false, changed: true };
  }

  const count = await countTeams(db, env);
  if (env === 'production' && count >= MAX_TEAMS) {
    return { ok: false, status: 403, reason: `team cap (${MAX_TEAMS}) reached` };
  }

  await db
    .prepare(
      `INSERT INTO teams (response_id, submitter_email, team_name, repo_url, members_json, env, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(responseId, email, payload.team_name, normalizedRepoUrl, membersJson, env, now, now)
    .run();

  const created = await getTeamByResponseId(db, responseId, env);
  return { ok: true, team: created as TeamRow, created: true, changed: true };
}

export async function logFormSubmission(
  db: D1Database,
  opts: {
    response_id?: string | null;
    submitter_email?: string | null;
    team_name?: string | null;
    repo_url?: string | null;
    env?: TeamEnv;
    outcome: 'accepted' | 'rejected';
    reject_reason?: string | null;
  },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO form_log (response_id, submitter_email, team_name, repo_url, env, outcome, reject_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      opts.response_id ?? null,
      opts.submitter_email ?? null,
      opts.team_name ?? null,
      opts.repo_url ?? null,
      opts.env ?? 'production',
      opts.outcome,
      opts.reject_reason ?? null,
      now,
    )
    .run();
}

export async function listFormLog(db: D1Database, limit = 200) {
  const { results } = await db
    .prepare('SELECT * FROM form_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return results ?? [];
}

export async function getLatestResult(db: D1Database, repoUrl: string): Promise<LatestResultRow | null> {
  return db.prepare('SELECT * FROM latest_results WHERE repo_url = ?').bind(repoUrl).first<LatestResultRow>();
}

export async function recordResult(db: D1Database, payload: ResultsPayload, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO results (repo_url, commit_sha, status, stage, detail, log_tail, at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.repo_url,
      payload.commit,
      payload.status,
      payload.stage,
      payload.detail ?? null,
      payload.log_tail ?? null,
      payload.at,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO latest_results (repo_url, commit_sha, status, stage, detail, log_tail, at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_url) DO UPDATE SET
         commit_sha = excluded.commit_sha,
         status = excluded.status,
         stage = excluded.stage,
         detail = excluded.detail,
         log_tail = excluded.log_tail,
         at = excluded.at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      payload.repo_url,
      payload.commit,
      payload.status,
      payload.stage,
      payload.detail ?? null,
      payload.log_tail ?? null,
      payload.at,
      now,
    )
    .run();
}

export async function listResultHistory(db: D1Database, repoUrl: string, limit = 50) {
  const { results } = await db
    .prepare('SELECT * FROM results WHERE repo_url = ? ORDER BY id DESC LIMIT ?')
    .bind(repoUrl, limit)
    .all();
  return results ?? [];
}

export async function listLatestResults(db: D1Database): Promise<LatestResultRow[]> {
  const { results } = await db.prepare('SELECT * FROM latest_results').all<LatestResultRow>();
  return results ?? [];
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export async function isCompetitionStarted(db: D1Database): Promise<boolean> {
  return (await getSetting(db, 'competition_started')) === 'true';
}

export async function getRepoStatus(db: D1Database, repoUrl: string): Promise<RepoStatusRow | null> {
  return db.prepare('SELECT * FROM repo_status WHERE repo_url = ?').bind(repoUrl).first<RepoStatusRow>();
}

export async function upsertRepoStatus(db: D1Database, row: RepoStatusRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO repo_status (repo_url, reachability, latest_commit, actions_status, actions_run_url, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_url) DO UPDATE SET
         reachability = excluded.reachability,
         latest_commit = excluded.latest_commit,
         actions_status = excluded.actions_status,
         actions_run_url = excluded.actions_run_url,
         checked_at = excluded.checked_at`,
    )
    .bind(
      row.repo_url,
      row.reachability,
      row.latest_commit,
      row.actions_status,
      row.actions_run_url,
      row.checked_at,
    )
    .run();
}

export async function listRepoStatuses(db: D1Database): Promise<RepoStatusRow[]> {
  const { results } = await db.prepare('SELECT * FROM repo_status').all<RepoStatusRow>();
  return results ?? [];
}
