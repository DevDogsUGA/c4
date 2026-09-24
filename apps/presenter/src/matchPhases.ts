// Pure derivation of a match replay's phase sequence (SHOW_PLAN.md §6):
// games 1 & 2 replay simultaneously on two boards ("dual"), then every
// sudden-death game beyond that gets a coin-flip theater beat followed by
// its own single-board replay, and the whole thing always closes on a
// result/settle phase. A match with only one game (e.g. a forfeited
// second game was never played) just replays that one game; a match with
// zero games (a startup-timeout forfeit, no board ever touched) is a
// walkover straight to the result.

import type { GameRecord, MatchRecord } from '@acm-uga/c4-contract';

export type MatchPhase =
  | { kind: 'dual'; games: [GameRecord, GameRecord] }
  | { kind: 'coinflip'; game: GameRecord }
  | { kind: 'single'; game: GameRecord }
  | { kind: 'walkover' }
  | { kind: 'result' };

/** Builds the ordered phase list for replaying one match. */
export function buildMatchPhases(match: MatchRecord): MatchPhase[] {
  const games = match.games;
  const phases: MatchPhase[] = [];

  if (games.length === 0) {
    phases.push({ kind: 'walkover' });
  } else if (games.length === 1) {
    phases.push({ kind: 'single', game: games[0]! });
  } else {
    phases.push({ kind: 'dual', games: [games[0]!, games[1]!] });
    for (const game of games.slice(2)) {
      phases.push({ kind: 'coinflip', game });
      phases.push({ kind: 'single', game });
    }
  }

  phases.push({ kind: 'result' });
  return phases;
}

/**
 * The persistent "board region" (SHOW_PLAN.md §6) governing everything up
 * to and including `phaseIndex`: which board(s) should be on screen right
 * now. A `coinflip` or `result` phase doesn't change which board(s) are
 * showing (the coin-flip theater overlays whatever's already up; the result
 * phase just adds the winner banner) -- this walks phases up to
 * `phaseIndex` and returns the last board-defining one.
 */
export type BoardRegion =
  | { kind: 'walkover' }
  | { kind: 'dual'; games: [GameRecord, GameRecord] }
  | { kind: 'single'; game: GameRecord };

export function resolveBoardRegion(phases: readonly MatchPhase[], phaseIndex: number): BoardRegion {
  let region: BoardRegion = { kind: 'walkover' };
  for (let i = 0; i <= phaseIndex && i < phases.length; i++) {
    const phase = phases[i]!;
    if (phase.kind === 'dual') region = { kind: 'dual', games: phase.games };
    else if (phase.kind === 'single') region = { kind: 'single', game: phase.game };
    else if (phase.kind === 'walkover') region = { kind: 'walkover' };
    // 'coinflip' and 'result' don't change the persistent board region.
  }
  return region;
}
