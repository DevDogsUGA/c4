// Single-elimination bracket seeding, per DESIGN.md "Tournament structure":
// "Standings seed a single-elimination bracket (16 slots, scales to 32 if
// needed - never cap registrations). Top seeds get the byes; bracket
// arranged so seeds 1 and 2 can only meet in the final."
//
// Uses the standard recursive bracket-seeding construction (the same one
// NCAA-style brackets use): seed 1 and seed 2 are placed in opposite halves
// of the bracket at every split, so they can only meet in the final; seeds
// beyond the number of real teams are "phantom" byes, and phantom slots are
// distributed to the bracket positions that give the best real seeds a
// first-round pass, per the same construction.

import type { Team } from './types.js';

const MIN_BRACKET_SLOTS = 16;

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * The standard recursive bracket seed order: seedOrder(size)[i] is the seed
 * number occupying bracket line position i. E.g. seedOrder(4) = [1,4,2,3]
 * means line 0 = seed 1, line 1 = seed 4, line 2 = seed 2, line 3 = seed 3
 * -> round 1 is (1 v 4) and (2 v 3), so 1 and 2 can only meet in the final.
 */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s, n + 1 - s);
    }
    order = next;
  }
  return order;
}

export interface BracketPairing {
  /** Position of this match within its round, 0-based. */
  slot: number;
  /** null = bye (no opponent — never happens past round 1) or not-yet-determined (a later round awaiting an earlier winner). */
  teamA: Team | null;
  teamB: Team | null;
}

/**
 * Computes the bracket size (a power of two, at least `minSlots`, at least
 * enough to hold every team — DESIGN.md: "never cap registrations").
 */
export function bracketSize(teamCount: number, minSlots: number = MIN_BRACKET_SLOTS): number {
  return nextPowerOfTwo(Math.max(minSlots, teamCount));
}

/**
 * Builds round 1 pairings from ranked standings (best team first). Teams
 * beyond `standings.length` up to the bracket size are phantom byes
 * (`teamB`/`teamA` null on that pairing); a real team paired against a
 * phantom automatically advances (see `isBye`/`byeWinner`).
 */
export function firstRoundPairings(standings: readonly Team[], minSlots: number = MIN_BRACKET_SLOTS): BracketPairing[] {
  const size = bracketSize(standings.length, minSlots);
  const order = seedOrder(size);
  const lineup: (Team | null)[] = order.map((seed) => standings[seed - 1] ?? null);
  return pairUp(lineup);
}

/**
 * Builds the next round's pairings from the current round's winners (in
 * slot order — winners[i] is the winner of pairing `i` in the prior round,
 * or null if that slot doesn't exist / isn't decided yet).
 */
export function nextRoundPairings(winners: readonly (Team | null)[]): BracketPairing[] {
  return pairUp(winners);
}

function pairUp(lineup: readonly (Team | null)[]): BracketPairing[] {
  const pairings: BracketPairing[] = [];
  for (let i = 0; i < lineup.length; i += 2) {
    pairings.push({ slot: i / 2, teamA: lineup[i] ?? null, teamB: lineup[i + 1] ?? null });
  }
  return pairings;
}

/** True if exactly one side of the pairing is a real team (the other is a bye/phantom slot). */
export function isBye(pairing: BracketPairing): boolean {
  return (pairing.teamA === null) !== (pairing.teamB === null);
}

/** The team that auto-advances on a bye, or null if this isn't a bye. */
export function byeWinner(pairing: BracketPairing): Team | null {
  if (!isBye(pairing)) return null;
  return pairing.teamA ?? pairing.teamB;
}

/**
 * Human-readable round label for a round whose pairings decide among
 * `teamsEnteringRound` teams (e.g. 16 teams enter "Round of 16", producing
 * 8 winners who enter "Quarterfinal", etc).
 */
export function roundLabel(teamsEnteringRound: number): string {
  switch (teamsEnteringRound) {
    case 2:
      return 'Final';
    case 4:
      return 'Semifinal';
    case 8:
      return 'Quarterfinal';
    default:
      return `Round of ${teamsEnteringRound}`;
  }
}
