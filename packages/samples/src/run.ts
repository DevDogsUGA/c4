// Orchestrates the full sample pipeline: materialize -> roster -> engine
// freeze + run-tournament -> validate every record against the contract
// schemas -> check each sample's expectation actually occurred -> check
// fail-state coverage -> write the bundle + provenance.
//
// The engine phases go through an injected EngineCli so this logic is
// unit-testable with a fake before the real `c4 freeze` / `run-tournament
// --lock --bundle` flags exist (A1a, not yet on this branch).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TournamentBundleSchema, THINK_BUDGET_MS, type TournamentBundle } from '@acm-uga/c4-contract';
import { listSampleSlugs, materializeSample, type MaterializedSample } from './materialize.js';
import { resolveTemplateSource, type TemplateSourceOptions } from './template-source.js';
import { buildRoster } from './roster.js';
import type { EngineCli } from './engine-cli.js';
import { checkExpectations, checkFailStateCoverage, formatTable, type ExpectationCheck, type CoverageCheck } from './expectations.js';
import { buildProvenance, Stopwatch } from './provenance.js';

export interface RunSamplesOptions {
  samplesRoot: string;
  workDir: string;
  outDir: string;
  engineCli: EngineCli;
  templateSourceOpts: TemplateSourceOptions;
  /** Only materialize/run these slugs. */
  only?: string[];
  /** Fast loop: first 4 samples only. */
  quick?: boolean;
  /** Duplicate samples (suffixed) to reach N teams, e.g. for the 32-team dress rehearsal. */
  teams?: number;
  seed?: number;
  thinkMs?: number;
}

export interface RunSamplesResult {
  ok: boolean;
  bundle: TournamentBundle;
  expectationChecks: ExpectationCheck[];
  coverageChecks: CoverageCheck[];
  skipped: MaterializedSample[];
  timings: ReturnType<Stopwatch['report']>;
}

export async function runSamples(opts: RunSamplesOptions): Promise<RunSamplesResult> {
  const sw = new Stopwatch();

  const templateSource = await sw.time('resolve-template', () => resolveTemplateSource(opts.templateSourceOpts));

  let slugs = await sw.time('list-samples', () => listSampleSlugs(opts.samplesRoot));
  if (opts.only && opts.only.length > 0) {
    const onlySet = new Set(opts.only);
    slugs = slugs.filter((s) => onlySet.has(s));
  } else if (opts.quick) {
    slugs = slugs.slice(0, 4);
  }
  if (slugs.length === 0) {
    throw new Error('runSamples: no samples selected (check --only / samples/ contents)');
  }

  const materialized = await sw.time('materialize', async () => {
    const out: MaterializedSample[] = [];
    for (const slug of slugs) {
      out.push(await materializeSample({ samplesRoot: opts.samplesRoot, slug, templateSource, workDir: opts.workDir }));
    }
    return out;
  });

  // Tier-3 resource-abuse samples are built but never executed outside the
  // hardened engine (see SAMPLES.md / EVENT_PLAN.md safety note).
  const runnable = materialized.filter((m) => !m.sample.requiresHardenedEngine);
  const skipped = materialized.filter((m) => m.sample.requiresHardenedEngine);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} tier-3 sample(s) pending hardened engine: ${skipped.map((s) => s.slug).join(', ')}`);
  }
  if (runnable.length === 0) {
    throw new Error('runSamples: every selected sample requires the hardened engine; nothing left to run');
  }

  await mkdir(opts.outDir, { recursive: true });
  const rosterPath = path.join(opts.outDir, 'roster.json');
  const roster = buildRoster(runnable, opts.teams);
  await writeFile(rosterPath, JSON.stringify(roster, null, 2));

  const lockPath = path.join(opts.outDir, 'lock.json');
  const bundlePath = path.join(opts.outDir, 'bundle.json');
  const thinkMs = opts.thinkMs ?? THINK_BUDGET_MS;

  await sw.time('freeze', () => opts.engineCli.freeze({ rosterPath, lockPath }));
  await sw.time('run-tournament', () =>
    opts.engineCli.runTournament({ rosterPath, lockPath, outputDir: opts.outDir, bundlePath, seed: opts.seed, thinkMs }),
  );

  const bundle = await sw.time('validate-bundle', async () => {
    const raw = await readFile(bundlePath, 'utf8');
    return TournamentBundleSchema.parse(JSON.parse(raw));
  });

  const expectationChecks = checkExpectations(runnable, bundle);
  const coverageChecks = checkFailStateCoverage(bundle);

  const provenance = buildProvenance({
    templateSource,
    templateRepo: opts.templateSourceOpts.templateRepo ?? 'https://github.com/DevDogsUGA/c4-hackathon.git',
    materialized,
    seed: opts.seed,
    thinkMs,
    teamsRequested: opts.teams,
    timings: sw.report(),
  });
  await writeFile(path.join(opts.outDir, 'provenance.json'), JSON.stringify(provenance, null, 2));

  sw.print();

  const ok = expectationChecks.every((c) => c.ok) && coverageChecks.every((c) => c.ok);
  if (!ok) {
    console.error('\nExpectation failures:\n' + formatTable(expectationChecks.filter((c) => !c.ok)));
    console.error('\nFail-state coverage:');
    for (const c of coverageChecks) {
      console.error(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
    }
  } else {
    console.log('\nAll sample expectations and fail-state coverage checks passed.');
  }

  return { ok, bundle, expectationChecks, coverageChecks, skipped, timings: sw.report() };
}
