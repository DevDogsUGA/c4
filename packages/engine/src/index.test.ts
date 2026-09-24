import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  IllegalMoveError,
  applyMove,
  checkWin,
  emptyBoard,
  isDraw,
  isLegalMove,
  legalMoves,
  type Board,
  type Player,
} from './index.js';

/** Build a board from bottom-up row strings for readability in tests.
 * Each string represents one row, top row first (as commonly drawn),
 * characters: '.' empty, '1' player 1, '2' player 2.
 * Example (4 rows x 4 cols):
 *   fromRows([
 *     '....',
 *     '....',
 *     '....',
 *     '1111',
 *   ])
 * produces a board where column 0..3 each have a '1' in row 0 (bottom).
 */
function fromRows(rows: string[], width = BOARD_WIDTH, height = BOARD_HEIGHT): Board {
  const board: Board = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => 0 as const),
  );
  // rows[0] is the TOP row on screen; convert to row index from bottom.
  const rowCount = rows.length;
  for (let displayRow = 0; displayRow < rowCount; displayRow++) {
    const rowIndex = rowCount - 1 - displayRow;
    const line = rows[displayRow];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '1') board[col][rowIndex] = 1;
      else if (ch === '2') board[col][rowIndex] = 2;
    }
  }
  return board;
}

describe('emptyBoard', () => {
  it('creates an 8x8 board of all zeros', () => {
    const board = emptyBoard();
    expect(board.length).toBe(BOARD_WIDTH);
    for (const col of board) {
      expect(col.length).toBe(BOARD_HEIGHT);
      expect(col.every((cell) => cell === 0)).toBe(true);
    }
  });

  it('produces independent columns (mutating one does not affect another)', () => {
    const board = emptyBoard();
    board[0][0] = 1;
    expect(board[1][0]).toBe(0);
  });
});

describe('legalMoves / isLegalMove', () => {
  it('all columns are legal on an empty board', () => {
    const board = emptyBoard();
    expect(legalMoves(board)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let c = 0; c < BOARD_WIDTH; c++) {
      expect(isLegalMove(board, c)).toBe(true);
    }
  });

  it('excludes full columns', () => {
    let board = emptyBoard();
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      board = applyMove(board, 0, ((r % 2) + 1) as Player);
    }
    expect(legalMoves(board)).not.toContain(0);
    expect(isLegalMove(board, 0)).toBe(false);
    expect(legalMoves(board)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects out-of-range columns', () => {
    const board = emptyBoard();
    expect(isLegalMove(board, -1)).toBe(false);
    expect(isLegalMove(board, 8)).toBe(false);
    expect(isLegalMove(board, 100)).toBe(false);
  });

  it('rejects non-integer columns', () => {
    const board = emptyBoard();
    expect(isLegalMove(board, 1.5)).toBe(false);
    expect(isLegalMove(board, NaN)).toBe(false);
  });
});

describe('applyMove', () => {
  it('drops a piece into the lowest empty row of a column', () => {
    const board = emptyBoard();
    const next = applyMove(board, 3, 1);
    expect(next[3][0]).toBe(1);
    expect(next[3][1]).toBe(0);
  });

  it('stacks pieces upward within a column', () => {
    let board = emptyBoard();
    board = applyMove(board, 2, 1);
    board = applyMove(board, 2, 2);
    board = applyMove(board, 2, 1);
    expect(board[2][0]).toBe(1);
    expect(board[2][1]).toBe(2);
    expect(board[2][2]).toBe(1);
    expect(board[2][3]).toBe(0);
  });

  it('does not mutate the input board', () => {
    const board = emptyBoard();
    const next = applyMove(board, 0, 1);
    expect(board[0][0]).toBe(0);
    expect(next[0][0]).toBe(1);
    expect(next).not.toBe(board);
    expect(next[1]).not.toBe(board[1]); // columns are copied too
  });

  it('throws IllegalMoveError for a full column', () => {
    let board = emptyBoard();
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      board = applyMove(board, 0, ((r % 2) + 1) as Player);
    }
    expect(() => applyMove(board, 0, 1)).toThrow(IllegalMoveError);
  });

  it('throws IllegalMoveError for an out-of-range column', () => {
    const board = emptyBoard();
    expect(() => applyMove(board, -1, 1)).toThrow(IllegalMoveError);
    expect(() => applyMove(board, 8, 1)).toThrow(IllegalMoveError);
  });
});

