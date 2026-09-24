// Tier-3 resource-abuse sample: allocates ever-larger buffers on every move
// until the container is OOM-killed. Only meaningful under the hardened
// engine's memory cap; do not run this outside it.
const hoard = [];

function chooseMove(board, you, info) {
  hoard.push(Buffer.alloc(256 * 1024 * 1024, 1)); // +256MB per move
  return legalMoves(board)[0];
}

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((col) => col !== -1);
}

module.exports = { chooseMove };
