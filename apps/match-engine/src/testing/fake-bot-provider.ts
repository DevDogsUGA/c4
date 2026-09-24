// A scriptable, in-process BotProvider — never touches Docker or the
// network. Lets tests exercise match-orchestrator.ts / tournament-runner.ts
// end-to-end (startup-timeout forfeits, per-match cleanup, concurrency)
// purely in-process, keyed by the `repoDir` each `start()` call receives.

import { StartupTimeoutError } from '../docker/container-runtime.js';
import type { BotProvider, BotProviderStartOptions, StartedBot } from '../types.js';
import { FakeBotTransport, type FakeBotTransportOptions } from './fake-bot-transport.js';

export interface FakeBotProviderOptions {
  /** Per-repoDir transport scripting. A repoDir not listed gets a default transport (always plays the first legal column). */
  transports?: Record<string, FakeBotTransportOptions>;
  /** repoDirs that should fail to start with a StartupTimeoutError (simulating a bot that never passes /health). */
  failToStart?: ReadonlySet<string>;
  /** Called whenever a started bot is disposed, for cleanup assertions. */
  onDispose?: (repoDir: string) => void;
}

export class FakeBotProvider implements BotProvider {
  /** Every repoDir `start()` was called with, in call order — for asserting orchestration wiring. */
  public readonly startedRepoDirs: string[] = [];

  constructor(private readonly options: FakeBotProviderOptions = {}) {}

  async start(options: BotProviderStartOptions): Promise<StartedBot> {
    this.startedRepoDirs.push(options.repoDir);
    if (this.options.failToStart?.has(options.repoDir)) {
      throw new StartupTimeoutError();
    }
    const transport = new FakeBotTransport(this.options.transports?.[options.repoDir]);
    return {
      transport,
      dispose: async () => {
        this.options.onDispose?.(options.repoDir);
      },
    };
  }
}
