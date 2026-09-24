// TypeScript reference implementation of the conformance algorithm.
// See SPEC.md for the normative description. Every sample bot in every
// template language must match this implementation's chosen column, move
// for move, over the corpus in corpus.json.
//
// Integers only, no floats, no randomness.

export type Board = number[][]; // board[col][row], col 0 = left, row 0 = bottom
export type Player = 1 | 2;

export const COLS = 8;
export const ROWS = 8;
export const WIN = 1_000_000;

/** Columns that aren't full yet, in increasing order. */
export function legalMoves(board: Board): number[] {
  const moves: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (board[c][ROWS - 1] === 0) moves.push(c);
  }
  return moves;
}

/** Returns a new board with `player`'s piece dropped into column `c`, and the row it landed on. */
function drop(board: Board, c: number, player: Player): { board: Board; row: number } {
  const next: Board = board.map((col) => col.slice());
  let row = -1;
  for (let r = 0; r < ROWS; r++) {
    if (next[c][r] === 0) {
      next[c][r] = player;
      row = r;
      break;
    }
  }
  return { board: next, row };
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
];

/** True if the piece just placed at (c, r) for `player` completes four-in-a-row. */
function isWinningMove(board: Board, c: number, r: number, player: Player): boolean {
  for (const [dc, dr] of DIRECTIONS) {
    let count = 1;
    // forward
    let cc = c + dc;
    let rr = r + dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] === player) {
      count++;
      cc += dc;
      rr += dr;
    }
    // backward
    cc = c - dc;
    rr = r - dr;
    while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && board[cc][rr] === player) {
      count++;
      cc -= dc;
      rr -= dr;
    }
    if (count >= 4) return true;
  }
  return false;
}

/** Leaf evaluation from the root player `you`'s perspective. */
export function leafEval(board: Board, you: Player): number {
  const opponent: Player = you === 1 ? 2 : 1;
  let score = 0;

  const windowScore = (cells: number[]): number => {
    let k = 0; // you
    let m = 0; // opponent
    for (const cell of cells) {
      if (cell === you) k++;
      else if (cell === opponent) m++;
    }
    if (m === 0) {
      if (k === 3) return 5;
      if (k === 2) return 2;
      return 0;
    }
    if (k === 0) {
      if (m === 3) return -4;
      if (m === 2) return -1;
      return 0;
    }
    return 0;
  };

  // Horizontal: for each row, each start column 0..4
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += windowScore([board[c][r], board[c + 1][r], board[c + 2][r], board[c + 3][r]]);
    }
  }
  // Vertical: for each column, each start row 0..4
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      score += windowScore([board[c][r], board[c][r + 1], board[c][r + 2], board[c][r + 3]]);
    }
  }
  // Diagonal up-right (/): start columns 0..4, start rows 0..4
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      score += windowScore([
        board[c][r],
        board[c + 1][r + 1],
        board[c + 2][r + 2],
        board[c + 3][r + 3],
      ]);
    }
  }
  // Diagonal down-right (\): start columns 0..4, start rows 3..7 (going down as column increases)
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = ROWS - 1; r >= 3; r--) {
      score += windowScore([
        board[c][r],
        board[c + 1][r - 1],
        board[c + 2][r - 2],
        board[c + 3][r - 3],
      ]);
    }
  }

  // Center columns bonus (columns 3 and 4).
  for (const c of [3, 4]) {
    for (let r = 0; r < ROWS; r++) {
      if (board[c][r] === you) score += 3;
      else if (board[c][r] === opponent) score -= 3;
    }
  }

  return score;
}

/**
 * Negamax without pruning, depth 4 plies. Returns a score from `player`'s
 * perspective. `you` is the root player (fixed across the whole search),
 * used to orient the leaf evaluation. `ply` is 1-based, 1 at the root.
 */
function negamax(board: Board, player: Player, you: Player, ply: number): number {
  const moves = legalMoves(board);
  if (moves.length === 0) return 0;

  let best = -Infinity;
  for (const c of moves) {
    const { board: child, row } = drop(board, c, player);
    let score: number;
    if (isWinningMove(child, c, row, player)) {
      score = WIN - ply;
    } else if (legalMoves(child).length === 0) {
      score = 0;
    } else if (ply === 4) {
      const raw = leafEval(child, you);
      score = player === you ? raw : -raw;
    } else {
      const opponent: Player = player === 1 ? 2 : 1;
      score = -negamax(child, opponent, you, ply + 1);
    }
    if (score > best) best = score;
  }
  return best;
}

/** Chooses the root move: highest score, ties broken by lowest column index. */
export function chooseMove(board: Board, you: Player): number {
  const moves = legalMoves(board);
  if (moves.length === 0) return 0;

  let bestCol = moves[0];
  let bestScore = -Infinity;
  for (const c of moves) {
    const { board: child, row } = drop(board, c, you);
    let score: number;
    if (isWinningMove(child, c, row, you)) {
      score = WIN - 1;
    } else if (legalMoves(child).length === 0) {
      score = 0;
    } else {
      const opponent: Player = you === 1 ? 2 : 1;
      score = -negamax(child, opponent, you, 2);
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}
