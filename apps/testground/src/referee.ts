// Pure game-loop logic: referees a game between two move providers using
// @connect-4/engine's rules. No DOM, no fetch -- fully testable with fake
// providers. UI code (App.tsx) wraps @connect-4/board-ui around the events
// this yields; bot-player.ts wraps protocol.ts's callBot into a provider.

import { applyMove, checkWin, emptyBoard, isDraw, isLegalMove, type Board, type Coord, type Player } from '@connect-4/engine';

/** Why a move provider failed to produce a legal column. */
export type MoveFailureReason = 'invalid_move' | 'timeout' | 'unreachable' | 'error';

export type MoveOutcome =
  | { ok: true; column: number; think_ms: number }
  | { ok: false; reason: MoveFailureReason; message: string; think_ms: number };

/** Produces this player's next move given the current board and history. */
export type MoveProvider = (board: Board, you: Player, moves: readonly number[]) => Promise<MoveOutcome>;

export type GameEvent =
  | { type: 'move_attempt'; player: Player }
  | { type: 'move_applied'; player: Player; column: number; row: number; think_ms: number; board: Board }
  | { type: 'forfeit'; player: Player; reason: MoveFailureReason; message: string }
  | { type: 'win'; player: Player; line: Coord[] }
  | { type: 'draw' };

/**
 * Plays one game to completion, yielding an event per step. Stops (without
 * throwing) on a win, draw, or forfeit -- a provider returning `ok: false`,
 * or an `ok: true` column that isn't legal on the current board, both end
 * the game as a forfeit by that player, mirroring DESIGN.md's failure rules.
 */
export async function* playGame(
  providers: Record<Player, MoveProvider>,
  firstPlayer: Player = 1,
): AsyncGenerator<GameEvent, void, void> {
  let board = emptyBoard();
  const moves: number[] = [];
  let current = firstPlayer;

  for (;;) {
    yield { type: 'move_attempt', player: current };
    const outcome = await providers[current](board, current, moves);

    if (!outcome.ok) {
      yield { type: 'forfeit', player: current, reason: outcome.reason, message: outcome.message };
      return;
    }
    if (!isLegalMove(board, outcome.column)) {
      yield {
        type: 'forfeit',
        player: current,
        reason: 'invalid_move',
        message: `Column ${outcome.column} is not a legal move (full or out of range)`,
      };
      return;
    }

    const row = board[outcome.column]!.filter((cell) => cell !== 0).length;
    board = applyMove(board, outcome.column, current);
    moves.push(outcome.column);
    yield { type: 'move_applied', player: current, column: outcome.column, row, think_ms: outcome.think_ms, board };

    const win = checkWin(board);
    if (win) {
      yield { type: 'win', player: win.player, line: win.line };
      return;
    }
    if (isDraw(board)) {
      yield { type: 'draw' };
      return;
    }

    current = current === 1 ? 2 : 1;
  }
}
