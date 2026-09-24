// Shapes shared across arena-watch. Kept hand-rolled (no zod dep here) since
// arena-watch only reads these, it doesn't own the schema -- packages/contract
// and the registry Worker are the source of truth.

export interface RosterTeam {
  id: string;
  team_name: string;
  repo_url: string;
  members: string[];
  submitter_email: string;
  updated_at: string;
}

export interface Roster {
  teams: RosterTeam[];
}

export type ResultStatus = 'building' | 'passed' | 'failed';
export type ResultStage = 'checkout' | 'build' | 'health' | 'smoke';

export interface ResultPayload {
  repo_url: string;
  commit: string;
  status: ResultStatus;
  stage?: ResultStage;
  detail?: string;
  log_tail?: string;
  at: string;
}

// One row of `c4 validate --json` output.
export interface ValidateResult {
  team: string;
  repo_url: string;
  commit: string;
  ok: boolean;
  stage: ResultStage;
  detail?: string;
  ms: number;
}
