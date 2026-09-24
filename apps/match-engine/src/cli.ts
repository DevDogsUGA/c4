#!/usr/bin/env node
// Headless CLI per EVENT_PLAN.md's "Engine CLI" shared interfaces:
// `c4 freeze`, `c4 run-tournament [--lock]`, `c4 validate [--json]`,
// `c4 run-match`, plus `--bundle`/`--upload-r2` on run-tournament.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { THINK_BUDGET_MS } from '@acm-uga/c4-contract';
import { Command } from 'commander';
import Docker from 'dockerode';
import { DockerContainerRuntime } from './docker/container-runtime.js';
import { DockerBotProvider } from './docker/docker-bot-provider.js';
import { checkoutRepoAtCommit } from './git.js';
import { freeze, readLockFile, writeLockFile, type LockFile } from './lock.js';
import { orchestrateMatch } from './match-orchestrator.js';
import { prepareTeams, type PreparedTeam } from './prepare.js';
import { presignGetUrl, r2CredentialsFromEnv, uploadToR2, bundleObjectKey } from './r2.js';
import { createSeededRng } from './rng.js';
import { loadRoster } from './roster.js';
import { matchConcurrency } from './scheduler.js';
import { runTournament } from './tournament-runner.js';
import type { MatchForfeitReason } from '@acm-uga/c4-contract';
import type { Team } from './types.js';
import { validateTeam } from './validate.js';
import { writeMatchRecord } from './output.js';

const program = new Command();
program.name('c4').description('Connect Four hackathon match engine').version('1.0.0');

function makeProvider(): DockerBotProvider {
  return new DockerBotProvider(new DockerContainerRuntime(new Docker()));
}

function defaultSeed(): number {
  return Date.now() >>> 0;
}

