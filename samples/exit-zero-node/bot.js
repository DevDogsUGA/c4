// Stress sample: calls process.exit(0) partway through the match (not the
// first move, so the match actually starts) -- a "clean" exit is still an
// unexpected process death mid-match from the arena's point of view.
function chooseMove(board, you, info) {
  if (info && info.moves && info.moves.length === 3) {
    process.exit(0);
  }
  const moves = legalMoves(board);
  return moves[Math.floor(Math.random() * moves.length)];
}

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((col) => col !== -1);
}

module.exports = { chooseMove };
