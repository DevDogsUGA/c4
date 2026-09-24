// Plays a single game to completion, enforcing the chess clock and all
// failure rules from DESIGN.md's "Time control & failure rules" table:
//
//   | Clock hits zero                    | Forfeit the game (clock_expired)      |
//   | Invalid move                       | Forfeit the game (invalid_move)       |
//   | Container crash                    | Restart, bill the restart, resend the |
//   |                                     | move; crash-looping drains the clock  |
//   |                                     | to forfeit (crash_loop)               |
//
// This module has zero Docker/network dependency: it only calls the
// BotTransport interface, so it's fully exercised in tests with a fake.

import { applyMove, checkWin, emptyBoard, isDraw, isLegalMove, type Board, type Player } from '@connect-4/engine';
import type { ClockEvent, ForfeitReason, GameRecord, MoveRecord, MoveRequest, TeamSlot } from '@connect-4/contract';
import { ChessClock } from './clock.js';
import type { BotTransport, MoveOutcome } from './types.js';

/** Prevents a pathological crash-loop (crashes that keep costing ~0ms) from spinning forever without draining the clock. */
const MAX_CONSECUTIVE_RESTARTS_PER_MOVE = 20;

export interface PlayerTransports {
  1: BotTransport;
  2: BotTransport;
}

export interface GameConfig {
  matchId: string;
  /** 1-based within the match. */
  gameNumber: number;
  /** Which in-game player number (1 or 2) moves first this game. */
  firstPlayer: Player;
  /** Which team slot (0/1 in the match) that first-mover is. */
  firstPlayerTeam: TeamSlot;
  /** True if `firstPlayer` was an arena coin flip (game 1, sudden death); false if it deterministically alternated. */
  coinFlip: boolean;
  /** Per-player think budget in ms for this game (10_000 in production). */
  thinkBudgetMs: number;
}

function other(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function otherSlot(slot: TeamSlot): TeamSlot {
  return slot === 0 ? 1 : 0;
}

/** Cancelable delay, used to race a move against the remaining clock without leaking timers or keeping the process alive. */
function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    // Node-only API; this package targets Node, not the browser.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

type RaceResult = { kind: 'settled'; outcome: MoveOutcome } | { kind: 'timeout' };

async function raceMoveAgainstClock(movePromise: Promise<MoveOutcome>, budgetMs: number): Promise<RaceResult> {
  const timer = delay(Math.max(0, budgetMs));
  try {
    return await Promise.race([
      movePromise.then((outcome): RaceResult => ({ kind: 'settled', outcome })),
      timer.promise.then((): RaceResult => ({ kind: 'timeout' })),
    ]);
  } finally {
    timer.cancel();
  }
}

function buildMoveRequest(
  config: GameConfig,
  mover: Player,
  board: Board,
  moveHistory: number[],
  clock: ChessClock,
): MoveRequest {
  return {
    you: mover,
    board,
    moves: moveHistory,
    game: {
      match_id: config.matchId,
      game_number: config.gameNumber,
      clock_remaining_ms: clock.remaining(mover),
    },
  };
}

type ResolveResult =
  | { type: 'applied'; board: Board; column: number }
  | { type: 'forfeit'; player: Player; reason: ForfeitReason };

interface ResolveContext {
  transports: PlayerTransports;
  clock: ChessClock;
  mover: Player;
  board: Board;
  moveHistory: number[];
  moves: MoveRecord[];
  clockEvents: ClockEvent[];
  config: GameConfig;
}

/**
 * Resolves the current mover's turn: sends (and, on crash, resends) the
 * /move request against the clock, applying restarts and forfeits per
 * DESIGN.md. Returns either the applied move (new board) or a forfeit.
 */
async function resolveTurn(ctx: ResolveContext): Promise<ResolveResult> {
  const { transports, clock, mover, board, moveHistory, moves, clockEvents, config } = ctx;
  let restartsThisMove = 0;

  for (;;) {
    if (clock.expired(mover)) {
      return { type: 'forfeit', player: mover, reason: 'clock_expired' };
    }

    const budgetMs = clock.remaining(mover);
    const request = buildMoveRequest(config, mover, board, moveHistory, clock);
    const transport = transports[mover];
    const start = Date.now();
    const raced = await raceMoveAgainstClock(transport.move(request), budgetMs);
    const elapsedMs = Date.now() - start;

    if (raced.kind === 'timeout') {
      clock.bill(mover, budgetMs);
      return { type: 'forfeit', player: mover, reason: 'clock_expired' };
    }

    clock.bill(mover, elapsedMs);
    const outcome = raced.outcome;

    if (outcome.type === 'ok') {
      if (!isLegalMove(board, outcome.column)) {
        return { type: 'forfeit', player: mover, reason: 'invalid_move' };
      }
      moves.push({ player: mover, column: outcome.column, think_ms: elapsedMs });
      return { type: 'applied', board: applyMove(board, outcome.column, mover), column: outcome.column };
    }

    if (outcome.type === 'invalid') {
      return { type: 'forfeit', player: mover, reason: 'invalid_move' };
    }

    // outcome.type === 'crashed'
    if (clock.expired(mover)) {
      return { type: 'forfeit', player: mover, reason: 'clock_expired' };
    }
    restartsThisMove++;
    if (restartsThisMove > MAX_CONSECUTIVE_RESTARTS_PER_MOVE) {
      return { type: 'forfeit', player: mover, reason: 'crash_loop' };
    }
    const billedMs = await transport.restart();
    clock.bill(mover, billedMs);
    clockEvents.push({ type: 'restart', player: mover, billed_ms: billedMs, at_move: moves.length });
    if (clock.expired(mover)) {
      return { type: 'forfeit', player: mover, reason: 'crash_loop' };
    }
    // loop: resend the move request
  }
}

export async function playGame(transports: PlayerTransports, config: GameConfig): Promise<GameRecord> {
  const clock = new ChessClock(config.thinkBudgetMs);
  let board = emptyBoard();
  const moves: MoveRecord[] = [];
  const clockEvents: ClockEvent[] = [];
  const moveHistory: number[] = [];
  let mover: Player = config.firstPlayer;

  const base = {
    game_number: config.gameNumber,
    first_player: config.firstPlayer,
    first_player_team: config.firstPlayerTeam,
    coin_flip: config.coinFlip,
  } as const;

  for (;;) {
    const result = await resolveTurn({ transports, clock, mover, board, moveHistory, moves, clockEvents, config });

    if (result.type === 'forfeit') {
      return {
        ...base,
        moves,
        clock_events: clockEvents,
        outcome: {
          type: 'forfeit',
          winner: other(result.player),
          forfeited_player: result.player,
          reason: result.reason,
        },
      };
    }

    board = result.board;
    moveHistory.push(result.column);

    const win = checkWin(board);
    if (win) {
      return { ...base, moves, clock_events: clockEvents, outcome: { type: 'four_in_a_row', winner: win.player } };
    }
    if (isDraw(board)) {
      return { ...base, moves, clock_events: clockEvents, outcome: { type: 'draw' } };
    }
    mover = other(mover);
  }
}

/** Maps a finished game's outcome back to which team slot won, or null for a draw. */
export function gameWinningTeamSlot(record: GameRecord): TeamSlot | null {
  if (record.outcome.type === 'draw') return null;
  const winningPlayer = record.outcome.winner;
  return winningPlayer === record.first_player ? record.first_player_team : otherSlot(record.first_player_team);
}