function hashFile(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Turns a prepare.ts sweep into the maps runTournament/validate consume. */
function forfeitsAndLanguagesFrom(prepared: PreparedTeam[]): {
  forfeits: Map<string, MatchForfeitReason>;
  languages: Map<string, string>;
  repoDirs: Map<string, string>;
} {
  const forfeits = new Map<string, MatchForfeitReason>();
  const languages = new Map<string, string>();
  const repoDirs = new Map<string, string>();
  for (const p of prepared) {
    if (p.forfeit) forfeits.set(p.team.name, p.forfeit);
    if (p.language) languages.set(p.team.name, p.language);
    if (p.repoDir) repoDirs.set(p.team.name, p.repoDir);
  }
  return { forfeits, languages, repoDirs };
}

function applyLanguages(teams: Team[], languages: Map<string, string>): Team[] {
  return teams.map((t) => (languages.has(t.name) ? { ...t, language: languages.get(t.name) } : t));
}

program
  .command('freeze')
  .description('Resolve every team\'s current default-branch commit into a lock file (the submission freeze)')
  .requiredOption('--roster <source>', 'CSV path, JSON path, or https URL')
  .requiredOption('--output <path>', 'lock file to write')
  .option('--concurrency <n>', 'bounded concurrency for the git ls-remote sweep', (v) => Number(v), 8)
  .action(async (opts) => {
    const teams = await loadRoster(opts.roster);
    const lock = await freeze(teams, { concurrency: opts.concurrency });
    await writeLockFile(opts.output, lock);

    const failed = lock.teams.filter((t) => t.commit === null);
    console.log(`Wrote ${opts.output}: ${lock.teams.length} teams, ${failed.length} unresolved.`);
    for (const t of failed) {
      console.error(`  FAIL  ${t.name}: ${t.error}`);
    }
    if (failed.length > 0) process.exitCode = 1;
  });

program
  .command('run-tournament')
  .description('Run the full round-robin + bracket tournament from a roster, emitting game records + a summary + a bundle')
  .requiredOption('--roster <source>', 'CSV path, JSON path, or https URL')
  .requiredOption('--output <dir>', 'directory to write game-record JSON files + tournament-summary.json + tournament.json')
  .option('--lock <path>', 'submission-freeze lock file (see `c4 freeze`); when omitted, freezes implicitly at start')
  .option('--work-dir <dir>', 'directory to check out team repos into', '.c4-checkouts')
  .option('--seed <n>', 'RNG seed for coin flips (deterministic if set)', (v) => Number(v))
  .option('--think-ms <n>', 'per-player, per-game think budget in ms', (v) => Number(v), THINK_BUDGET_MS)
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .option('--min-bracket-slots <n>', 'minimum single-elimination bracket size', (v) => Number(v), 16)
  .option('--concurrency <n>', 'max matches run in parallel (default: host-sized)', (v) => Number(v))
  .option('--bundle <path>', 'also write the single-file tournament bundle to this path')
  .option('--upload-r2', 'upload the bundle to R2 and print a 7-day presigned GET URL', false)
  .option(
    '--cleanup-images',
    'remove every image this run built (labeled c4.run=<run id>) once the tournament finishes; default is to keep them so a rerun against the same commits is fast',
    false,
  )
  .action(async (opts) => {
    const teams = await loadRoster(opts.roster);
    const rng = createSeededRng(opts.seed ?? defaultSeed());
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);
    const concurrency = opts.concurrency ?? matchConcurrency(os.cpus().length);

    let lock: LockFile | undefined;
    let lockHash: string | undefined;
    if (opts.lock) {
      const lockText = await readFile(opts.lock, 'utf8');
      lock = await readLockFile(opts.lock);
      lockHash = hashFile(lockText);
    }

    console.error(`Preparing ${teams.length} teams (checkout + language detect + build validation)...`);
    const prepared = await prepareTeams(teams, { provider, workDir, lock, botPort: opts.port, healthGraceMs: opts.healthGraceMs, concurrency });
    for (const p of prepared) {
      if (p.forfeit) console.error(`  BROKEN  ${p.team.name}: ${p.forfeit} (${p.detail ?? 'no detail'})`);
    }
    const { forfeits, languages, repoDirs } = forfeitsAndLanguagesFrom(prepared);
    const preparedTeams = applyLanguages(teams, languages);

    const result = await runTournament({
      teams: preparedTeams,
      outputDir: opts.output,
      provider,
      rng,
      resolveRepoDir: (team) => repoDirs.get(team.name) ?? '',
      preparedForfeits: forfeits,
      concurrency,
      thinkBudgetMs: opts.thinkMs,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
      minBracketSlots: opts.minBracketSlots,
      bundlePath: opts.bundle,
      provenance: {
        seed: opts.seed ?? null,
        think_budget_ms: opts.thinkMs,
        concurrency,
        lock_file: opts.lock ?? null,
        lock_file_sha256_16: lockHash ?? null,
      },
    });

    console.log(`Played ${result.matches.length} matches. Standings:`);
    for (const entry of result.summary.standings) {
      console.log(`  ${entry.rank}. ${entry.team.name} (${entry.match_wins}-${entry.match_losses} matches)`);
    }

    if (opts.uploadR2) {
      const creds = r2CredentialsFromEnv();
      if (!creds) {
        console.error('--upload-r2 given but R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET are not all set.');
        process.exitCode = 1;
        return;
      }
      const key = bundleObjectKey();
      await uploadToR2(creds, key, JSON.stringify(result.bundle));
      const url = await presignGetUrl(creds, key);
      console.log(`Uploaded bundle to R2. Presigned GET URL (valid 7 days):\n${url}`);
    }

    if (opts.cleanupImages) {
      console.error('Cleaning up prepared images for this run...');
      await provider.cleanupPreparedImages();
    }
  });

