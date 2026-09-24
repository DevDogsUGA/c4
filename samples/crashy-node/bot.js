/**
 * Stress sample: throws once several moves have been played, so the
 * template's server.js catches nothing (it doesn't wrap chooseMove) and the
 * request blows up -> a non-200 response -> game_forfeit(invalid_move).
 */
function chooseMove(board, you, info) {
  if (info && info.moves && info.moves.length >= 3) {
    throw new Error('sample crash: simulated bug past move 3');
  }
  const moves = legalMoves(board);
  return moves[Math.floor(Math.random() * moves.length)];
}

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((col) => col !== -1);
}

module.exports = { chooseMove };
