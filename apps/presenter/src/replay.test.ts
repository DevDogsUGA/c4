import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@acm-uga/c4-contract';
import { buildReplay, winningLine } from './replay.js';

const winningGame: GameRecord = {
  game_number: 1,
  first_player: 1,
  first_player_team: 0,
  coin_flip: true,
  moves: [
    { player: 1, column: 0, think_ms: 120 },
    { player: 2, column: 1, think_ms: 340 },
    { player: 1, column: 0, think_ms: 110 },
    { player: 2, column: 1, think_ms: 260 },
    { player: 1, column: 0, think_ms: 90 },
    { player: 2, column: 1, think_ms: 300 },
    { player: 1, column: 0, think_ms: 150 },
  ],
  clock_events: [],
  outcome: { type: 'four_in_a_row', winner: 1 },
};

const forfeitGame: GameRecord = {
  game_number: 2,
  first_player: 2,
  first_player_team: 1,
  coin_flip: false,
  moves: [{ player: 2, column: 3, think_ms: 200 }],
  clock_events: [{ type: 'forfeit', player: 2, reason: 'invalid_move', at_move: 1 }],
  outcome: { type: 'forfeit', winner: 1, forfeited_player: 2, reason: 'invalid_move' },
};

describe('buildReplay', () => {
  it('produces one step per move, in order', () => {
    const steps = buildReplay(winningGame);
    expect(steps).toHaveLength(winningGame.moves.length);
    steps.forEach((step, i) => expect(step.moveIndex).toBe(i));
  });

  it('stacks pieces bottom-up within a column', () => {
    const steps = buildReplay(winningGame);
    const col0Rows = steps.filter((s) => s.move.column === 0).map((s) => s.row);
    expect(col0Rows).toEqual([0, 1, 2, 3]);
  });

  it('each step\'s board reflects every move applied so far', () => {
    const steps = buildReplay(winningGame);
    const last = steps[steps.length - 1]!;
    expect(last.board[0]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(last.board[1]).toEqual([2, 2, 2, 0, 0, 0, 0, 0]);
  });

  it('handles a single-move game', () => {
    const steps = buildReplay(forfeitGame);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.row).toBe(0);
  });

  it('handles a game with no moves', () => {
    const empty: GameRecord = { ...forfeitGame, moves: [] };
    expect(buildReplay(empty)).toEqual([]);
  });
});

describe('winningLine', () => {
  it('finds the four-in-a-row line for a decisive game', () => {
    const steps = buildReplay(winningGame);
    const line = winningLine(winningGame, steps);
    expect(line).not.toBeNull();
    expect(line).toHaveLength(4);
    expect(line?.every((c) => c.col === 0)).toBe(true);
  });

  it('returns null for a forfeited game', () => {
    const steps = buildReplay(forfeitGame);
    expect(winningLine(forfeitGame, steps)).toBeNull();
  });
});
