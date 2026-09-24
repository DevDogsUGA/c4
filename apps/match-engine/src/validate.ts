// `c4 validate`: pull all -> build -> smoke game, per DESIGN.md's dev-hour
// step 5 ("Arena validate command ... runs at T-30, T-15, T-5; failures
// announced to the room"). A readiness check, not a scored game: it never
// touches the chess clock.

import { emptyBoard } from '@acm-uga/c4-engine';
import { StartupTimeoutError } from './docker/container-runtime.js';
import type { BotProvider, StartedBot, Team } from './types.js';

export interface ValidateOptions {
  provider: BotProvider;
  resolveRepoDir: (team: Team) => Promise<string> | string;
  botPort?: number;
  healthGraceMs?: number;
}

export interface ValidateTeamResult {
  team: Team;
  ok: boolean;
  detail: string;
}

const DEFAULT_BOT_PORT = 8000;
const DEFAULT_HEALTH_GRACE_MS = 30_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function validateTeam(team: Team, options: ValidateOptions): Promise<ValidateTeamResult> {
  const { provider, resolveRepoDir, botPort = DEFAULT_BOT_PORT, healthGraceMs = DEFAULT_HEALTH_GRACE_MS } = options;

  let repoDir: string;
  try {
    repoDir = await resolveRepoDir(team);
  } catch (err) {
    return { team, ok: false, detail: `checkout failed: ${errorMessage(err)}` };
  }

  let started: StartedBot;
  try {
    started = await provider.start({ repoDir, port: botPort, healthGraceMs });
  } catch (err) {
    if (err instanceof StartupTimeoutError) {
      return { team, ok: false, detail: 'did not pass /health within the startup grace period' };
    }
    return { team, ok: false, detail: `build/start failed: ${errorMessage(err)}` };
  }

  try {
    const outcome = await started.transport.move({
      you: 1,
      board: emptyBoard(),
      moves: [],
      game: { match_id: 'validate', game_number: 1, clock_remaining_ms: 10_000 },
    });
    if (outcome.type !== 'ok') {
      return { team, ok: false, detail: `smoke /move failed: ${outcome.detail}` };
    }
    return { team, ok: true, detail: `smoke move ok (column ${outcome.column})` };
  } finally {
    await started.dispose();
  }
}

export async function validateAll(teams: Team[], options: ValidateOptions): Promise<ValidateTeamResult[]> {
  return Promise.all(teams.map((team) => validateTeam(team, options)));
}
