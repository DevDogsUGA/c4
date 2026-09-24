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
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Docker from 'dockerode';

const execFileAsync = promisify(execFile);

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

  /**
   * Builds (once) and caches the image for `repoDir`, so subsequent
   * `start()` calls for the same `repoDir` reuse it instead of rebuilding.
   * Returns the built image tag. Throws ImageBuildError on failure (see
   * buildImage / BUILD_TIMEOUT_MS).
   */
  prepare?(repoDir: string): Promise<string>;

  /**
   * Removes every image this runtime instance built (via `prepare` or an
   * uncached `start`), best-effort. Never called automatically — a caller
   * opts in (e.g. `c4 run-tournament --cleanup-images`) since the default
   * is to keep images around so reruns are fast.
   */
  cleanupImages?(): Promise<void>;
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
/** Hard cap on a single `docker build`. Prevents one team's pathological Dockerfile (huge context, an infinite RUN step, a hung package-manager prompt) from tying up a build slot — and thus other teams' prepare sweep — indefinitely. */
const BUILD_TIMEOUT_MS = 10 * 60_000;
/** How many trailing lines of `docker build` output to keep for ImageBuildError's detail message. */
const BUILD_LOG_TAIL_LINES = 40;

/**
 * Bounds how many `docker build`s run at once across this whole process,
 * independent of however many teams' prepare() calls are in flight
 * concurrently (prepare.ts's own concurrency knob is sized for the
 * lighter checkout/git step, not for CPU/IO-heavy image builds). Shared by
 * every DockerContainerRuntime instance in the process, since they all
 * point at the same Docker daemon and host CPU.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = Math.max(1, concurrency);
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available--;
    return () => this.release();
  }

  private release(): void {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** min(8, cpus/4): builds are CPU/IO heavy, so prepare's build step is throttled well below the (much higher) match/checkout concurrency. */
export function defaultBuildConcurrency(availableCpus: number = os.cpus().length): number {
  return Math.max(1, Math.min(8, Math.floor(availableCpus / 4)));
}

const buildSemaphore = new Semaphore(defaultBuildConcurrency());

/** Docker repository:tag names must be lowercase and limited to `[a-z0-9._-]`. */
export function sanitizeTagComponent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'x';
}

/**
 * Deterministic image tag for a team + commit, per TASK 1: `c4-bot-<safe
 * team>-<short sha>`. Reads the commit straight out of the checkout
 * (`git rev-parse HEAD` in repoDir) rather than threading it through the
 * BotProvider.prepare(repoDir) signature, since checkoutRepoAtCommit
 * (git.ts) already leaves repoDir checked out at the exact frozen commit —
 * this keeps the BotProvider interface (and every fake implementing it)
 * unchanged while still getting a build-once-per-commit cache key.
 */
export async function imageTagFor(repoDir: string): Promise<string> {
  const team = sanitizeTagComponent(path.basename(repoDir));
  let shortSha = 'nocommit';
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { timeout: 30_000 });
    shortSha = stdout.trim().slice(0, 12) || shortSha;
  } catch {
    // Not a git checkout (e.g. a unit-test fixture dir) — fall back to a
    // stable placeholder rather than failing prepare over tag cosmetics.
  }
  return `c4-bot-${team}-${sanitizeTagComponent(shortSha)}`;
}

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

/** Runs one `docker build`, bounded by the shared build semaphore and a hard wall-clock timeout, with a trailing-log tail captured for ImageBuildError's detail. */
async function buildImage(
  docker: Docker,
  repoDir: string,
  tag: string,
  labels: Record<string, string>,
  timeoutMs: number = BUILD_TIMEOUT_MS,
): Promise<void> {
  const release = await buildSemaphore.acquire();
  try {
    const entries = await readdir(repoDir);
    const stream = await docker.buildImage({ context: repoDir, src: entries }, { t: tag, labels });

    const tail: string[] = [];
    const pushTail = (line: string): void => {
      for (const part of line.split('\n')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        tail.push(trimmed);
        if (tail.length > BUILD_LOG_TAIL_LINES) tail.shift();
      }
    };

    let timedOut = false;
    const buildPromise = new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null, output: Array<{ error?: string; errorDetail?: { message?: string }; stream?: string }>) => {
          if (timedOut) return; // the outer race already settled; avoid an unhandled rejection.
          if (err) return reject(new ImageBuildError(withTail(err.message, tail)));
          const failure = output.find((entry) => entry && entry.error);
          if (failure) {
            return reject(
              new ImageBuildError(withTail(failure.errorDetail?.message ?? failure.error ?? 'unknown build error', tail)),
            );
          }
          resolve();
        },
        (event: { stream?: string; status?: string }) => {
          if (event.stream) pushTail(event.stream);
          else if (event.status) pushTail(event.status);
        },
      );
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ImageBuildError(withTail(`build timed out after ${Math.round(timeoutMs / 1000)}s`, tail)));
      }, timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });

    try {
      await Promise.race([buildPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      // Swallow a late rejection/resolution from the loser of the race so it
      // never surfaces as an unhandled rejection.
      buildPromise.catch(() => undefined);
    }
  } finally {
    release();
  }
}

