// Ties bot provisioning to the Docker-free match-runner: starts a bot for
// each team (off-clock health grace per DESIGN.md), plays the match, and
// always cleans up.
//
// This is the only place in the package that imports both a BotProvider and
// match-runner.ts — it exists specifically so match-runner.ts itself never
// has to know Docker (or even HTTP) exists, per IMPLEMENTATION_PLAN.md's
// testability requirement. Depending on the injected `provider`, this whole
// module runs against real Docker containers or an in-process fake with
// zero code changes.

import type { MatchRecord, TeamRef } from '@connect-4/contract';
import { StartupTimeoutError } from './docker/container-runtime.js';
import { playMatch, startupForfeitMatch, type MatchConfig, type MatchTransports } from './match-runner.js';
import type { Rng } from './rng.js';
import type { BotProvider, StartedBot } from './types.js';
import { toTeamRef, type Team } from './types.js';

const DEFAULT_THINK_BUDGET_MS = 10_000;
const DEFAULT_BOT_PORT = 8000;
const DEFAULT_HEALTH_GRACE_MS = 30_000;

export interface OrchestrateMatchOptions {
  matchId: string;
  phase: 'roundrobin' | 'bracket';
  round?: string;
  /** Teams, index-aligned with `repoDirs` — team slot 0/1 for this match. */
  teams: [Team, Team];
  /** Checked-out repo directories (each containing a Dockerfile), index-aligned with `teams`. */
  repoDirs: [string, string];
  provider: BotProvider;
  rng: Rng;
  /** Per-player, per-game think budget in ms. Default 10_000 per DESIGN.md. */
  thinkBudgetMs?: number;
  /** Port the bot listens on (PORT env). Default 8000. */
  botPort?: number;
  /** Off-clock startup health-check grace in ms. Default 30_000 per DESIGN.md. */
  healthGraceMs?: number;
}

export async function orchestrateMatch(options: OrchestrateMatchOptions): Promise<MatchRecord> {
  const {
    matchId,
    phase,
    round,
    teams,
    repoDirs,
    provider,
    rng,
    thinkBudgetMs = DEFAULT_THINK_BUDGET_MS,
    botPort = DEFAULT_BOT_PORT,
    healthGraceMs = DEFAULT_HEALTH_GRACE_MS,
  } = options;

  const teamRefs: [TeamRef, TeamRef] = [toTeamRef(teams[0]), toTeamRef(teams[1])];
  const matchConfig: MatchConfig = { matchId, phase, round, teams: teamRefs, thinkBudgetMs, rng };

  const started: [StartedBot | undefined, StartedBot | undefined] = [undefined, undefined];

  try {
    for (const slot of [0, 1] as const) {
      try {
        started[slot] = await provider.start({ repoDir: repoDirs[slot], port: botPort, healthGraceMs });
      } catch (err) {
        if (err instanceof StartupTimeoutError) {
          return startupForfeitMatch(matchConfig, slot);
        }
        throw err;
      }
    }

    const transports: MatchTransports = {
      0: started[0]!.transport,
      1: started[1]!.transport,
    };

    return await playMatch(transports, matchConfig);
  } finally {
    await Promise.all(started.map((s) => s?.dispose()));
  }
}
