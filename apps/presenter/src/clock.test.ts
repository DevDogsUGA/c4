import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@acm-uga/c4-contract';
import {
  buildClockTimeline,
  CLOCK_CRITICAL_MS,
  CLOCK_WARN_MS,
  clockUrgency,
  formatClock,
  formatClockMs,
  formatRestartBadge,
  interpolateRemaining,
  seatForTeamSlot,
  STARTING_CLOCK_MS,
} from './clock.js';

const baseGame: GameRecord = {
  game_number: 1,
  first_player: 1,
  first_player_team: 0,
  coin_flip: true,
  moves: [
    { player: 1, column: 0, think_ms: 1000 },
    { player: 2, column: 1, think_ms: 2000 },
    { player: 1, column: 2, think_ms: 500 },
  ],
  clock_events: [],
  outcome: { type: 'four_in_a_row', winner: 1 },
};

describe('buildClockTimeline', () => {
  it('starts both players at STARTING_CLOCK_MS and debits only the mover', () => {
    const ticks = buildClockTimeline(baseGame);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toMatchObject({
      moveIndex: 0,
      player1RemainingMs: STARTING_CLOCK_MS - 1000,
      player2RemainingMs: STARTING_CLOCK_MS,
    });
    expect(ticks[1]).toMatchObject({
      player1RemainingMs: STARTING_CLOCK_MS - 1000,
      player2RemainingMs: STARTING_CLOCK_MS - 2000,
    });
    expect(ticks[2]).toMatchObject({
      player1RemainingMs: STARTING_CLOCK_MS - 1500,
      player2RemainingMs: STARTING_CLOCK_MS - 2000,
    });
  });

  it('carries remaining time forward across moves cumulatively', () => {
    const ticks = buildClockTimeline(baseGame);
    expect(ticks[2]!.player1RemainingMs).toBe(STARTING_CLOCK_MS - 1000 - 500);
  });

  it('bills a restart event to the crashing player at its at_move index', () => {
    const game: GameRecord = {
      ...baseGame,
      clock_events: [{ type: 'restart', player: 2, billed_ms: 3000, at_move: 1 }],
    };
    const ticks = buildClockTimeline(game);
    expect(ticks[1]!.player2RemainingMs).toBe(STARTING_CLOCK_MS - 2000 - 3000);
    expect(ticks[1]!.restart).toEqual({ player: 2, billedMs: 3000 });
    expect(ticks[0]!.restart).toBeNull();
    expect(ticks[2]!.restart).toBeNull();
  });

  it('clamps a clock at zero rather than going negative', () => {
    const game: GameRecord = {
      ...baseGame,
      moves: [{ player: 1, column: 0, think_ms: STARTING_CLOCK_MS + 5000 }],
      outcome: { type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'clock_expired' },
    };
    const ticks = buildClockTimeline(game);
    expect(ticks[0]!.player1RemainingMs).toBe(0);
  });

  it('returns an empty timeline for a game with no moves', () => {
    expect(buildClockTimeline({ ...baseGame, moves: [] })).toEqual([]);
  });
});

describe('clockUrgency', () => {
  it('is normal above CLOCK_WARN_MS', () => {
    expect(clockUrgency(CLOCK_WARN_MS + 1)).toBe('normal');
  });

  it('is warn between CLOCK_CRITICAL_MS and CLOCK_WARN_MS', () => {
    expect(clockUrgency(CLOCK_WARN_MS - 1)).toBe('warn');
    expect(clockUrgency(CLOCK_CRITICAL_MS)).toBe('warn');
  });

  it('is critical below CLOCK_CRITICAL_MS', () => {
    expect(clockUrgency(CLOCK_CRITICAL_MS - 1)).toBe('critical');
    expect(clockUrgency(0)).toBe('critical');
  });
});

describe('formatClock', () => {
  it('formats milliseconds as seconds with one decimal', () => {
    expect(formatClock(9400)).toBe('9.4s');
    expect(formatClock(0)).toBe('0.0s');
  });

  it('never shows a negative value', () => {
    expect(formatClock(-500)).toBe('0.0s');
  });
});

describe('formatRestartBadge', () => {
  it('formats a billed restart as a flash badge label', () => {
    expect(formatRestartBadge(2300)).toBe('-2.3s RESTART');
  });
});

describe('formatClockMs', () => {
  it('formats milliseconds as zero-padded seconds.milliseconds', () => {
    expect(formatClockMs(8472)).toBe('08.472');
  });

  it('zero-pads single-digit seconds and sub-100 milliseconds', () => {
    expect(formatClockMs(1005)).toBe('01.005');
    expect(formatClockMs(40)).toBe('00.040');
  });

  it('clamps at 0 -> "00.000" for zero or negative input', () => {
    expect(formatClockMs(0)).toBe('00.000');
    expect(formatClockMs(-500)).toBe('00.000');
  });

  it('handles values at or above a minute by just growing the seconds field', () => {
    expect(formatClockMs(61_234)).toBe('61.234');
  });
});

describe('interpolateRemaining', () => {
  it('returns prevMs at t=0 and nextMs at t=1', () => {
    expect(interpolateRemaining(9400, 8472, 0)).toBe(9400);
    expect(interpolateRemaining(9400, 8472, 1)).toBe(8472);
  });

  it('linearly interpolates between prevMs and nextMs', () => {
    expect(interpolateRemaining(10_000, 8_000, 0.5)).toBe(9_000);
  });

  it('clamps t below 0 to 0 and above 1 to 1', () => {
    expect(interpolateRemaining(10_000, 8_000, -1)).toBe(10_000);
    expect(interpolateRemaining(10_000, 8_000, 2)).toBe(8_000);
  });

  it('never returns a value below nextMs even if t overshoots numerically', () => {
    expect(interpolateRemaining(10_000, 8_000, 1.5)).toBe(8_000);
  });
});

describe('seatForTeamSlot', () => {
  // The match engine (match-runner.ts) always has seat 1 move first and
  // rotates the TEAM occupying seat 1 between games; the contract also
  // permits records where seat 2 moved first. All four combos:
  it.each([
    // [first_player, first_player_team, expected seat of team 0, of team 1]
    [1, 0, 1, 2],
    [1, 1, 2, 1],
    [2, 0, 2, 1],
    [2, 1, 1, 2],
  ] as const)(
    'first_player=%i first_player_team=%i -> team0 seat %i, team1 seat %i',
    (firstPlayer, firstPlayerTeam, seat0, seat1) => {
      const game = { first_player: firstPlayer, first_player_team: firstPlayerTeam } as const;
      expect(seatForTeamSlot(game, 0)).toBe(seat0);
      expect(seatForTeamSlot(game, 1)).toBe(seat1);
    },
  );

  it('the first mover is always the seat belonging to first_player_team', () => {
    const game = { first_player: 2, first_player_team: 1 } as const;
    expect(seatForTeamSlot(game, game.first_player_team)).toBe(game.first_player);
  });
});
