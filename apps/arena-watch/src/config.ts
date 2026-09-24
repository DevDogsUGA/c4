// Env parsing for arena-watch. Every secret/URL comes from /etc/c4/env
// (loaded by systemd's EnvironmentFile=), never hardcoded.

export interface WatchConfig {
  enabled: boolean;
  workerUrl: string;
  rosterToken: string;
  resultsToken: string;
  backupRosterUrl: string | undefined;
  discordWebhookUrl: string | undefined;
  /** Test-only override: read the roster from a local JSON file instead of
   * hitting WORKER_URL/BACKUP_ROSTER_URL. Never set in production -- lets a
   * dry run exercise the full tick pipeline (ls-remote, validate, results,
   * Discord, state) against a synthetic roster without touching the real
   * registry. See ops/linode/README.md's arena-watch dry-run section. */
  rosterFile: string | undefined;
  engineBin: string;
  stateFile: string;
  pollIntervalMs: number;
  concurrency: number;
  rosterFetchTimeoutMs: number;
  validateTimeoutMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`missing required env var ${key}`);
  return v;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`env var ${key} must be a positive number, got ${v}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WatchConfig {
  const enabled = env.C4_WATCH_ENABLED === '1';
  return {
    enabled,
    // Only required once actually enabled -- lets the unit start/stop cheaply
    // when the operator flips C4_WATCH_ENABLED off between rounds.
    workerUrl: enabled ? required(env, 'WORKER_URL') : (env.WORKER_URL ?? ''),
    rosterToken: enabled ? required(env, 'C4_ROSTER_TOKEN') : (env.C4_ROSTER_TOKEN ?? ''),
    resultsToken: enabled ? required(env, 'RESULTS_TOKEN') : (env.RESULTS_TOKEN ?? ''),
    backupRosterUrl: env.BACKUP_ROSTER_URL,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
    rosterFile: env.C4_WATCH_ROSTER_FILE,
    engineBin: env.C4_ENGINE_BIN ?? '/opt/c4/apps/match-engine/dist/cli.js',
    stateFile: env.C4_WATCH_STATE_FILE ?? '/var/lib/c4/arena-watch-state.json',
    pollIntervalMs: int(env, 'C4_WATCH_POLL_INTERVAL_MS', 60_000),
    concurrency: int(env, 'C4_WATCH_CONCURRENCY', 4),
    rosterFetchTimeoutMs: int(env, 'C4_WATCH_ROSTER_TIMEOUT_MS', 10_000),
    validateTimeoutMs: int(env, 'C4_WATCH_VALIDATE_TIMEOUT_MS', 120_000),
  };
}
