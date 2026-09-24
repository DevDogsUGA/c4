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
//
// Per EVENT_PLAN.md, a single broken team must never abort the tournament
// run: any failure starting a bot (build failure, startup timeout, or any
// other error) is turned into a match-level forfeit for that team's slot
// rather than rethrown. If both teams fail, the match is a double forfeit
// (winner_team null, forfeits naming both slots) — see match-runner.ts
// forfeitMatch / MatchResultSchema's superRefine invariants.

import { THINK_BUDGET_MS, type MatchForfeit, type MatchForfeitReason, type MatchRecord, type TeamRef } from '@acm-uga/c4-contract';
import { ImageBuildError, StartupTimeoutError } from './docker/container-runtime.js';
import { forfeitMatch, playMatch, type MatchConfig, type MatchTransports } from './match-runner.js';
import type { Rng } from './rng.js';
import type { BotProvider, StartedBot } from './types.js';
import { toTeamRef, type Team } from './types.js';

const DEFAULT_BOT_PORT = 8000;
const DEFAULT_HEALTH_GRACE_MS = 30_000;

export interface OrchestrateMatchOptions {
  matchId: string;
  phase: 'roundrobin' | 'bracket';
  round?: string;
  /** Teams, index-aligned with `repoDirs` — team slot 0/1 for this match. */
  teams: [Team, Team];
  /** Checked-out repo directories (each containing a Dockerfile), index-aligned with `teams`. Ignored for a slot with a `preForfeits` entry. */
  repoDirs: [string, string];
  provider: BotProvider;
  rng: Rng;
  /** Per-player, per-game think budget in ms. Default THINK_BUDGET_MS (5s) per EVENT_PLAN.md. */
  thinkBudgetMs?: number;
  /** Port the bot listens on (PORT env). Default 8000. */
  botPort?: number;
  /** Off-clock startup health-check grace in ms. Default 30_000 per DESIGN.md. */
  healthGraceMs?: number;
  /**
   * Pre-determined forfeits for teams already known broken from the
   * freeze/prepare phase (checkout_failed or build_failed — see
   * prepare.ts). A slot with an entry here skips `provider.start`
   * entirely: no per-match checkout or build work for a team that's
   * already known to be broken.
   */
  preForfeits?: [MatchForfeitReason | undefined, MatchForfeitReason | undefined];
}

function classifyStartError(err: unknown): MatchForfeitReason {
  if (err instanceof StartupTimeoutError) return 'startup_timeout';
  if (err instanceof ImageBuildError) return 'build_failed';
  // Any other failure to start (e.g. a Docker daemon hiccup, an
  // unclassified build/runtime error) is treated as a build failure — the
  // most accurate available bucket, and one that still forfeits only the
  // match(es) involving this team rather than aborting the run.
  return 'build_failed';
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
    thinkBudgetMs = THINK_BUDGET_MS,
    botPort = DEFAULT_BOT_PORT,
    healthGraceMs = DEFAULT_HEALTH_GRACE_MS,
    preForfeits,
  } = options;

  const teamRefs: [TeamRef, TeamRef] = [toTeamRef(teams[0]), toTeamRef(teams[1])];
  const matchConfig: MatchConfig = { matchId, phase, round, teams: teamRefs, thinkBudgetMs, rng };

  const started: [StartedBot | undefined, StartedBot | undefined] = [undefined, undefined];
  const forfeits: MatchForfeit[] = [];

  try {
    for (const slot of [0, 1] as const) {
      const pre = preForfeits?.[slot];
      if (pre) {
        forfeits.push({ team: slot, reason: pre });
        continue;
      }
      try {
        started[slot] = await provider.start({ repoDir: repoDirs[slot], port: botPort, healthGraceMs });
      } catch (err) {
        forfeits.push({ team: slot, reason: classifyStartError(err) });
      }
    }

    if (forfeits.length > 0) {
      return forfeitMatch(matchConfig, forfeits.length === 2 ? [forfeits[0], forfeits[1]] : [forfeits[0]]);
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
