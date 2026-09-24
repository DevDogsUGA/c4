// Minimax (depth 4) with a simple positional heuristic. Kept out of bot.ts
// so bot.ts stays a thin wrapper.
import type { Board, Cell } from './types.ts';

const DEPTH = 4;
const WIDTH = 8;
const HEIGHT = 8;
const DIRS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function legalMoves(board: Board): number[] {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((c) => c !== -1);
}

function drop(board: Board, col: number, piece: Cell): Board {
  const next = board.map((c) => c.slice()) as Board;
  const row = next[col].findIndex((cell) => cell === 0);
  next[col][row] = piece;
  return next;
}

function countDir(board: Board, col: number, row: number, dc: number, dr: number, piece: Cell): number {
  let count = 0;
  let c = col;
  let r = row;
  while (c >= 0 && c < WIDTH && r >= 0 && r < HEIGHT && board[c][r] === piece) {
    count++;
    c += dc;
    r += dr;
  }
  return count;
}

function wins(board: Board, piece: Cell): boolean {
  for (let col = 0; col < WIDTH; col++) {
    for (let row = 0; row < HEIGHT; row++) {
      if (board[col][row] !== piece) continue;
      for (const [dc, dr] of DIRS) {
        if (countDir(board, col, row, dc, dr, piece) >= 4) return true;
      }
    }
  }
  return false;
}

function isFull(board: Board): boolean {
  return board.every((column) => column[column.length - 1] !== 0);
}

// Positional heuristic: reward center columns and near-runs of 2-3.
function heuristic(board: Board, me: Cell, opp: Cell): number {
  let score = 0;
  const center = (WIDTH - 1) / 2;
  for (let col = 0; col < WIDTH; col++) {
    for (let row = 0; row < HEIGHT; row++) {
      const cell = board[col][row];
      if (cell === 0) continue;
      const centerBonus = (4 - Math.abs(col - center)) * (cell === me ? 1 : -1);
      score += centerBonus;
      for (const [dc, dr] of DIRS) {
        const run = countDir(board, col, row, dc, dr, cell);
        if (run >= 2) score += (cell === me ? 1 : -1) * run * run;
      }
    }
  }
  return score;
}

function minimax(board: Board, depth: number, maximizing: boolean, me: Cell, opp: Cell, alpha: number, beta: number): number {
  if (wins(board, me)) return 1_000_000 - depth;
  if (wins(board, opp)) return -1_000_000 + depth;
  const moves = legalMoves(board);
  if (moves.length === 0 || depth === 0) return heuristic(board, me, opp);

  if (maximizing) {
    let best = -Infinity;
    for (const col of moves) {
      const value = minimax(drop(board, col, me), depth - 1, false, me, opp, alpha, beta);
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const col of moves) {
      const value = minimax(drop(board, col, opp), depth - 1, true, me, opp, alpha, beta);
      best = Math.min(best, value);
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return best;
  }
}

export function minimaxMove(board: Board, you: 1 | 2): number {
  const opp = you === 1 ? 2 : 1;
  const moves = legalMoves(board);
  let bestCol = moves[0];
  let bestScore = -Infinity;
  for (const col of moves) {
    const score = minimax(drop(board, col, you as Cell), DEPTH - 1, false, you as Cell, opp as Cell, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}

export function _internalIsFull(board: Board): boolean {
  return isFull(board);
}
