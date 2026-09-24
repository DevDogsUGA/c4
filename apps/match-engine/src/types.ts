// Core internal types for the match engine. Keeping these in one place makes
// the seam between "Docker-free tournament math" and "Docker lifecycle" easy
// to see: BotTransport is the only thing that talks over a wire (or fakes
// doing so); everything else in this package is pure orchestration logic.

import type { TeamRef } from '@acm-uga/c4-contract';

/** A team as known to the match engine: a name plus its submitted repo URL. */
export interface Team {
  readonly name: string;
  readonly repoUrl: string;
  /** Member display names from the submission form, for presenter intros. */
  readonly members?: readonly string[];
  /** Template language detected from the frozen checkout (e.g. "python"). Populated by the prepare phase, not by roster loading. */
  readonly language?: string;
}

export function toTeamRef(team: Team): TeamRef {
  return {
    name: team.name,
    repo_url: team.repoUrl,
    ...(team.members ? { members: [...team.members] } : {}),
    ...(team.language ? { language: team.language } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bot transport: the seam. Everything above this interface (chess clock,
// game rules, match/tournament scheduling) is pure and Docker-free, and is
// tested that way. Only implementations of this interface (see docker/)
// touch a container or the network.
// ---------------------------------------------------------------------------

/** The result of a single /move attempt, as observed by the arena. */
export type MoveOutcome =
  | { type: 'ok'; column: number }
  /** Full/out-of-range column, malformed JSON, or non-200 response. */
  | { type: 'invalid'; detail: string }
  /** The bot process/container died mid-request (connection reset, OOM-kill, etc). */
  | { type: 'crashed'; detail: string };

export interface BotTransport {
  /**
   * Sends one /move request and resolves with what happened. Implementations
   * must not reject this promise for expected failure modes (bad response,
   * connection drop) — those are represented as `MoveOutcome` values so the
   * chess clock and forfeit logic never has to catch. Only reserve rejection
   * for genuine transport bugs the caller cannot reasonably handle.
   */
  move(request: import('@acm-uga/c4-contract').MoveRequest): Promise<MoveOutcome>;

  /**
   * Called after a `crashed` outcome. Must bring the bot back to a state
   * where `move` can be called again (restart a container, or a no-op for a
   * fake), and resolves with the wall-clock milliseconds the recovery took —
   * this is billed to the crashing player's clock per DESIGN.md.
   */
  restart(): Promise<number>;
}

// ---------------------------------------------------------------------------
// BotProvider: one level up from BotTransport. This is the seam
// match-orchestrator.ts and tournament-runner.ts actually depend on, so the
// *entire* orchestration layer (not just the chess clock/game rules) is
// testable without Docker or a real HTTP server — a fake provider can hand
// back an in-process FakeBotTransport directly. The production
// implementation (docker/docker-bot-provider.ts) composes
// DockerContainerRuntime + HttpBotTransport behind this same interface.
// ---------------------------------------------------------------------------

export interface BotProviderStartOptions {
  /** Directory containing the bot's Dockerfile (a checked-out team repo). */
  repoDir: string;
  /** Port the bot listens on (the PORT env var value it's given). */
  port: number;
  /** Off-clock grace period to become ready at startup, per DESIGN.md ("30s grace"). */
  healthGraceMs: number;
}

export interface StartedBot {
  transport: BotTransport;
  /** Tears down whatever `start` stood up (container, fake, ...). Best-effort; should not throw. */
  dispose(): Promise<void>;
}

export interface BotProvider {
  /**
   * Prepares a bot and hands back a ready-to-use transport. Should throw
   * StartupTimeoutError (see docker/container-runtime.ts) if the bot never
   * becomes healthy within `healthGraceMs` — the caller turns that into a
   * "startup_timeout" match forfeit per DESIGN.md. Should throw
   * ImageBuildError (or any other error) if the image failed to build — the
   * caller turns that into a "build_failed" match forfeit.
   */
  start(options: BotProviderStartOptions): Promise<StartedBot>;

  /**
   * Optional prebuild hook for the submission-freeze workflow: builds
   * (and, for real providers, caches) whatever `start` needs for `repoDir`
   * ahead of time, so the freeze/prepare phase — not match play — is where
   * checkout/build failures surface. DockerBotProvider implements this: one
   * build per team per tournament, tagged deterministically from the team
   * + commit, reused by every subsequent `start()` call for that repoDir.
   * Providers that don't implement `prepare` simply build on the first
   * `start()` call as before; callers must treat `prepare` as best-effort
   * optimism, not a guarantee that `start` will skip building.
   *
   * Throws the same error types `start` does (StartupTimeoutError /
   * ImageBuildError / other) on failure.
   */
  prepare?(repoDir: string): Promise<void>;

  /**
   * Removes whatever `prepare()` built, best-effort. Never called
   * automatically by the orchestration layer — a caller opts in (e.g. `c4
   * run-tournament --cleanup-images`); the default is to keep prepared
   * images around so a rerun against the same commits is fast.
   */
  cleanupPreparedImages?(): Promise<void>;
}
