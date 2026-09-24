// Isolated in its own file (like game-runner.draw.test.ts) because it mocks
// @acm-uga/c4-engine down to a trivial single-cell board so each game
// resolves after exactly one move, and scripts a fixed sequence of
// win/win/draw/win outcomes to deterministically produce a 1-1 tie after
// the regular best-of-3 (games 1 and 2 split, game 3 draws) and verify
// match-runner continues into a sudden-death 4th game per DESIGN.md
// ("a tied best-of-3 goes to sudden-death games, first mover random").
import { describe, expect, it, vi } from 'vitest';

vi.mock('@acm-uga/c4-engine', () => {
  type Cell = 0 | 1 | 2;
  type Board = Cell[][];
  // Each game plays exactly one move (the single-cell board is immediately
  // full). This array says what that move resolves to, one entry per game
  // in order played.
  const outcomes: Array<'win' | 'draw'> = ['win', 'win', 'draw', 'win'];
  let gameIndex = 0;

  return {
    emptyBoard: (): Board => {
      // A fresh call marks the start of a new game.
      return [[0]];
    },
    isLegalMove: (board: Board, col: number): boolean => col === 0 && board[0][0] === 0,
    legalMoves: (board: Board): number[] => (board[0][0] === 0 ? [0] : []),
    applyMove: (board: Board, col: number, player: Cell): Board => {
      if (col !== 0 || board[0][0] !== 0) throw new Error('illegal move in fake engine');
      return [[player]];
    },
    checkWin: (board: Board): { player: Cell; line: [] } | null => {
      if (board[0][0] === 0) return null;
      const outcome = outcomes[gameIndex] ?? 'draw';
      gameIndex++;
      return outcome === 'win' ? { player: board[0][0], line: [] } : null;
    },
    isDraw: (board: Board): boolean => board[0][0] !== 0,
  };
});

const { playMatch } = await import('./match-runner.js');
const { createSeededRng } = await import('./rng.js');
const { FakeBotTransport } = await import('./testing/fake-bot-transport.js');

describe('playMatch — sudden death', () => {
  it('continues past the regular best-of-3 when tied, deciding via a sudden-death game', async () => {
    const teams: [{ name: string; repo_url: string }, { name: string; repo_url: string }] = [
      { name: 'Team A', repo_url: 'https://github.com/a/a' },
      { name: 'Team B', repo_url: 'https://github.com/b/b' },
    ];
    const transports = { 0: new FakeBotTransport(), 1: new FakeBotTransport() };

    const record = await playMatch(transports, {
      matchId: 'rr-sd',
      phase: 'roundrobin',
      teams,
      thinkBudgetMs: 10_000,
      rng: createSeededRng(3),
    });

    expect(record.games).toHaveLength(4);
    expect(record.games[2].outcome).toEqual({ type: 'draw' });
    expect(record.games[3].coin_flip).toBe(true); // sudden-death game gets a fresh coin flip
    expect(record.result.reason).toBe('played');
    expect(record.result.games_won[0] + record.result.games_won[1]).toBe(3); // 3 decisive games out of 4 played
    const winnerWins = record.result.winner_team === 0 ? record.result.games_won[0] : record.result.games_won[1];
    expect(winnerWins).toBe(2);
  });
});
