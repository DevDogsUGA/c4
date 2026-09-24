// The production BotProvider: composes DockerContainerRuntime (build/run/
// health-check a container) with HttpBotTransport (the /move wire format)
// behind the single seam match-orchestrator.ts and tournament-runner.ts
// depend on. This is the only file that wires Docker to the rest of the
// package — everything else reaches Docker only through this.

import type { BotProvider, BotProviderStartOptions, StartedBot } from '../types.js';
import { DockerContainerRuntime, type ContainerRuntime } from './container-runtime.js';
import { HttpBotTransport } from './http-bot-transport.js';

export class DockerBotProvider implements BotProvider {
  constructor(private readonly runtime: ContainerRuntime = new DockerContainerRuntime()) {}

  async start(options: BotProviderStartOptions): Promise<StartedBot> {
    const handle = await this.runtime.start(options);
    return {
      transport: new HttpBotTransport(handle),
      dispose: () => handle.dispose(),
    };
  }

  /** TASK 1: build each team's image once per tournament — delegates to DockerContainerRuntime.prepare, which caches the build by repoDir so every subsequent start() for the same repoDir reuses it instead of rebuilding. */
  async prepare(repoDir: string): Promise<void> {
    if (!this.runtime.prepare) return; // defensive: a ContainerRuntime without a prebuild cache just builds on start() as before.
    await this.runtime.prepare(repoDir);
  }

  async cleanupPreparedImages(): Promise<void> {
    await this.runtime.cleanupImages?.();
  }
}
