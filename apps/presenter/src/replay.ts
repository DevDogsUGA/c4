// Pure move-by-move replay stepping for a single game record. No DOM: turns
// a GameRecord's flat move list into a sequence of board snapshots that a
// renderer (board-ui's BoardRenderer) can step through and animate.

import { applyMove, checkWin, emptyBoard, type Board, type WinResult } from '@acm-uga/c4-engine';
import type { GameRecord, MoveRecord } from '@acm-uga/c4-contract';

export interface ReplayStep {
  /** 0-based index into the game's moves array. */
  moveIndex: number;
  move: MoveRecord;
  /** Board state AFTER this move is applied. */
  board: Board;
  /** The row (0 = bottom) the piece landed on, for drop-animation purposes. */
  row: number;
}

/**
 * Replays a game's moves from an empty board, returning one ReplayStep per
 * move. Throws if a move is illegal against the board state built up so
 * far -- a corrupt/hand-edited game record, since the match engine only
 * ever emits legal moves.
 */
export function buildReplay(game: GameRecord): ReplayStep[] {
  let board = emptyBoard();
  const steps: ReplayStep[] = [];

  game.moves.forEach((move, moveIndex) => {
    const before = board[move.column];
    const next = applyMove(board, move.column, move.player);
    const row = next[move.column].findIndex((cell, r) => cell !== before[r]);
    steps.push({ moveIndex, move, board: next, row });
    board = next;
  });

  return steps;
}

/**
 * The winning line for a game that ended in `four_in_a_row`, or null for
 * any other outcome (forfeit, draw). Computed from the final replayed
 * board rather than trusted blindly from the outcome field, so a
 * mismatched record surfaces as "no highlight" rather than a thrown error.
 */
export function winningLine(game: GameRecord, steps: ReplayStep[]): WinResult['line'] | null {
  if (game.outcome.type !== 'four_in_a_row') return null;
  const finalBoard = steps.length > 0 ? steps[steps.length - 1]!.board : emptyBoard();
  return checkWin(finalBoard)?.line ?? null;
}
