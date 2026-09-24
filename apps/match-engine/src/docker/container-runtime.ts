// Docker lifecycle: build a bot's image, run it with the caps DESIGN.md
// specifies, and expose a /health-checked handle to it. This is the only
// module in the package that touches the Docker API — everything above the
// BotTransport interface (clock, game rules, match/tournament scheduling)
// never imports this file, and is tested without it.
//
// DESIGN.md caps: 1 CPU (pinned, `NanoCpus`), 512MB memory, `--network none`
// ("closes every online-cheat door at match time"), fresh containers per
// match, PORT env var, and a 30s off-clock health-check grace at startup.
//
// Isolation model ("--network none" in DESIGN.md is shorthand for "no
// online-cheat door"): each container gets its own per-container network
// created with `Internal: true` — no default route, no NAT, so the bot
// cannot reach the internet or other bots. Internal networks never get
// port-forwarding wired up (verified empirically: publishing a port on an
// internal network leaves `NetworkSettings.Ports` empty), so the arena
// does NOT publish ports at all; it talks straight to the container's IP
// on the internal bridge, which the host can always reach because it owns
// the bridge interface (verified empirically: host curl to the container
// IP succeeds while the container's own egress gets ENETUNREACH).
//
// This is deliberately *stricter* than "one internal network per match":
// every container gets its own private network, so a container never has
// an L2-reachable neighbor at all — not even its own match opponent. There
// is no shared bridge for a hostile bot to ARP-scan or otherwise probe.
//
// Portability constraint this creates: direct container-IP access from the
// host only works where the arena shares a network namespace with the
// Docker daemon's bridges — native Linux, or inside the same WSL2 distro
// as dockerd. It does not work from a macOS/Windows host talking to Docker
// Desktop's VM. DESIGN.md pins the showdown to a Linux machine or cloud
// instance, so this is acceptable; revisit if that changes.
//
// Additional hostile-bot hardening (stress bots at the event), each with an
// integration test in docker.integration.test.ts:
//   - PidsLimit caps the container's process/thread count, so a fork bomb
//     can't exhaust host PIDs.
//   - MemorySwap === Memory disables swap for the container: an
//     over-budget bot gets OOM-killed promptly instead of thrashing the
//     host's swap device. An OOM-kill is a container exit, which surfaces
//     to the transport as a `crashed` MoveOutcome (connection drop) and
//     goes through the existing restart/crash_loop billing path in
//     game-runner.ts — no separate "OOM" code path needed.
//   - LogConfig bounds each container's `json-file` log driver output, so
//     a bot that spams stdout/stderr can't fill the host disk via logs.
//   - ReadonlyRootfs + a size-limited tmpfs at /tmp: verified empirically
//     against all 9 starter templates (python, node, typescript, java, go,
//     csharp, cpp, c, rust) — each builds, passes /health, and answers
//     /move under `--read-only` with only /tmp mounted as tmpfs. None of
//     them needed additional writable paths or runtime env vars (no
//     DOTNET_*/JAVA_TOOL_OPTIONS/PYTHONDONTWRITEBYTECODE workarounds were
//     necessary in practice), so this is unconditional for every bot.
//   - Every object this module creates (container, network, image) carries
//     the `c4.arena=1` / `c4.run=<runId>` labels so leftovers from a crashed
//     engine process can be found and swept independently of this module's
//     own (best-effort) cleanup.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import Docker from 'dockerode';

export class StartupTimeoutError extends Error {
  constructor(message = 'bot did not become healthy within the startup grace period') {
    super(message);
    this.name = 'StartupTimeoutError';
  }
}

export class ImageBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageBuildError';
  }
}

export interface ContainerHandle {
  readonly baseUrl: string;
  /**
   * Restarts the container process and waits for /health again. Resolves
   * with the wall-clock milliseconds this took — billed to the crashing
   * bot's clock per DESIGN.md. Does not throw on a restart that never
   * becomes healthy again; it resolves with whatever time was spent up to
   * an internal cap, so the caller's own clock accounting forfeits the game
   * naturally instead of this module inventing a second timeout policy.
   *
   * Works uniformly whether the container is `exited` (OOM-killed, or a
   * self-exit / exit 0) or still `running` — `docker restart` is defined
   * for both states; Docker starts a stopped container rather than
   * erroring on it.
   */
  restart(): Promise<number>;
  /** Stops and removes the container (and its private network). Best-effort; never throws. */
  dispose(): Promise<void>;
}

export interface StartOptions {
  /** Directory containing the bot's Dockerfile (a checked-out team repo). */
  repoDir: string;
  /** Container port the bot listens on (the PORT env var value given to it). */
  port: number;
  /** Off-clock grace period to become healthy at startup, per DESIGN.md ("30s grace"). */
  healthGraceMs: number;
}

export interface ContainerRuntime {
  /**
   * Builds and starts a fresh container from `repoDir`, waits for /health
   * within `healthGraceMs`. Throws StartupTimeoutError or ImageBuildError
   * on failure; the caller (match orchestrator) turns that into a
   * "startup_timeout" match forfeit per DESIGN.md.
   */
  start(options: StartOptions): Promise<ContainerHandle>;
}

const ONE_CPU_NANOS = 1_000_000_000;
const MEMORY_BYTES = 512 * 1024 * 1024;
/** Caps forkbomb-style PID exhaustion; generous enough for any legitimate bot (interpreter + a handful of worker threads). */
const PIDS_LIMIT = 256;
/** Size-limited tmpfs for the one writable path bots get under ReadonlyRootfs. */
const TMP_TMPFS_OPTS = 'rw,size=64m,mode=1777,nosuid,nodev';
const HEALTH_POLL_INTERVAL_MS = 200;
/** Cap on how long a single restart's health wait is allowed to run before giving up and reporting elapsed time; prevents one crash-looping bot from hanging the orchestrator forever. */
const RESTART_HEALTH_CAP_MS = 30_000;

