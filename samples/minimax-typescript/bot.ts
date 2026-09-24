/**
 * Sample bot: minimax (depth 4) with a heuristic. Thin wrapper: the real
 * search lives in search.ts.
 */
import type { Board, MoveInfo, Player } from './types.ts';
import { minimaxMove } from './search.ts';

export function chooseMove(board: Board, you: Player, info: MoveInfo): number {
  void info;
  return minimaxMove(board, you);
}
