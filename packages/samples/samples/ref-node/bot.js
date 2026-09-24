/**
 * Reference conformance sample bot (Node). Thin wrapper: all the algorithm
 * lives in search.js (see packages/samples/src/conformance/SPEC.md).
 */

const { chooseMove: search } = require("./search.js");

function chooseMove(board, you, info) {
  return search(board, you);
}

module.exports = { chooseMove };
