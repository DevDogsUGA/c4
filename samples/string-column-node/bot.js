// Stress sample: replies with the column as a string ("3"), which fails the
// contract's ColumnSchema (an int) -> game_forfeit(invalid_move).
function chooseMove(board, you, info) {
  const moves = legalMoves(board);
  const col = moves[Math.floor(Math.random() * moves.length)];
  return String(col);
}

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((col) => col !== -1);
}

module.exports = { chooseMove };
