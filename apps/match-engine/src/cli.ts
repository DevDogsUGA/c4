#!/usr/bin/env node
// Headless CLI per IMPLEMENTATION_PLAN.md: `c4 run-tournament`, `c4
// validate`, `c4 run-match`.

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import Docker from 'dockerode';
import { DockerContainerRuntime } from './docker/container-runtime.js';
import { DockerBotProvider } from './docker/docker-bot-provider.js';
import { checkoutRepo } from './git.js';
import { orchestrateMatch } from './match-orchestrator.js';
import { createSeededRng } from './rng.js';
import { parseRosterCsv } from './roster.js';
import { matchConcurrency } from './scheduler.js';
import { runTournament } from './tournament-runner.js';
import type { Team } from './types.js';
import { validateAll } from './validate.js';
import { writeMatchRecord } from './output.js';

const program = new Command();
program.name('c4').description('Connect Four hackathon match engine').version('1.0.0');

function makeProvider(): DockerBotProvider {
  return new DockerBotProvider(new DockerContainerRuntime(new Docker()));
}

async function loadRoster(rosterPath: string): Promise<Team[]> {
  const text = await readFile(rosterPath, 'utf8');
  return parseRosterCsv(text);
}

function defaultSeed(): number {
  return Date.now() >>> 0;
}

program
  .command('run-tournament')
  .description('Run the full round-robin + bracket tournament from a roster CSV, emitting game records + a summary')
  .requiredOption('--roster <path>', 'CSV of team name,repo url (Google Form export)')
  .requiredOption('--output <dir>', 'directory to write game-record JSON files + tournament-summary.json')
  .option('--work-dir <dir>', 'directory to check out team repos into', '.c4-checkouts')
  .option('--seed <n>', 'RNG seed for coin flips (deterministic if set)', (v) => Number(v))
  .option('--think-ms <n>', 'per-player, per-game think budget in ms', (v) => Number(v), 10_000)
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .option('--min-bracket-slots <n>', 'minimum single-elimination bracket size', (v) => Number(v), 16)
  .option('--concurrency <n>', 'max matches run in parallel (default: host-sized)', (v) => Number(v))
  .action(async (opts) => {
    const teams = await loadRoster(opts.roster);
    const rng = createSeededRng(opts.seed ?? defaultSeed());
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);

    const result = await runTournament({
      teams,
      outputDir: opts.output,
      provider,
      rng,
      resolveRepoDir: (team) => checkoutRepo(team, workDir),
      concurrency: opts.concurrency ?? matchConcurrency(os.cpus().length),
      thinkBudgetMs: opts.thinkMs,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
      minBracketSlots: opts.minBracketSlots,
    });

    console.log(`Played ${result.matches.length} matches. Standings:`);
    for (const entry of result.summary.standings) {
      console.log(`  ${entry.rank}. ${entry.team.name} (${entry.match_wins}-${entry.match_losses} matches)`);
    }
  });

program
  .command('validate')
  .description('Pull all -> build -> smoke game for every team in the roster; reports readiness')
  .requiredOption('--roster <path>', 'CSV of team name,repo url')
  .option('--work-dir <dir>', 'directory to check out team repos into', '.c4-checkouts')
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .action(async (opts) => {
    const teams = await loadRoster(opts.roster);
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);

    const results = await validateAll(teams, {
      provider,
      resolveRepoDir: (team) => checkoutRepo(team, workDir),
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
    });

    let failures = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.team.name}: ${r.detail}`);
      if (!r.ok) failures++;
    }
    if (failures > 0) {
      console.error(`${failures}/${results.length} teams failed validation.`);
      process.exitCode = 1;
    }
  });

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
  .option('--think-ms <n>', 'per-player, per-game think budget in ms', (v) => Number(v), 10_000)
  .option('--port <n>', 'container port the bot listens on', (v) => Number(v), 8000)
  .option('--health-grace-ms <n>', 'off-clock startup health-check grace', (v) => Number(v), 30_000)
  .action(async (opts) => {
    const teamA: Team = { name: opts.teamAName, repoUrl: opts.teamARepo };
    const teamB: Team = { name: opts.teamBName, repoUrl: opts.teamBRepo };
    const rng = createSeededRng(opts.seed ?? defaultSeed());
    const provider = makeProvider();
    const workDir = path.resolve(opts.workDir);

    const record = await orchestrateMatch({
      matchId: `match-${Date.now()}`,
      phase: 'roundrobin',
      teams: [teamA, teamB],
      repoDirs: [await checkoutRepo(teamA, workDir), await checkoutRepo(teamB, workDir)],
      provider,
      rng,
      thinkBudgetMs: opts.thinkMs,
      botPort: opts.port,
      healthGraceMs: opts.healthGraceMs,
    });

    const filePath = await writeMatchRecord(opts.output, record);
    console.log(`Wrote ${filePath}`);
    console.log(`Winner: ${record.teams[record.result.winner_team].name} (${record.result.games_won.join('-')})`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
