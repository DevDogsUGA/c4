// A scriptable, in-process BotProvider — never touches Docker or the
// network. Lets tests exercise match-orchestrator.ts / tournament-runner.ts
// end-to-end (startup-timeout forfeits, per-match cleanup, concurrency)
// purely in-process, keyed by the `repoDir` each `start()` call receives.

import { ImageBuildError, StartupTimeoutError } from '../docker/container-runtime.js';
import type { BotProvider, BotProviderStartOptions, StartedBot } from '../types.js';
import { FakeBotTransport, type FakeBotTransportOptions } from './fake-bot-transport.js';

export interface FakeBotProviderOptions {
  /** Per-repoDir transport scripting. A repoDir not listed gets a default transport (always plays the first legal column). */
  transports?: Record<string, FakeBotTransportOptions>;
  /** repoDirs that should fail to start with a StartupTimeoutError (simulating a bot that never passes /health). */
  failToStart?: ReadonlySet<string>;
  /** repoDirs that should fail to start with an ImageBuildError (simulating a broken Dockerfile/build). */
  failToBuild?: ReadonlySet<string>;
  /** Called whenever a started bot is disposed, for cleanup assertions. */
  onDispose?: (repoDir: string) => void;
  /** If true, this fake implements BotProvider.prepare(repoDir) — a real "build once" cache: start() then skips the build-failure simulation for a repoDir once prepare() has succeeded for it. */
  supportsPrepare?: boolean;
}

export class FakeBotProvider implements BotProvider {
  /** Every repoDir `start()` was called with, in call order — for asserting orchestration wiring. */
  public readonly startedRepoDirs: string[] = [];
  /** Every repoDir `prepare()` was called with, in call order (only populated when `supportsPrepare` is set). */
  public readonly preparedRepoDirs: string[] = [];
  private readonly builtRepoDirs = new Set<string>();

  constructor(private readonly options: FakeBotProviderOptions = {}) {
    if (options.supportsPrepare) {
      this.prepare = async (repoDir: string) => {
        this.preparedRepoDirs.push(repoDir);
        if (this.options.failToBuild?.has(repoDir)) {
          throw new ImageBuildError(`fake build failure for ${repoDir}`);
        }
        if (this.options.failToStart?.has(repoDir)) {
          throw new StartupTimeoutError();
        }
        this.builtRepoDirs.add(repoDir);
      };
    }
  }

  /** Only assigned when constructed with `supportsPrepare: true` — matches BotProvider's optional `prepare` being absent otherwise. */
  prepare?: (repoDir: string) => Promise<void>;

  async start(options: BotProviderStartOptions): Promise<StartedBot> {
    this.startedRepoDirs.push(options.repoDir);
    if (this.options.failToBuild?.has(options.repoDir) && !this.builtRepoDirs.has(options.repoDir)) {
      throw new ImageBuildError(`fake build failure for ${options.repoDir}`);
    }
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