function withTail(message: string, tail: readonly string[]): string {
  if (tail.length === 0) return message;
  return `${message}\n--- build log tail ---\n${tail.join('\n')}`;
}

export class DockerContainerRuntime implements ContainerRuntime {
  private readonly docker: Docker;
  private readonly runId: string;
  /** repoDir -> prebuilt image tag, populated by `prepare()`. `start()` for a cached repoDir reuses the image and skips the build entirely. */
  private readonly preparedImages = new Map<string, string>();
  /** Every image tag this runtime instance has built (prepared or ad hoc), for `cleanupImages()`. */
  private readonly builtImageTags = new Set<string>();

  constructor(docker: Docker = new Docker(), runId: string = randomUUID()) {
    this.docker = docker;
    this.runId = runId;
  }

  /**
   * Builds (once) and caches the image for `repoDir`, tagged deterministically
   * from the team name + checked-out commit (see imageTagFor). A second
   * `prepare()` call for a repoDir that already resolves to the same tag is a
   * no-op (idempotent) rather than a rebuild — e.g. a re-run against the same
   * frozen commit reuses the still-cached image instead of building again.
   */
  async prepare(repoDir: string): Promise<string> {
    const tag = await imageTagFor(repoDir);
    if (this.preparedImages.get(repoDir) === tag && (await this.imageExists(tag))) {
      return tag;
    }
    const labels = arenaLabels(this.runId);
    await buildImage(this.docker, repoDir, tag, labels);
    this.preparedImages.set(repoDir, tag);
    this.builtImageTags.add(tag);
    return tag;
  }

  private async imageExists(tag: string): Promise<boolean> {
    return this.docker
      .getImage(tag)
      .inspect()
      .then(() => true)
      .catch(() => false);
  }

  /** Removes every image this runtime instance built (via `prepare` or an uncached `start`). Best-effort; never throws. Opt-in only — see the ContainerRuntime interface doc. */
  async cleanupImages(): Promise<void> {
    await Promise.all(
      [...this.builtImageTags].map((tag) =>
        this.docker
          .getImage(tag)
          .remove({ force: true })
          .catch(() => undefined),
      ),
    );
    this.builtImageTags.clear();
    this.preparedImages.clear();
  }

  async start(options: StartOptions): Promise<ContainerHandle> {
    const { repoDir, port, healthGraceMs } = options;
    const id = randomUUID();
    const networkName = `c4-net-${id}`;
    const portKey = `${port}/tcp`;
    const labels = arenaLabels(this.runId);

    // Reuse the prebuilt image from `prepare()` when this exact repoDir was
    // prepared ahead of time (TASK 1: build each team's image once per
    // tournament) — otherwise fall back to the pre-existing per-call
    // ephemeral build (e.g. `c4 run-match`'s ad hoc one-off matches, or any
    // BotProvider.start() call that never went through prepare()).
    let imageTag = this.preparedImages.get(repoDir);
    const isEphemeralImage = !imageTag;
    if (!imageTag) {
      imageTag = `c4-bot-${id}`;
      await buildImage(this.docker, repoDir, imageTag, labels);
      this.builtImageTags.add(imageTag);
    }

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
      // A per-call ephemeral image (no prepare() cache hit) is uniquely
      // tagged for this one container and must be removed here, or a
      // multi-match tournament leaks one image per container started,
      // unbounded, for the lifetime of the host. A *prepared* (TASK 1:
      // build-once) image is shared across every match the team plays —
      // removing it here would break every subsequent match for that team,
      // so it's left alone; cleanupImages() (opt-in, end of tournament)
      // removes it instead.
      if (isEphemeralImage) {
        await this.docker.getImage(imageTag).remove({ force: true }).catch(() => undefined);
      }
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
