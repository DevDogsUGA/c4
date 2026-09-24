import { describe, expect, it } from 'vitest';
import { chooseMove, leafEval, legalMoves, COLS, ROWS, type Board } from './reference.ts';

/** Empty 8x8 board. */
function emptyBoard(): Board {
  return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => 0));
}

/** Build a board from a bottom-up ASCII grid of 8 rows x 8 cols, top row first.
 * '.' = empty, '1' = player 1, '2' = player 2. Columns must be gravity-consistent
 * (no floating pieces) or this throws. */
function boardFromRows(rows: string[]): Board {
  if (rows.length !== ROWS) throw new Error('need exactly 8 rows');
  const board = emptyBoard();
  // rows[0] is the TOP row (row index 7), rows[7] is the BOTTOM row (row index 0).
  for (let i = 0; i < ROWS; i++) {
    const r = ROWS - 1 - i;
    const line = rows[i];
    if (line.length !== COLS) throw new Error('need exactly 8 columns');
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      board[c][r] = ch === '1' ? 1 : ch === '2' ? 2 : 0;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let seenEmpty = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[c][r] === 0) seenEmpty = true;
      else if (seenEmpty) throw new Error(`floating piece in column ${c}`);
    }
  }
  return board;
}

describe('legalMoves', () => {
  it('lists all 8 columns on an empty board', () => {
    expect(legalMoves(emptyBoard())).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('skips full columns', () => {
    const board = boardFromRows([
      '1.......',
      '1.......',
      '1.......',
      '1.......',
      '1.......',
      '1.......',
      '1.......',
      '1.......',
    ]);
    expect(legalMoves(board)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('chooseMove: tactics', () => {
  it('takes an immediate horizontal win', () => {
    // player 1 has three in a row on the bottom row at columns 0,1,2; column 3 wins.
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '111.....',
    ]);
    expect(chooseMove(board, 1)).toBe(3);
  });

  it('blocks an immediate loss', () => {
    // player 2 (opponent) has three in a row at columns 4,5,6 on the bottom row;
    // player 1 (root) must block at column 3 or 7. Column 7 also completes their
    // line to 4, so the only real block that prevents opponent's *next* move win
    // is column 3 or 7 -- here we pin it down so exactly one blocks: use 1..4 with
    // open ends at 0 and 4 isn't blockable both ways, so use a wall so only col 4 blocks.
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '1222....',
    ]);
    // opponent (2) threatens columns 4 (completes 1,2,3,4) — column 4 is the only block.
    expect(chooseMove(board, 1)).toBe(4);
  });

  it('prefers the faster of two wins', () => {
    // Root player can win immediately at column 3 (completing row 0..2) OR could
    // also eventually win elsewhere later; the immediate win must be taken since
    // WIN - ply favors the smaller ply and nothing beats an immediate win.
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '22......',
      '11......',
      '111.....',
    ]);
    expect(chooseMove(board, 1)).toBe(3);
  });

  it('never returns a full column', () => {
    const board = boardFromRows([
      '1.......',
      '2.......',
      '1.......',
      '2.......',
      '1.......',
      '2.......',
      '1.......',
      '2.......',
    ]);
    const move = chooseMove(board, 1);
    expect(move).not.toBe(0);
    expect(legalMoves(board)).toContain(move);
  });

  it('picks the lowest-indexed column on a tied empty board', () => {
    // On the empty board the root player has no forcing tactics within 4 plies,
    // so the choice comes down to leaf evaluation. Center columns (3, 4) score
    // highest and symmetrically -- among ties, the lowest column index wins.
    const board = emptyBoard();
    const move = chooseMove(board, 1);
    // Must be one of the two center columns (highest static value), and since
    // 3 and 4 are symmetric under this evaluation, ties must resolve to 3.
    expect(move).toBe(3);
  });
});

describe('leafEval', () => {
  it('is zero for an empty board', () => {
    expect(leafEval(emptyBoard(), 1)).toBe(0);
  });

  it('scores three-in-a-row with two overlapping open windows', () => {
    // you=1 has three in a row at columns 0,1,2 on the bottom row. Two
    // horizontal windows touch it: [0,1,2,3] (k=3 -> +5) and [1,2,3,4]E
    // wait -- [1,2,3,4] has cells at cols 1,2,3,4 = 1,1,0,0 (k=2 -> +2).
    // No center pieces (cols 3,4 are all empty). Total: 5 + 2 = 7.
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '111.....',
    ]);
    expect(leafEval(board, 1)).toBe(7);
  });

  it('weights offense (+5/+2) and defense (-4/-1) asymmetrically by design', () => {
    // Per SPEC.md the coefficients for "you" windows (+5, +2) are NOT the
    // mirror of the opponent coefficients (-4, -1), so leafEval is not
    // antisymmetric under swapping which player is "you" -- this is
    // intentional (defense is weighted lighter than offense). Confirm both
    // magnitudes independently instead of asserting symmetry.
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '22......',
      '111.....',
    ]);
    // From player 1's perspective: row0 [1,1,1,0]=+5, [1,1,0,0]=+2;
    // row1 [2,2,0,0]=-1, [2,0,0,0]=0. Total 5+2-1 = 6.
    expect(leafEval(board, 1)).toBe(6);
    // From player 2's perspective: row0 [1,1,1,0]=-4, [1,1,0,0]=-1;
    // row1 [2,2,0,0]=+2, [2,0,0,0]=0. Total -4-1+2 = -3.
    expect(leafEval(board, 2)).toBe(-3);
  });
});

describe('symmetry sanity', () => {
  it('mirrors the chosen column under left-right board reflection', () => {
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '..2.....',
      '..1.....',
      '.211....',
    ]);
    const mirrored: Board = Array.from({ length: COLS }, (_, c) => board[COLS - 1 - c].slice());
    const move = chooseMove(board, 1);
    const mirroredMove = chooseMove(mirrored, 1);
    expect(mirroredMove).toBe(COLS - 1 - move);
  });

  it('is deterministic across repeated calls', () => {
    const board = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '...2....',
      '..212...',
      '.2121...',
      '.11221..',
    ]);
    const first = chooseMove(board, 1);
    for (let i = 0; i < 5; i++) {
      expect(chooseMove(board, 1)).toBe(first);
    }
  });
});
