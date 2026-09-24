export interface Env {
  DB: D1Database;
  FORM_HMAC_SECRET: string;
  ROSTER_TOKEN: string;
  RESULTS_TOKEN: string;
  GITHUB_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  ADMIN_EMAILS?: string;
  /**
   * Selects which routes this deployment serves, for splitting the Worker
   * across two workers.dev hosts (Cloudflare Access can only gate a whole
   * hostname there, not a path):
   *   - unset      -> everything (single-Worker custom-domain deployment)
   *   - 'public'   -> /, /health, /api/form, /api/roster, /api/results, cron
   *   - 'admin'    -> /admin* only (also aliased at /); everything else 404s
   */
  MODE?: 'public' | 'admin';
}

export type TeamEnv = 'production' | 'staging';

/** Body posted by the Apps Script on form submit/edit. */
export interface FormPayload {
  response_id: string;
  submitter_email: string;
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