/** Labels stamped on every container/network/image this module creates, so leftovers from a crashed engine process can be found (`docker ... --filter label=c4.arena=1`) independent of this module's own best-effort cleanup. */
function arenaLabels(runId: string): Record<string, string> {
  return { 'c4.arena': '1', 'c4.run': runId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<{ healthy: boolean; elapsedMs: number }> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))),
      });
      if (res.ok) return { healthy: true, elapsedMs: Date.now() - start };
    } catch {
      // Not up yet (connection refused, DNS, timeout) — keep polling until the deadline.
    }
    if (Date.now() >= deadline) {
      return { healthy: false, elapsedMs: Date.now() - start };
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

async function buildImage(docker: Docker, repoDir: string, tag: string, labels: Record<string, string>): Promise<void> {
  const entries = await readdir(repoDir);
  const stream = await docker.buildImage({ context: repoDir, src: entries }, { t: tag, labels });
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null, output: Array<{ error?: string; errorDetail?: { message?: string } }>) => {
        if (err) return reject(new ImageBuildError(err.message));
        const failure = output.find((entry) => entry && entry.error);
        if (failure) {
          return reject(new ImageBuildError(failure.errorDetail?.message ?? failure.error ?? 'unknown build error'));
        }
        resolve();
      },
    );
  });
}

export class DockerContainerRuntime implements ContainerRuntime {
  private readonly docker: Docker;
  private readonly runId: string;

  constructor(docker: Docker = new Docker(), runId: string = randomUUID()) {
    this.docker = docker;
    this.runId = runId;
  }

  async start(options: StartOptions): Promise<ContainerHandle> {
    const { repoDir, port, healthGraceMs } = options;
    const id = randomUUID();
    const imageTag = `c4-bot-${id}`;
    const networkName = `c4-net-${id}`;
    const portKey = `${port}/tcp`;
    const labels = arenaLabels(this.runId);

    await buildImage(this.docker, repoDir, imageTag, labels);

    // `Internal: true` blocks all egress (no default route, no NAT); the
    // arena reaches the bot via its container IP on this bridge instead of
    // a published port — see the file-level comment for the verified
    // reachability model and its Linux-only constraint.
    const network = await this.docker.createNetwork({ Name: networkName, Internal: true, Labels: labels });

    const container = await this.docker.createContainer({
      Image: imageTag,
      Env: [`PORT=${port}`],
      ExposedPorts: { [portKey]: {} },
      Labels: labels,
      HostConfig: {
        NetworkMode: networkName,
        NanoCpus: ONE_CPU_NANOS,
        Memory: MEMORY_BYTES,
        // Disable swap for the container (Docker's own convention: set
        // MemorySwap === Memory). Without this a bot can page out to the
        // host's swap device instead of getting OOM-killed at the 512MB
        // line, which both defeats the memory cap and can hammer host I/O.
        MemorySwap: MEMORY_BYTES,
        PidsLimit: PIDS_LIMIT,
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': TMP_TMPFS_OPTS },
        LogConfig: {
          Type: 'json-file',
          Config: { 'max-size': '1m', 'max-file': '1' },
        },
        AutoRemove: false,
      },
    });

    const disposeAll = async (): Promise<void> => {
      await container.remove({ force: true }).catch(() => undefined);
      await network.remove().catch(() => undefined);
      // Each match builds a uniquely-tagged image (see imageTag above); without
      // this, a multi-match tournament leaks one image per container started,
      // unbounded, for the lifetime of the host.
      await this.docker.getImage(imageTag).remove({ force: true }).catch(() => undefined);
    };

    try {
      await container.start();
    } catch (err) {
      await disposeAll();
      throw err;
    }

    let baseUrl = await this.resolveBaseUrl(container, networkName, port);
    const { healthy } = await waitForHealthy(baseUrl, healthGraceMs);
    if (!healthy) {
      await disposeAll();
      throw new StartupTimeoutError();
    }

    return {
      get baseUrl() {
        return baseUrl;
      },
      restart: async () => {
        const restartStart = Date.now();
        // `docker restart` is defined for both a still-`running` container
        // (e.g. we're proactively cycling it) and an `exited` one (OOM-kill,
        // or the bot process exiting on its own, including exit 0) — Docker
        // starts a stopped container rather than erroring, so this one call
        // covers every crash flavor the transport can observe as `crashed`.
        await container.restart().catch(() => undefined);
        // Docker does not guarantee the same IP on re-attach; re-resolve
        // before health-polling so the transport (which reads baseUrl per
        // request) follows the container.
        baseUrl = await this.resolveBaseUrl(container, networkName, port).catch(() => baseUrl);
        const { elapsedMs } = await waitForHealthy(baseUrl, RESTART_HEALTH_CAP_MS);
        return Date.now() - restartStart || elapsedMs;
      },
      dispose: disposeAll,
    };
  }

  private async resolveBaseUrl(
    container: Docker.Container,
    networkName: string,
    containerPort: number,
  ): Promise<string> {
    const info = await container.inspect();
    const ip = info.NetworkSettings.Networks?.[networkName]?.IPAddress;
    if (!ip) {
      throw new Error(`container has no IP address on network ${networkName}`);
    }
    return `http://${ip}:${containerPort}`;
  }
}