program
  .command('validate')
  .description('Pull all -> build -> smoke game for every team in the roster; reports readiness')
  .requiredOption('--roster <source>', 'CSV path, JSON path, or https URL')
  .option('--work-dir <dir>', 'directory to check out team repos into', '.c4-checkouts')
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .option('--concurrency <n>', 'bounded concurrency for validation (default: same as match concurrency)', (v) => Number(v))
  .option('--json', 'print machine-readable JSON results to stdout instead of a human summary', false)
  .action(async (opts) => {
    const teams = await loadRoster(opts.roster);
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);
    const concurrency = opts.concurrency ?? matchConcurrency(os.cpus().length);

    // Same prepare path run-tournament uses (TASK 1: checkout once, build
    // once via provider.prepare) — `validate` wants "whatever is on the
    // branch right now" (DESIGN.md's "pull all"), so this deliberately
    // omits `lock`, which resolves each team's current default-branch
    // commit implicitly, exactly like the old checkoutRepo("latest") path
    // did. The build failure/startup-timeout surfaces here exactly as it
    // would during freeze/prepare for a real tournament run, and a
    // successful prepare leaves the image cached for the smoke /move test
    // below to reuse (no second build).
    const prepared = await prepareTeams(teams, {
      provider,
      workDir,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
      concurrency,
    });

    const results = await validateAllBounded(prepared, {
      provider,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
    }, concurrency);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      let failures = 0;
      for (const r of results) {
        console.error(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.team}: ${r.detail}`);
        if (!r.ok) failures++;
      }
      if (failures > 0) {
        console.error(`${failures}/${results.length} teams failed validation.`);
      }
    }
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  });

/** `validate --json` shape per EVENT_PLAN.md: `[{ team, repo_url, commit, ok, stage, detail, ms }]`. Wraps validate.ts's ValidateTeamResult (which is keyed on the internal Team, not this wire shape) with bounded concurrency and timing. */
interface ValidateJsonResult {
  team: string;
  repo_url: string;
  commit: string | null;
  ok: boolean;
  stage: 'checkout' | 'build' | 'health' | 'smoke';
  detail: string;
  ms: number;
}

/** Maps a prepare.ts forfeit reason onto validate --json's `stage` vocabulary. */
function stageForForfeit(reason: MatchForfeitReason): ValidateJsonResult['stage'] {
  if (reason === 'checkout_failed') return 'checkout';
  if (reason === 'startup_timeout') return 'health';
  return 'build'; // build_failed
}

interface ValidateBoundedOptions {
  provider: DockerBotProvider;
  botPort?: number;
  healthGraceMs?: number;
}

/**
 * Turns a prepare.ts sweep (checkout + build-once, already run by the
 * caller) into validate --json's per-team results: a prepared team that's
 * already known broken is reported without touching Docker again; a
 * healthy one gets one additional smoke /move, which reuses the image
 * `prepareTeams` just built via `provider.prepare` (see DockerBotProvider)
 * instead of building a second time.
 */
async function validateAllBounded(
  prepared: PreparedTeam[],
  options: ValidateBoundedOptions,
  concurrency: number,
): Promise<ValidateJsonResult[]> {
  const { provider, botPort = 8000, healthGraceMs = 30_000 } = options;
  const { runWithConcurrency } = await import('./scheduler.js');

  const jobs = prepared.map((p) => async (): Promise<ValidateJsonResult> => {
    const start = Date.now();
    const base = { team: p.team.name, repo_url: p.team.repoUrl, commit: p.commit ?? null };

    if (p.forfeit) {
      return { ...base, ok: false, stage: stageForForfeit(p.forfeit), detail: p.detail ?? p.forfeit, ms: Date.now() - start };
    }

    const result = await validateTeam(p.team, {
      provider,
      resolveRepoDir: () => p.repoDir!,
      botPort,
      healthGraceMs,
    });
    return { ...base, ok: result.ok, stage: 'smoke', detail: result.detail, ms: Date.now() - start };
  });
  return runWithConcurrency(jobs, Math.max(1, concurrency));
}

program
  .command('run-match')
  .description('Run a single match between two teams (for testing templates / debugging)')
  .requiredOption('--team-a-name <name>')
  .requiredOption('--team-a-repo <url>')
  .requiredOption('--team-b-name <name>')
  .requiredOption('--team-b-repo <url>')
  .requiredOption('--output <dir>', 'directory to write the game-record JSON file')
  .option('--work-dir <dir>', 'directory to check out team repos into', '.c4-checkouts')
  .option('--seed <n>', 'RNG seed for coin flips', (v) => Number(v))
  .option('--think-ms <n>', 'per-player, per-game think budget in ms', (v) => Number(v), THINK_BUDGET_MS)
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .action(async (opts) => {
    const teamA: Team = { name: opts.teamAName, repoUrl: opts.teamARepo };
    const teamB: Team = { name: opts.teamBName, repoUrl: opts.teamBRepo };
    const rng = createSeededRng(opts.seed ?? defaultSeed());
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);

    // A single ad hoc match still resolves + checks out each repo exactly
    // once (no lock/freeze needed for a one-off debugging run): resolve
    // the current default-branch commit implicitly, then check it out.
    const { resolveDefaultBranchCommit } = await import('./git.js');
    const [repoDirA, repoDirB] = await Promise.all([
      resolveDefaultBranchCommit(teamA.repoUrl).then((commit) => checkoutRepoAtCommit(teamA, commit, workDir)),
      resolveDefaultBranchCommit(teamB.repoUrl).then((commit) => checkoutRepoAtCommit(teamB, commit, workDir)),
    ]);

    const record = await orchestrateMatch({
      matchId: `match-${Date.now()}`,
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: [repoDirA, repoDirB],
      provider,
      rng,
      thinkBudgetMs: opts.thinkMs,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
    });

    const filePath = await writeMatchRecord(opts.output, record);
    console.log(`Wrote ${filePath}`);
    if (record.result.winner_team === null) {
      console.log('Double forfeit: no winner.');
    } else {
      console.log(`Winner: ${record.teams[record.result.winner_team].name} (${record.result.games_won.join('-')})`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
