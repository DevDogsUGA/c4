// Greedy strategy, kept out of bot.js so bot.js stays a thin wrapper (see
// samples/README-for-agents in packages/samples: bot.js will need to pass a
// trailing `info` argument through once the template lands it).
'use strict';

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((c) => c !== -1);
}

function drop(board, col, piece) {
  const next = board.map((c) => c.slice());
  const row = next[col].findIndex((cell) => cell === 0);
  next[col][row] = piece;
  return next;
}

function wins(board, piece) {
  const w = board.length;
  const h = board[0].length;
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let col = 0; col < w; col++) {
    for (let row = 0; row < h; row++) {
      if (board[col][row] !== piece) continue;
      for (const [dc, dr] of dirs) {
        let count = 1;
        let c = col + dc;
        let r = row + dr;
        while (c >= 0 && c < w && r >= 0 && r < h && board[c][r] === piece) {
          count++;
          c += dc;
          r += dr;
        }
        if (count >= 4) return true;
      }
    }
  }
  return false;
}

function greedyMove(board, you) {
  const opponent = you === 1 ? 2 : 1;
  const moves = legalMoves(board);
  const center = (board.length - 1) / 2;

  for (const col of moves) {
    if (wins(drop(board, col, you), you)) return col;
  }
  for (const col of moves) {
    if (wins(drop(board, col, opponent), opponent)) return col;
  }
  return moves.reduce((best, col) => (Math.abs(col - center) < Math.abs(best - center) ? col : best), moves[0]);
}

module.exports = { greedyMove, legalMoves, drop, wins };
