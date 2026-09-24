// Isolated in its own file because it mocks @connect-4/engine down to a
// trivial 1x1 board so a draw is reachable in a single move, without having
// to hand-construct a full 8x8 fill sequence with no four-in-a-row anywhere
// (a real such sequence exists, but isn't worth the complexity here — the
// engine package already exhaustively tests isDraw/checkWin on real boards;
// this test is only about game-runner wiring the draw outcome through).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@connect-4/engine', () => {
  type Cell = 0 | 1 | 2;
  type Board = Cell[][];
  return {
    emptyBoard: (): Board => [[0]],
    isLegalMove: (board: Board, col: number): boolean => col === 0 && board[0][0] === 0,
    legalMoves: (board: Board): number[] => (board[0][0] === 0 ? [0] : []),
    applyMove: (board: Board, col: number, player: Cell): Board => {
      if (col !== 0 || board[0][0] !== 0) throw new Error('illegal move in fake engine');
      return [[player]];
    },
    checkWin: (): null => null,
    isDraw: (board: Board): boolean => board[0][0] !== 0,
  };
});

const { playGame } = await import('./game-runner.js');
const { FakeBotTransport } = await import('./testing/fake-bot-transport.js');

describe('playGame — draw', () => {
  it('scores a full board with no winner as a draw', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });

    const record = await playGame(
      { 1: t1, 2: t2 },
      { matchId: 'm', gameNumber: 1, firstPlayer: 1, firstPlayerTeam: 0, coinFlip: true, thinkBudgetMs: 10_000 },
    );

    expect(record.outcome).toEqual({ type: 'draw' });
    expect(record.moves).toHaveLength(1);
  });
});
