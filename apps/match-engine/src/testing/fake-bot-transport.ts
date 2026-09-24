// A scriptable, in-process BotTransport — never touches Docker or the
// network. This is the seam IMPLEMENTATION_PLAN.md calls for: "clock/
// scheduler/tournament logic is fully tested with an in-process fake bot
// and NO Docker." Exported publicly so tests in this package (and other
// packages/tools, e.g. fixture generation) can reuse it.

import type { MoveRequest } from '@connect-4/contract';
import { legalMoves } from '@connect-4/engine';
import type { BotTransport, MoveOutcome } from '../types.js';

/** Decides what a fake bot responds with for a given request. `callCount` is 0-based and increments across every `move()` call (including resends after a restart). */
export type FakeBotScript = (request: MoveRequest, callCount: number) => MoveOutcome | Promise<MoveOutcome>;

export interface FakeBotTransportOptions {
  /** Defaults to "always play the first legal column". */
  script?: FakeBotScript;
  /** Simulated think time in ms before `move()` resolves — a real delay, so the caller's wall-clock chess-clock billing observes it. Default 0. */
  thinkMs?: number | ((request: MoveRequest, callCount: number) => number);
  /** Simulated restart cost in ms, returned by `restart()`. Default 0. */
  restartMs?: number | ((restartCount: number) => number);
}

function defaultScript(request: MoveRequest): MoveOutcome {
  const legal = legalMoves(request.board as unknown as import('@connect-4/engine').Board);
  return { type: 'ok', column: legal[0] ?? 0 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeBotTransport implements BotTransport {
  private moveCallCount = 0;
  private restartCallCount = 0;

  constructor(private readonly options: FakeBotTransportOptions = {}) {}

  async move(request: MoveRequest): Promise<MoveOutcome> {
    const callCount = this.moveCallCount++;
    const thinkMs = typeof this.options.thinkMs === 'function' ? this.options.thinkMs(request, callCount) : this.options.thinkMs ?? 0;
    if (thinkMs > 0) await delay(thinkMs);
    const script = this.options.script ?? defaultScript;
    return script(request, callCount);
  }

  async restart(): Promise<number> {
    const restartCount = this.restartCallCount++;
    const restartMs = typeof this.options.restartMs === 'function' ? this.options.restartMs(restartCount) : this.options.restartMs ?? 0;
    if (restartMs > 0) await delay(restartMs);
    return restartMs;
  }
}
