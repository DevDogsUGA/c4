// Pure bracket-display logic.

import type { BracketMatch } from '@acm-uga/c4-contract';

export interface BracketRound {
  round: string;
  matches: BracketMatch[];
}

/**
 * Groups bracket matches by round, preserving each round's first-seen
 * order in the input array and sorting matches within a round by slot.
 */
export function groupBracketByRound(bracket: readonly BracketMatch[]): BracketRound[] {
  const order: string[] = [];
  const byRound = new Map<string, BracketMatch[]>();

  for (const match of bracket) {
    if (!byRound.has(match.round)) {
      byRound.set(match.round, []);
      order.push(match.round);
    }
    byRound.get(match.round)!.push(match);
  }

  return order.map((round) => ({
    round,
    matches: [...byRound.get(round)!].sort((a, b) => a.slot - b.slot),
  }));
}

/** The last round in bracket order -- conventionally the final. */
export function finalRound(bracket: readonly BracketMatch[]): BracketRound | null {
  const rounds = groupBracketByRound(bracket);
  return rounds.length > 0 ? rounds[rounds.length - 1]! : null;
}
