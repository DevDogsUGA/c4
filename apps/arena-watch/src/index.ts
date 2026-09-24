import { loadConfig } from './config.js';
import { lsRemoteHead } from './git.js';
import { log } from './log.js';
import { nextBackoffMs, runTick } from './scheduler.js';
import { loadState, saveState, type WatchState } from './state.js';
import { makeEngineValidate } from './validate.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.enabled) {
    log.info('C4_WATCH_ENABLED != 1, arena-watch is idle');
    return;
  }

  log.info('arena-watch starting', {
    workerUrl: config.workerUrl,
    pollIntervalMs: config.pollIntervalMs,
    concurrency: config.concurrency,
  });

  const state: WatchState = await loadState(config.stateFile);
  const inFlight = new Set<string>();
  const runValidate = makeEngineValidate({
    engineBin: config.engineBin,
    timeoutMs: config.validateTimeoutMs,
  });

  let consecutiveFailures = 0;
  let shuttingDown = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log.info(`received ${sig}, shutting down after current tick`);
      shuttingDown = true;
    });
  }

  while (!shuttingDown) {
    const tickStarted = Date.now();
    try {
      const { outcomes, rosterSource } = await runTick({
        workerUrl: config.workerUrl,
        rosterToken: config.rosterToken,
        resultsToken: config.resultsToken,
        backupRosterUrl: config.backupRosterUrl,
        discordWebhookUrl: config.discordWebhookUrl,
        rosterFetchTimeoutMs: config.rosterFetchTimeoutMs,
        concurrency: config.concurrency,
        state,
        inFlight,
        runValidate,
        lsRemote: lsRemoteHead,
      });

      const changed = outcomes.filter((o) => o.changed);
      const errors = outcomes.filter((o) => o.error);
      log.info('tick complete', {
        rosterSource,
        teams: outcomes.length,
        changed: changed.length,
        errors: errors.length,
        ms: Date.now() - tickStarted,
      });
      for (const o of errors) {
        log.warn('team had an error this tick', { team: o.team.team_name, error: o.error });
      }

      await saveState(config.stateFile, state);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      log.error('tick failed', {
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures,
      });
    }

    if (shuttingDown) break;

    const delay =
      consecutiveFailures > 0
        ? nextBackoffMs(consecutiveFailures - 1, { baseMs: config.pollIntervalMs, maxMs: config.pollIntervalMs * 16 })
        : config.pollIntervalMs;
    await sleep(delay);
  }

  log.info('arena-watch stopped');
}

main().catch((err) => {
  log.error('arena-watch crashed', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exitCode = 1;
});