describe('checkWin', () => {
  it('returns null on an empty board', () => {
    expect(checkWin(emptyBoard())).toBeNull();
  });

  it('returns null when there is no four-in-a-row', () => {
    const board = fromRows(['........', '........', '........', '........', '........', '........', '........', '1121....']);
    expect(checkWin(board)).toBeNull();
  });

  it('detects a horizontal win along the bottom row', () => {
    const board = fromRows(['........', '........', '........', '........', '........', '........', '........', '.1111...']);
    const result = checkWin(board);
    expect(result).not.toBeNull();
    expect(result?.player).toBe(1);
    expect(result?.line).toHaveLength(4);
    expect(result?.line.every((c) => c.row === 0)).toBe(true);
    expect(result?.line.map((c) => c.col).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('detects a horizontal win at the right edge', () => {
    const board = fromRows(['........', '........', '........', '........', '........', '........', '........', '....2222']);
    const result = checkWin(board);
    expect(result?.player).toBe(2);
    expect(result?.line.map((c) => c.col).sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  it('detects a vertical win', () => {
    let board = emptyBoard();
    board = applyMove(board, 5, 1);
    board = applyMove(board, 5, 1);
    board = applyMove(board, 5, 1);
    board = applyMove(board, 5, 1);
    const result = checkWin(board);
    expect(result?.player).toBe(1);
    expect(result?.line.every((c) => c.col === 5)).toBe(true);
    expect(result?.line.map((c) => c.row).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('detects a vertical win at the top edge', () => {
    let board = emptyBoard();
    // Alternate the bottom four so there is no lower-down vertical win,
    // then stack four of the same player on top.
    board = applyMove(board, 0, 2); // row 0
    board = applyMove(board, 0, 1); // row 1
    board = applyMove(board, 0, 1); // row 2
    board = applyMove(board, 0, 2); // row 3
    board = applyMove(board, 0, 1); // row 4
    board = applyMove(board, 0, 1); // row 5
    board = applyMove(board, 0, 1); // row 6
    board = applyMove(board, 0, 1); // row 7
    const result = checkWin(board);
    expect(result?.player).toBe(1);
    expect(result?.line.map((c) => c.row).sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  it('detects a rising diagonal win (/)', () => {
    // Build a staircase: col0 row0, col1 row1, col2 row2, col3 row3 all player 1.
    // Need filler pieces beneath each so the piece lands at the right row.
    let board = emptyBoard();
    // col0: place 1 at row0 directly.
    board = applyMove(board, 0, 1);
    // col1: needs one filler below, then player 1.
    board = applyMove(board, 1, 2);
    board = applyMove(board, 1, 1);
    // col2: needs two fillers below.
    board = applyMove(board, 2, 2);
    board = applyMove(board, 2, 2);
    board = applyMove(board, 2, 1);
    // col3: needs three fillers below.
    board = applyMove(board, 3, 2);
    board = applyMove(board, 3, 2);
    board = applyMove(board, 3, 2);
    board = applyMove(board, 3, 1);

    expect(board[0][0]).toBe(1);
    expect(board[1][1]).toBe(1);
    expect(board[2][2]).toBe(1);
    expect(board[3][3]).toBe(1);

    const result = checkWin(board);
    expect(result?.player).toBe(1);
    const cells = result?.line.map((c) => `${c.col},${c.row}`).sort();
    expect(cells).toEqual(['0,0', '1,1', '2,2', '3,3']);
  });

  it('detects a falling diagonal win (\\)', () => {
    // col0 row3, col1 row2, col2 row1, col3 row0, all player 2.
    let board = emptyBoard();
    board = applyMove(board, 0, 1);
    board = applyMove(board, 0, 1);
    board = applyMove(board, 0, 1);
    board = applyMove(board, 0, 2); // col0 row3 = 2
    board = applyMove(board, 1, 1);
    board = applyMove(board, 1, 1);
    board = applyMove(board, 1, 2); // col1 row2 = 2
    board = applyMove(board, 2, 1);
    board = applyMove(board, 2, 2); // col2 row1 = 2
    board = applyMove(board, 3, 2); // col3 row0 = 2

    expect(board[0][3]).toBe(2);
    expect(board[1][2]).toBe(2);
    expect(board[2][1]).toBe(2);
    expect(board[3][0]).toBe(2);

    const result = checkWin(board);
    expect(result?.player).toBe(2);
    const cells = result?.line.map((c) => `${c.col},${c.row}`).sort();
    expect(cells).toEqual(['0,3', '1,2', '2,1', '3,0']);
  });

  it('detects a win spanning the far corner (top-right diagonal)', () => {
    // Place a rising diagonal ending exactly at col7,row7.
    const board = emptyBoard();
    board[4][3] = 1;
    board[5][4] = 1;
    board[6][5] = 1;
    board[7][6] = 1;
    const result = checkWin(board);
    expect(result?.player).toBe(1);
    const cells = result?.line.map((c) => `${c.col},${c.row}`).sort();
    expect(cells).toEqual(['4,3', '5,4', '6,5', '7,6']);
  });

  it('does not report a win for three-in-a-row', () => {
    const board = fromRows(['........', '........', '........', '........', '........', '........', '........', '.111....']);
    expect(checkWin(board)).toBeNull();
  });

  it('does not wrap a horizontal run across the row boundary incorrectly (no false positive)', () => {
    // Player 1 occupies col 6,7 bottom row, and col 0,1 bottom row of a
    // *different* logical row would be a bug if column/row math were off.
    // This just checks two separate pairs don't combine into a false win.
    let board = emptyBoard();
    board = applyMove(board, 6, 1);
    board = applyMove(board, 7, 1);
    board = applyMove(board, 0, 1);
    board = applyMove(board, 1, 1);
    expect(checkWin(board)).toBeNull();
  });

  it('ignores empty cells when scanning (does not treat 0 as a matching player)', () => {
    const board = emptyBoard();
    expect(checkWin(board)).toBeNull();
  });
});

describe('isDraw', () => {
  it('is false on an empty board', () => {
    expect(isDraw(emptyBoard())).toBe(false);
  });

  it('is false when legal moves remain', () => {
    let board = emptyBoard();
    board = applyMove(board, 0, 1);
    expect(isDraw(board)).toBe(false);
  });

  it('is true when the board is completely full with no winner', () => {
    // Construct a full 8x8 board with a pattern that has no 4-in-a-row.
    // pattern[row][col], row 0 = bottom. Generated by exhaustively checking
    // color(row, col) = ((row*2 + col) % 5 < 2) ? 1 : 2 against checkWin.
    const pattern = [
      [1, 1, 2, 2, 2, 1, 1, 2],
      [2, 2, 2, 1, 1, 2, 2, 2],
      [2, 1, 1, 2, 2, 2, 1, 1],
      [1, 2, 2, 2, 1, 1, 2, 2],
      [2, 2, 1, 1, 2, 2, 2, 1],
      [1, 1, 2, 2, 2, 1, 1, 2],
      [2, 2, 2, 1, 1, 2, 2, 2],
      [2, 1, 1, 2, 2, 2, 1, 1],
    ];
    let board = emptyBoard();
    for (let row = 0; row < BOARD_HEIGHT; row++) {
      for (let col = 0; col < BOARD_WIDTH; col++) {
        board[col][row] = pattern[row][col] as Player;
      }
    }
    expect(legalMoves(board)).toEqual([]);
    // Sanity: this exact pattern must not contain a win, or the test is invalid.
    const win = checkWin(board);
    expect(win).toBeNull();
    expect(isDraw(board)).toBe(true);
  });

  it('is false (not a draw) when the board is full AND has a winning line', () => {
    // Fill the board fully, but engineer a horizontal win on the bottom row.
    const pattern = [
      [1, 1, 1, 1, 2, 1, 1, 2], // bottom row: cols 0-3 are a win for player 1
      [2, 2, 2, 1, 1, 2, 2, 2],
      [2, 1, 1, 2, 2, 2, 1, 1],
      [1, 2, 2, 2, 1, 1, 2, 2],
      [2, 2, 1, 1, 2, 2, 2, 1],
      [1, 1, 2, 2, 2, 1, 1, 2],
      [2, 2, 2, 1, 1, 2, 2, 2],
      [2, 1, 1, 2, 2, 2, 1, 1],
    ];
    let board = emptyBoard();
    for (let row = 0; row < BOARD_HEIGHT; row++) {
      for (let col = 0; col < BOARD_WIDTH; col++) {
        board[col][row] = pattern[row][col] as Player;
      }
    }
    expect(legalMoves(board)).toEqual([]);
    expect(checkWin(board)?.player).toBe(1);
    expect(isDraw(board)).toBe(false);
  });
});
