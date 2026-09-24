// Pure chess-clock reconstruction for a replayed game. Per DESIGN.md's
// "Time control & failure rules": each player starts a game with 10
// seconds of total think time; every move debits `think_ms` from the
// mover's clock, and a `restart` clock event additionally debits
// `billed_ms` (the crash-restart time billed to the crashing bot) at the
// point in the move list it occurred. Fully reconstructable from a
// GameRecord alone -- no match-engine changes, no wall-clock dependency.

import type { GameRecord } from '@acm-uga/c4-contract';

/** Starting think budget per player per game, per DESIGN.md. */
export const STARTING_CLOCK_MS = 10_000;

export interface ClockTick {
  /** 0-based index into the game's moves array this tick follows. */
  moveIndex: number;
  /** Remaining think time for player 1, after this move (and any restart billed at this point). */
  player1RemainingMs: number;
  /** Remaining think time for player 2, after this move (and any restart billed at this point). */
  player2RemainingMs: number;
  /** A restart billed to a player's clock at this exact move index, if any. */
  restart: { player: 1 | 2; billedMs: number } | null;
}

/**
 * Builds one ClockTick per move in `game.moves`, in order, tracking both
 * players' remaining think time. Restart events (`clock_events` of type
 * "restart") are billed to their player's clock at the tick matching their
 * `at_move` index, in addition to that move's own `think_ms`. Clocks are
 * clamped at 0 (a move/restart that would take a clock negative -- e.g. a
 * clock-expiry forfeit -- just floors it, so the UI never shows negative
 * time).
 */
export function buildClockTimeline(game: GameRecord): ClockTick[] {
  let p1 = STARTING_CLOCK_MS;
  let p2 = STARTING_CLOCK_MS;

  const restartsByMove = new Map<number, { player: 1 | 2; billedMs: number }>();
  for (const event of game.clock_events) {
    if (event.type === 'restart') {
      restartsByMove.set(event.at_move, { player: event.player, billedMs: event.billed_ms });
    }
  }

  return game.moves.map((move, moveIndex) => {
    if (move.player === 1) {
      p1 = Math.max(0, p1 - move.think_ms);
    } else {
      p2 = Math.max(0, p2 - move.think_ms);
    }

    const restart = restartsByMove.get(moveIndex) ?? null;
    if (restart) {
      if (restart.player === 1) p1 = Math.max(0, p1 - restart.billedMs);
      else p2 = Math.max(0, p2 - restart.billedMs);
    }

    return {
      moveIndex,
      player1RemainingMs: p1,
      player2RemainingMs: p2,
      restart,
    };
  });
}

/**
 * Which player seat (1 or 2) a team slot occupied in this game. The
 * match engine rotates which TEAM sits in each seat between games:
 * `first_player` is the seat that moved first, and `first_player_team`
 * is the team slot occupying that seat -- so the seat/team mapping must
 * be derived per game, never assumed (team 0 is NOT always player 1).
 * The UI uses this to pin each team's piece color and clock readout.
 */
export function seatForTeamSlot(
  game: Pick<GameRecord, 'first_player' | 'first_player_team'>,
  slot: 0 | 1,
): 1 | 2 {
  if (slot === game.first_player_team) return game.first_player;
  return game.first_player === 1 ? 2 : 1;
}

/** Below this threshold a clock reads `bulldog` (per REDESIGN_PLAN.md §4). */
export const CLOCK_WARN_MS = 2_000;
/** Below this threshold a clock reads `bulldog` (critically low). */
export const CLOCK_CRITICAL_MS = 500;

export type ClockUrgency = 'normal' | 'warn' | 'critical';

/** Classifies a remaining-ms value into a display urgency tier. */
export function clockUrgency(remainingMs: number): ClockUrgency {
  if (remainingMs < CLOCK_CRITICAL_MS) return 'critical';
  if (remainingMs < CLOCK_WARN_MS) return 'warn';
  return 'normal';
}

/** Formats remaining milliseconds as a clock readout, e.g. "9.4s" / "0.0s". */
export function formatClock(remainingMs: number): string {
  return `${(Math.max(0, remainingMs) / 1000).toFixed(1)}s`;
}

/** Formats a billed restart duration as a flash badge label, e.g. "-2.3s RESTART". */
export function formatRestartBadge(billedMs: number): string {
  return `-${(billedMs / 1000).toFixed(1)}s RESTART`;
}

/**
 * Formats remaining milliseconds at millisecond precision, zero-padded, e.g.
 * `8472` -> `"08.472"`, per SHOW_PLAN.md §6 ("8.472s" rendered as "08.472").
 * Clamped at 0 -- negative input renders as `"00.000"`.
 */
export function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalMs = Math.round(clamped);
  const seconds = Math.floor(totalMs / 1000);
  const millis = totalMs % 1000;
  return `${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Linearly interpolates a clock's displayed remaining time between the
 * pre-move value (`prevMs`) and the post-move value (`nextMs`) across a
 * move's animation window, for the continuous rAF-driven countdown look
 * (SHOW_PLAN.md §6). `t` is the fraction of the window elapsed, clamped to
 * [0, 1]; the result never dips below `nextMs` (the countdown never
 * undershoots its known endpoint).
 */
export function interpolateRemaining(prevMs: number, nextMs: number, t: number): number {
  const clampedT = Math.min(1, Math.max(0, t));
  const value = prevMs + (nextMs - prevMs) * clampedT;
  return Math.max(nextMs, value);
}
