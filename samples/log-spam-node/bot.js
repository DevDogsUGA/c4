// Tier-3 resource-abuse sample: floods stdout with junk on every move. Only
// safely containable once the hardened engine's log caps land; do not run
// this outside it.
function chooseMove(board, you, info) {
  for (let i = 0; i < 50000; i++) {
    console.log(`spam ${i}: ${'x'.repeat(200)}`);
  }
  return legalMoves(board)[0];
}

function legalMoves(board) {
  return board.map((column, col) => (column[column.length - 1] === 0 ? col : -1)).filter((col) => col !== -1);
}

module.exports = { chooseMove };
