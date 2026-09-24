/**
 * Reference conformance sample bot (TypeScript). Thin wrapper: all the
 * algorithm lives in search.ts (see packages/samples/src/conformance/SPEC.md).
 */

import type { Board, MoveInfo, Player } from "./types.ts";
import { chooseMove as search } from "./search.ts";

export function chooseMove(board: Board, you: Player, info: MoveInfo): number {
  return search(board, you);
}

export { legalMoves } from "./search.ts";
