// Pure layout derivations for the two-sided bracket (SHOW_PLAN.md §5): left
// half advances rightward, right half advances leftward, the FINAL sits in
// the center. Also derives the ordered elimination/progression sequence
// used to drive the "loser tumbles, winner slides in" animation.

import type { BracketMatch, MatchRecord } from '@acm-uga/c4-contract';
import type { BracketRound } from './bracket.js';

export interface SplitBracket {
  /** False when the bracket falls back to a one-sided layout (< 4 first-round matches). */
  sided: boolean;
  left: BracketRound[];
  right: BracketRound[];
  final: BracketRound | null;
}

/** Below this many first-round matches, the two-sided split isn't worth it -- fall back to one-sided. */
const MIN_FIRST_ROUND_MATCHES_FOR_SIDED = 4;

/**
 * Splits bracket rounds into a left half, a right half, and the final,
 * for the two-sided broadcast-bracket layout. Round 1's upper half of
 * slots (lower slot indices) feeds the left side; each subsequent
 * non-final round is split the same way (its matches are already halved
 * in count by bracket structure, so a straight slot-order split lines up
 * with which round-1 side fed them). Falls back to `sided: false` (all
 * non-final rounds in `left`, `right` empty) when the bracket has fewer
 * than 4 first-round matches -- too small to read as two sides.
 */
export function splitBracket(rounds: readonly BracketRound[]): SplitBracket {
  if (rounds.length === 0) {
    return { sided: false, left: [], right: [], final: null };
  }

  const finalRound = rounds[rounds.length - 1]!;
  const nonFinalRounds = rounds.slice(0, -1);
  const firstRoundMatchCount = rounds[0]!.matches.length;

  if (firstRoundMatchCount < MIN_FIRST_ROUND_MATCHES_FOR_SIDED || nonFinalRounds.length === 0) {
    return { sided: false, left: nonFinalRounds, right: [], final: finalRound };
  }

  const left: BracketRound[] = [];
  const right: BracketRound[] = [];

  for (const round of nonFinalRounds) {
    const half = Math.ceil(round.matches.length / 2);
    const leftMatches = round.matches.slice(0, half);
    const rightMatches = round.matches.slice(half);
    left.push({ round: round.round, matches: leftMatches });
    if (rightMatches.length > 0) right.push({ round: round.round, matches: rightMatches });
  }

  return { sided: true, left, right, final: finalRound };
}

export interface EliminationEntry {
  /** Stable key for this bracket slot: `${round}#${slot}`. */
  key: string;
  round: string;
  slot: number;
  winnerName: string;
  /** Null for a bye (nobody was eliminated). */
  loserName: string | null;
}

/**
 * The ordered sequence of resolved bracket slots (played matches and byes),
 * in bracket order (round order, then slot order within a round), each with
 * its winner/loser names -- drives the elimination/progression animation
 * (SHOW_PLAN.md §5). Slots with no determined winner yet are omitted.
 */
export function eliminationSequence(
  rounds: readonly BracketRound[],
  matchesById: ReadonlyMap<string, MatchRecord>,
): EliminationEntry[] {
  const entries: EliminationEntry[] = [];

  for (const round of rounds) {
    for (const bracketMatch of round.matches) {
      const entry = resolveEntry(bracketMatch, matchesById);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

function resolveEntry(
  bracketMatch: BracketMatch,
  matchesById: ReadonlyMap<string, MatchRecord>,
): EliminationEntry | null {
  if (!bracketMatch.winner) return null;

  const key = `${bracketMatch.round}#${bracketMatch.slot}`;

  if (bracketMatch.bye) {
    return { key, round: bracketMatch.round, slot: bracketMatch.slot, winnerName: bracketMatch.winner.name, loserName: null };
  }

  if (!bracketMatch.match_id || !matchesById.has(bracketMatch.match_id)) return null;

  const loser =
    bracketMatch.team_a?.name === bracketMatch.winner.name ? bracketMatch.team_b : bracketMatch.team_a;

  return {
    key,
    round: bracketMatch.round,
    slot: bracketMatch.slot,
    winnerName: bracketMatch.winner.name,
    loserName: loser?.name ?? null,
  };
}
