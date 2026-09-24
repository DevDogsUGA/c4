// Plays a best-of-3 match, per DESIGN.md "The game" / "Time control &
// failure rules": alternating first player, game 1 (and any sudden-death
// game) decided by an arena coin flip. A tied best-of-3 (each side one win,
// possibly with draws mixed in) goes to sudden-death games — repeated,
// freshly coin-flipped single games — until one team reaches two match-game
// wins.
//
// Assumption (not spelled out verbatim in DESIGN.md, documented here for the
// validator): "tied" is generalized to "neither team has reached 2 wins yet"
// so that a heavily-drawn best-of-3 (e.g. 1 win / 2 draws, so 1-0 in wins
// after 3 games) also correctly continues into sudden death rather than
// being scored as decided on a 1-0 game-win count.

import type { GameRecord, MatchForfeit, MatchRecord, TeamRef, TeamSlot } from '@acm-uga/c4-contract';
import { gameWinningTeamSlot, playGame, type PlayerTransports } from './game-runner.js';
import type { Rng } from './rng.js';
import { coinFlipSlot } from './rng.js';
import type { BotTransport } from './types.js';

const WINS_NEEDED = 2;
const REGULAR_GAMES = 3;

/** BotTransport per team slot (0/1), persistent for the whole match — fresh containers are the caller's concern, not this module's. */
export interface MatchTransports {
  0: BotTransport;
  1: BotTransport;
}

export interface MatchConfig {
  matchId: string;
  phase: 'roundrobin' | 'bracket';
  round?: string;
  teams: [TeamRef, TeamRef];
  /** Per-player, per-game think budget in ms (THINK_BUDGET_MS, 5_000ms, in production; overridable in tests). */
  thinkBudgetMs: number;
  rng: Rng;
}

function otherSlot(slot: TeamSlot): TeamSlot {
  return slot === 0 ? 1 : 0;
}

export async function playMatch(transports: MatchTransports, config: MatchConfig): Promise<MatchRecord> {
  const gamesWon: [number, number] = [0, 0];
  const games: GameRecord[] = [];

  let firstPlayerTeam: TeamSlot = coinFlipSlot(config.rng);
  let coinFlip = true;
  let gameNumber = 1;

  while (gamesWon[0] < WINS_NEEDED && gamesWon[1] < WINS_NEEDED) {
    const playerTransports: PlayerTransports = {
      1: transports[firstPlayerTeam],
      2: transports[otherSlot(firstPlayerTeam)],
    };

    const record = await playGame(playerTransports, {
      matchId: config.matchId,
      gameNumber,
      firstPlayer: 1,
      firstPlayerTeam,
      coinFlip,
      thinkBudgetMs: config.thinkBudgetMs,
    });
    games.push(record);

    const winningTeam = gameWinningTeamSlot(record);
    if (winningTeam !== null) gamesWon[winningTeam]++;

    gameNumber++;
    if (gameNumber <= REGULAR_GAMES) {
      // Regular best-of-3 slate: alternate deterministically.
      firstPlayerTeam = otherSlot(firstPlayerTeam);
      coinFlip = false;
    } else {
      // Sudden death: fresh coin flip each game.
      firstPlayerTeam = coinFlipSlot(config.rng);
      coinFlip = true;
    }
  }

  const winnerTeam: TeamSlot = gamesWon[0] >= WINS_NEEDED ? 0 : 1;
  return {
    match_id: config.matchId,
    phase: config.phase,
    round: config.round,
    teams: config.teams,
    games,
    result: {
      winner_team: winnerTeam,
      games_won: gamesWon,
      reason: 'played',
    },
  };
}

/**
 * Builds the match record for a match forfeited entirely before any game
 * was played — a broken submission (checkout/build/startup failure) per
 * EVENT_PLAN.md's match-level forfeit reasons. No games are played.
 *
 * `forfeits` has one entry when a single team is broken (the other team
 * wins the match), or two entries — naming both team slots — for a double
 * forfeit, in which case `winner_team` is null: a loss for both teams (see
 * round-robin.ts standings and bracket handling in tournament-runner.ts).
 */
export function forfeitMatch(
  config: MatchConfig,
  forfeits: [MatchForfeit] | [MatchForfeit, MatchForfeit],
): MatchRecord {
  const winnerTeam: TeamSlot | null = forfeits.length === 2 ? null : otherSlot(forfeits[0].team);
  return {
    match_id: config.matchId,
    phase: config.phase,
    round: config.round,
    teams: config.teams,
    games: [],
    result: {
      winner_team: winnerTeam,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeits,
    },
  };
}

/**
 * Convenience wrapper for the single most common forfeit case (a bot did
 * not pass its /health check within the 30s off-clock grace). See
 * DESIGN.md: "Not healthy within 30s grace at match start: Forfeit the
 * match".
 */
export function startupForfeitMatch(config: MatchConfig, forfeitedTeam: TeamSlot): MatchRecord {
  return forfeitMatch(config, [{ team: forfeitedTeam, reason: 'startup_timeout' }]);
}
