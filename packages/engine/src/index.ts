// Pure Connect Four game rules. Zero I/O.
//
// Board representation: board[col][row], an 8x8 grid.
//   - col 0 is the leftmost column, col 7 the rightmost.
//   - row 0 is the BOTTOM row, row 7 the top.
//   - cell values: 0 = empty, 1 = player 1, 2 = player 2.
//
// This mirrors the wire format in DESIGN.md's /move contract exactly, so
// engine board values can be sent/received without transformation.

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;
export const WIN_LENGTH = 4;

/** A cell is empty (0) or occupied by a player (1 or 2). */
export type Cell = 0 | 1 | 2;

/** A player identifier. */
export type Player = 1 | 2;

/** board[col][row], row 0 = bottom. An 8x8 grid of columns. */
export type Board = Cell[][];

/** Returns a fresh, empty 8x8 board. */
export function emptyBoard(): Board {
  return Array.from({ length: BOARD_WIDTH }, () =>
    Array.from({ length: BOARD_HEIGHT }, () => 0 as Cell),
  );
}

/** True if `col` is a valid column index for the board. */
function isColumnInRange(board: Board, col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < board.length;
}

/** The number of occupied cells in a column (i.e. the next free row index). */
function columnHeight(board: Board, col: number): number {
  const column = board[col];
  let height = 0;
  while (height < column.length && column[height] !== 0) {
    height++;
  }
  return height;
}

/**
 * Returns the list of column indices that can legally accept a move
 * (in range and not full), in ascending order.
 */
export function legalMoves(board: Board): number[] {
  const moves: number[] = [];
  for (let col = 0; col < board.length; col++) {
    if (columnHeight(board, col) < board[col].length) {
      moves.push(col);
    }
  }
  return moves;
}

/** True if the given column is a legal move on this board. */
export function isLegalMove(board: Board, col: number): boolean {
  return isColumnInRange(board, col) && columnHeight(board, col) < board[col].length;
}

export class IllegalMoveError extends Error {
  constructor(col: number) {
    super(`Illegal move: column ${col} is out of range or full`);
    this.name = 'IllegalMoveError';
  }
}

/**
 * Returns a NEW board with `player`'s piece dropped into `col`. Does not
 * mutate the input board. Throws IllegalMoveError if the column is out of
 * range or full.
 */
export function applyMove(board: Board, col: number, player: Player): Board {
  if (!isLegalMove(board, col)) {
    throw new IllegalMoveError(col);
  }
  const row = columnHeight(board, col);
  const next = board.map((column) => column.slice());
  next[col][row] = player;
  return next;
}

/** A single cell coordinate, used to describe a winning line. */
export interface Coord {
  col: number;
  row: number;
}

/** Result of a win check: the winning player and the four cells in a row. */
export interface WinResult {
  player: Player;
  line: Coord[];
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
];

/**
 * Checks the whole board for a four-in-a-row (horizontal, vertical, or
 * either diagonal). Returns the winner and winning line, or null if there
 * is no win.
 */
export function checkWin(board: Board): WinResult | null {
  const width = board.length;
  for (let col = 0; col < width; col++) {
    const height = board[col].length;
    for (let row = 0; row < height; row++) {
      const player = board[col][row];
      if (player === 0) continue;

      for (const [dc, dr] of DIRECTIONS) {
        const line: Coord[] = [{ col, row }];
        let ok = true;
        for (let step = 1; step < WIN_LENGTH; step++) {
          const c = col + dc * step;
          const r = row + dr * step;
          if (c < 0 || c >= width) {
            ok = false;
            break;
          }
          const colHeight = board[c].length;
          if (r < 0 || r >= colHeight) {
            ok = false;
            break;
          }
          if (board[c][r] !== player) {
            ok = false;
            break;
          }
          line.push({ col: c, row: r });
        }
        if (ok) {
          return { player: player as Player, line };
        }
      }
    }
  }
  return null;
}

/**
 * True if the board is completely full (every column at max height) AND
 * there is no winner. Per DESIGN.md, a draw is a full board with no win;
 * callers should generally check checkWin() first since a full board can
 * also contain a winning line completed on the very last move.
 */
export function isDraw(board: Board): boolean {
  if (legalMoves(board).length > 0) return false;
  return checkWin(board) === null;
}
