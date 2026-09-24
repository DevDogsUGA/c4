/**
 * Sample bot: greedy (win now, else block, else center). Thin wrapper: the
 * real logic lives in strategy.js so adapting to the template's eventual
 * trailing `info` argument is a one-line change here.
 */
const { greedyMove } = require('./strategy.js');

// TODO(A3 info param): once chooseMove(board, you, info) lands, thread
// `info` through to greedyMove for clock-aware play. Today's template
// signature is (board, you).
function chooseMove(board, you) {
  return greedyMove(board, you);
}

module.exports = { chooseMove };
