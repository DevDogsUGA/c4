#!/usr/bin/env node
// `pnpm -C packages/samples fixtures|rehearsal|run`

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runSamples } from './run.js';
import { RealEngineCli } from './engine-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const program = new Command();
program.name('c4-samples').description('Materialize + run the private sample bots through the real match engine');

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--samples-root <dir>', 'directory of samples/<slug>', path.join(repoRoot, 'samples'))
    .option('--work-dir <dir>', 'gitignored materialize work dir', path.join(repoRoot, '.c4-samples-work'))
    .option('--out <dir>', 'output dir for roster/lock/bundle/provenance', path.join(repoRoot, '.c4-samples-out'))
    .option('--template-repo <urlOrPath>', 'override the public templates repo (URL, or local path with --allow-unpublished)')
    .option('--template-ref <ref>', 'template ref to resolve', 'origin/main')
    .option('--allow-unpublished', 'skip the pin-to-origin/main check; local template dev only', false)
    .option('--only <slugs>', 'comma-separated sample slugs to run', (v) => v.split(',').map((s) => s.trim()))
    .option('--quick', 'fast loop: first 4 samples only', false)
    .option('--teams <n>', 'duplicate samples to reach N teams', (v) => Number(v))
    .option('--seed <n>', 'engine RNG seed', (v) => Number(v))
    .option('--think-ms <n>', 'per-player, per-game think budget in ms', (v) => Number(v), 5000)
    .option('--concurrency <n>', 'max matches run in parallel (forwarded to the engine)', (v) => Number(v))
    .option('--engine-cli <path>', 'path to the match-engine CLI bin', path.join(repoRoot, 'apps/match-engine/dist/cli.js'));
}

async function runAction(opts: Record<string, unknown>): Promise<void> {
  const engineCli = new RealEngineCli(opts.engineCli as string, repoRoot);
  const result = await runSamples({
    samplesRoot: opts.samplesRoot as string,
    workDir: opts.workDir as string,
    outDir: opts.out as string,
    engineCli,
    templateSourceOpts: {
      templateRepo: opts.templateRepo as string | undefined,
      templateRef: opts.templateRef as string,
      allowUnpublished: opts.allowUnpublished as boolean,
    },
    only: opts.only as string[] | undefined,
    quick: opts.quick as boolean,
    teams: opts.teams as number | undefined,
    seed: opts.seed as number | undefined,
    thinkMs: opts.thinkMs as number,
    concurrency: opts.concurrency as number | undefined,
  });

  if (!result.ok) {
    process.exitCode = 1;
  }
}

addCommonOptions(program.command('fixtures').description('Full run: every sample, contract-valid bundle + provenance')).action(runAction);
addCommonOptions(program.command('rehearsal').description('Alias of fixtures, for the presenter dress rehearsal')).action(runAction);
addCommonOptions(program.command('run').description('Alias of fixtures')).action(runAction);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
