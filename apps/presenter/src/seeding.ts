// Pure derivations for the seeding-reveal scene (SHOW_PLAN.md §4.2):
// teams first render in gray alphabetical order with 0-0 records, then
// FLIP-animate into final rank order while a results marquee ticks through
// round-robin scores. All of this is precomputed here as plain data; the
// component only needs to interpolate between the two orderings and render
// the marquee strings.

import type { MatchRecord, StandingsEntry } from '@acm-uga/c4-contract';
import { sortStandings } from './standings.js';

/** Every entry, sorted alphabetically by team name (the reveal's starting order). */
export function alphabeticalOrder(standings: readonly StandingsEntry[]): StandingsEntry[] {
  return [...standings].sort((a, b) => a.team.name.localeCompare(b.team.name));
}

/** Every entry, sorted by final rank (the reveal's settled order). */
export function finalOrder(standings: readonly StandingsEntry[]): StandingsEntry[] {
  return sortStandings(standings);
}

export interface SeedingMove {
  name: string;
  /** Row index in the alphabetical (starting) order. */
  fromIndex: number;
  /** Row index in the final rank (settled) order. */
  toIndex: number;
  wins: number;
  losses: number;
}

/**
 * Per-team FLIP move descriptors: where each team's row starts (alphabetical)
 * and ends (final rank), plus the match record it settles on. Order of the
 * returned array follows the alphabetical (starting) order, matching how the
 * rows are initially laid out in the DOM for the FLIP measurement.
 */
export function sortMoves(standings: readonly StandingsEntry[]): SeedingMove[] {
  const from = alphabeticalOrder(standings);
  const to = finalOrder(standings);
  const toIndexByName = new Map(to.map((entry, index) => [entry.team.name, index]));

  return from.map((entry, fromIndex) => ({
    name: entry.team.name,
    fromIndex,
    toIndex: toIndexByName.get(entry.team.name) ?? fromIndex,
    wins: entry.match_wins,
    losses: entry.match_losses,
  }));
}

/**
 * One marquee line per round-robin match, e.g. "TEAM A def. TEAM B 2-1".
 * The winner is `result.winner_team`; the score is `games_won` ordered
 * winner-first. Non-roundrobin (bracket) matches are excluded -- the
 * marquee is round-robin flavor only, per SHOW_PLAN.md §4.2.
 */
export function marqueeLines(matches: readonly MatchRecord[]): string[] {
  return matches
    .filter((match) => match.phase === 'roundrobin')
    .map((match) => {
      const winnerSlot = match.result.winner_team;
      const loserSlot = winnerSlot === 0 ? 1 : 0;
      const winner = match.teams[winnerSlot]!.name;
      const loser = match.teams[loserSlot]!.name;
      const winnerGames = match.result.games_won[winnerSlot];
      const loserGames = match.result.games_won[loserSlot];
      return `${winner} def. ${loser} ${winnerGames}-${loserGames}`;
    });
}
