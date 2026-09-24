// Pure copy/labels for match-level forfeits (contract's MatchForfeit /
// MatchForfeitReason -- a whole match forfeited before, or instead of, any
// game being played) and game-level forfeits (contract's ForfeitReason --
// a single game ending via clock/protocol/crash failure). Kept separate
// from clock.ts (which reconstructs timelines, not copy) so stage
// components render every fail state with distinct, human-readable text
// instead of improvising strings inline.

import type { ForfeitReason, GameOutcome, MatchForfeitReason, MatchRecord } from '@acm-uga/c4-contract';

const MATCH_FORFEIT_LABELS: Record<MatchForfeitReason, string> = {
  startup_timeout: "Didn't start in time",
  build_failed: 'Build failed',
  checkout_failed: 'Repo unavailable',
};

/** Human copy for a single match-forfeit reason, e.g. "Build failed". */
export function matchForfeitReasonLabel(reason: MatchForfeitReason): string {
  return MATCH_FORFEIT_LABELS[reason];
}

/** True iff both teams forfeited the match -- per the contract, the only case `winner_team` is null. */
export function isDoubleForfeit(match: Pick<MatchRecord, 'result'>): boolean {
  return match.result.winner_team === null;
}

/**
 * A one-line description of a match's forfeit(s), e.g.
 * "Night Owls forfeits — Didn't start in time." for a single forfeit, or
 * "Double forfeit — neither team advances." for a double forfeit. Empty
 * string for a normally-played match (no forfeits).
 */
export function describeMatchForfeit(match: MatchRecord): string {
  const forfeits = match.result.forfeits;
  if (!forfeits || forfeits.length === 0) return '';
  if (forfeits.length === 2) return 'Double forfeit — neither team advances.';
  const forfeit = forfeits[0]!;
  const team = match.teams[forfeit.team]!;
  return `${team.name} forfeits — ${matchForfeitReasonLabel(forfeit.reason)}.`;
}

const GAME_FORFEIT_LABELS: Record<ForfeitReason, string> = {
  clock_expired: 'Clock expired',
  invalid_move: 'Invalid move',
  crash_loop: 'Crash loop',
};

/** Human copy for a single game-forfeit reason, e.g. "Clock expired". */
export function gameForfeitReasonLabel(reason: ForfeitReason): string {
  return GAME_FORFEIT_LABELS[reason];
}

/**
 * A one-line description of how a single game ended, for the states that
 * need explicit callout copy beyond the board itself: a forfeit (who, and
 * why) or a draw. Returns null for `four_in_a_row` -- the win highlight on
 * the board already communicates that outcome, no extra banner needed.
 */
export function describeGameOutcome(outcome: GameOutcome, forfeitedTeamName: string | null): string | null {
  if (outcome.type === 'draw') return 'DRAW';
  if (outcome.type === 'forfeit') {
    const who = forfeitedTeamName ?? 'The mover';
    return `${who} forfeits — ${gameForfeitReasonLabel(outcome.reason)}`;
  }
  return null;
}
