export interface Env {
  DB: D1Database;
  FORM_HMAC_SECRET: string;
  ROSTER_TOKEN: string;
  RESULTS_TOKEN: string;
  GITHUB_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  ADMIN_EMAILS?: string;
  /**
   * Zero Trust team domain (e.g. "devdogs.cloudflareaccess.com") used to
   * fetch Access's public keys (`https://<domain>/cdn-cgi/access/certs`)
   * and to check the JWT `iss` claim. Required for admin routes to work;
   * they 503 ("admin not configured") without it.
   */
  ACCESS_TEAM_DOMAIN?: string;
  /**
   * The Access application's Audience (AUD) tag, checked against the JWT
   * `aud` claim. Required for admin routes to work; they 503 without it.
   */
  ACCESS_AUD?: string;
  /**
   * Selects which routes this deployment serves, for splitting the Worker
   * across two workers.dev hosts (Cloudflare Access can only gate a whole
   * hostname there, not a path):
   *   - unset/'public' -> /, /health, /api/form, /api/roster, /api/results,
   *                        cron; no admin routes (safe default)
   *   - 'admin'         -> /admin* only (also aliased at /); everything
   *                        else 404s
   *   - 'both'          -> everything, including /admin*, from one Worker
   *                        (single-Worker custom-domain deployment, where
   *                        Cloudflare Access gates just the /admin path)
   */
  MODE?: 'public' | 'admin' | 'both';
}

export type TeamEnv = 'production' | 'staging';

/** Body posted by the Apps Script on form submit/edit. */
export interface FormPayload {
  response_id: string;
  /**
   * Optional: the Google Form no longer collects email addresses (everyone
   * registers in person), so this is often empty/missing. Never used for
   * team identity — see response_id — and stored as-is (empty string
   * allowed).
   */
  submitter_email?: string;
  team_name: string;
  repo_url: string;
  members: string[];
  submitted_at: string;
  /** Set from the Apps Script's FORM_ENV property; defaults to 'production'. */
  env?: TeamEnv;
}

export type ResultStatus = 'building' | 'passed' | 'failed';
export type ResultStage = 'checkout' | 'build' | 'health' | 'smoke';

/** Body posted by the arena machine. */
export interface ResultsPayload {
  repo_url: string;
  commit: string;
  status: ResultStatus;
  stage: ResultStage;
  detail?: string;
  log_tail?: string;
  at: string;
}

/** A single roster entry, per the shared-interfaces contract. */
export interface RosterTeam {
  id: number;
  team_name: string;
  repo_url: string;
  members: string[];
  submitter_email: string;
  updated_at: string;
}

export interface TeamRow {
  id: number;
  response_id: string;
  submitter_email: string;
  team_name: string;
  repo_url: string;
  members_json: string;
  env: TeamEnv;
  created_at: string;
  updated_at: string;
}

export type Reachability = 'reachable' | 'empty' | 'unreachable' | 'private' | 'unknown';
export type ActionsStatus = 'success' | 'failure' | 'in_progress' | 'none' | 'unknown';

export interface RepoStatusRow {
  repo_url: string;
  reachability: Reachability;
  latest_commit: string | null;
  actions_status: ActionsStatus;
  actions_run_url: string | null;
  checked_at: string | null;
}

export interface LatestResultRow {
  repo_url: string;
  commit_sha: string;
  status: ResultStatus;
  stage: ResultStage;
  detail: string | null;
  log_tail: string | null;
  at: string;
  updated_at: string;
}
