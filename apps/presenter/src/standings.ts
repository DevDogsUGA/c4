// Pure standings-display logic.

import type { StandingsEntry } from '@connect-4/contract';

/** Standings sorted for display: rank ascending (rank is already computed upstream by match-engine). */
export function sortStandings(entries: readonly StandingsEntry[]): StandingsEntry[] {
  return [...entries].sort((a, b) => a.rank - b.rank);
}
