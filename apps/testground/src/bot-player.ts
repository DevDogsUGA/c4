// Adapts protocol.ts's callBot into a referee.ts MoveProvider, tracking a
// DESIGN.md-style 10s-per-game chess clock so a slow bot forfeits instead of
// hanging the UI forever, and reporting every request/response exchange for
// the debug panel.

import type { Board, Player } from '@connect-4/engine';
import { callBot, type BotCallResult, type BotFailureReason, type MoveRequestBody } from './protocol.js';
import type { MoveFailureReason, MoveOutcome, MoveProvider } from './referee.js';

export interface BotExchange {
  request: MoveRequestBody;
  result: BotCallResult;
}

export interface BotPlayerOptions {
  baseUrl: string;
  matchId?: string;
  /** Total think budget for the whole game, ms. Defaults to 10000 (DESIGN.md). */
  clockMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Called after every request/response exchange, success or failure. */
  onExchange?: (exchange: BotExchange) => void;
}

/** Creates a MoveProvider that calls a real bot's /move endpoint over HTTP. */
export function createBotPlayer(options: BotPlayerOptions): MoveProvider {
  const clockMs = options.clockMs ?? 10_000;
  const matchId = options.matchId ?? 'testground';
  let remaining = clockMs;

  const provider: MoveProvider = async (board: Board, you: Player, moves: readonly number[]): Promise<MoveOutcome> => {
    if (remaining <= 0) {
      return { ok: false, reason: 'timeout', message: 'Clock already expired', think_ms: 0 };
    }

    const request: MoveRequestBody = {
      you,
      board,
      moves: [...moves],
      game: { match_id: matchId, game_number: 1, clock_remaining_ms: remaining },
    };

    const result = await callBot(options.baseUrl, request, { timeoutMs: remaining, fetchImpl: options.fetchImpl });
    options.onExchange?.({ request, result });
    remaining = Math.max(0, remaining - result.think_ms);

    if (!result.outcome.ok) {
      return { ok: false, reason: failureReasonFor(result.outcome.reason), message: result.outcome.message, think_ms: result.think_ms };
    }
    if (remaining <= 0) {
      return { ok: false, reason: 'timeout', message: 'Clock expired mid-move', think_ms: result.think_ms };
    }
    return { ok: true, column: result.outcome.column, think_ms: result.think_ms };
  };

  return provider;
}

function failureReasonFor(reason: BotFailureReason): MoveFailureReason {
  switch (reason) {
    case 'timeout':
      return 'timeout';
    case 'unreachable':
      return 'unreachable';
    case 'http_error':
    case 'malformed_json':
    case 'invalid_response':
      return 'invalid_move';
    default:
      return 'error';
  }
}
