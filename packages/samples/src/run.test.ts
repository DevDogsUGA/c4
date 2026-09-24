import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runSamples } from './run.js';
import type { EngineCli, FreezeOptions, RunTournamentOptions } from './engine-cli.js';
import { TEMPLATES } from './templates.js';
import type { TournamentBundle } from '@acm-uga/c4-contract';

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function buildFakeTemplateRepo(root: string): Promise<void> {
  for (const [template, botFile] of Object.entries(TEMPLATES)) {
    const dir = path.join(root, 'templates', template, path.dirname(botFile));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'templates', template, botFile), `// ${template}\n`);
  }
  await run('git', ['init', '-q'], root);
  await run('git', ['config', 'user.email', 'test@c4.local'], root);
  await run('git', ['config', 'user.name', 'test'], root);
  await run('git', ['add', '-A'], root);
  await run('git', ['commit', '-q', '-m', 'templates'], root);
}

/** A fake EngineCli that writes a plausible bundle covering every fail state. */
class FakeEngineCli implements EngineCli {
  async freeze(_opts: FreezeOptions): Promise<void> {}

  async runTournament(opts: RunTournamentOptions): Promise<void> {
    const roster = JSON.parse(await readFile(opts.rosterPath, 'utf8'));
    const teams = roster.teams as Array<{ team_name: string; repo_url: string }>;
    const byName = (name: string) => {
      const t = teams.find((x) => x.team_name === name);
      if (!t) throw new Error(`fixture bug: no roster team named ${name}`);
      return { name: t.team_name, repo_url: t.repo_url };
    };
    const team = (i: number) => byName(['BuildBroken', 'CheckoutBroken', 'Slow', 'Crashy'][i]);

    const bundle: TournamentBundle = {
      format: 'c4-tournament-bundle',
      version: 1,
      summary: { standings: [], bracket: [], generated_at: new Date().toISOString() },
      matches: [
        {
          match_id: 'm1',
          phase: 'roundrobin',
          teams: [team(2), team(3)],
          games: [
            {
              game_number: 1,
              first_player: 1,
              first_player_team: 0,
              coin_flip: true,
              moves: [],
              clock_events: [
                { type: 'restart', player: 1, billed_ms: 500, at_move: 2 },
                { type: 'forfeit', player: 1, reason: 'clock_expired', at_move: 5 },
              ],
              outcome: { type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'clock_expired' },
            },
            {
              game_number: 2,
              first_player: 2,
              first_player_team: 1,
              coin_flip: false,
              moves: [],
              clock_events: [{ type: 'forfeit', player: 2, reason: 'invalid_move', at_move: 1 }],
              outcome: { type: 'forfeit', winner: 1, forfeited_player: 2, reason: 'invalid_move' },
            },
            {
              game_number: 3,
              first_player: 1,
              first_player_team: 0,
              coin_flip: true,
              moves: [],
              clock_events: [{ type: 'forfeit', player: 1, reason: 'crash_loop', at_move: 0 }],
              outcome: { type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'crash_loop' },
            },
            { game_number: 4, first_player: 2, first_player_team: 1, coin_flip: false, moves: [], clock_events: [], outcome: { type: 'draw' } },
          ],
          result: { winner_team: 1, games_won: [1, 2], reason: 'played' },
        },
        {
          match_id: 'm2',
          phase: 'roundrobin',
          teams: [team(2), team(3)],
          games: [],
          result: { winner_team: 0, games_won: [0, 0], reason: 'forfeit', forfeits: [{ team: 1, reason: 'startup_timeout' }] },
        },
        {
          match_id: 'm3',
          phase: 'roundrobin',
          teams: [team(3), team(0)],
          games: [],
          result: { winner_team: 0, games_won: [0, 0], reason: 'forfeit', forfeits: [{ team: 1, reason: 'build_failed' }] },
        },
        {
          match_id: 'm4',
          phase: 'roundrobin',
          teams: [team(1), team(3)],
          games: [],
          result: {
            winner_team: null,
            games_won: [0, 0],
            reason: 'forfeit',
            forfeits: [
              { team: 0, reason: 'checkout_failed' },
              { team: 1, reason: 'checkout_failed' },
            ],
          },
        },
      ],
    };
    await mkdir(opts.outputDir, { recursive: true });
    await writeFile(opts.bundlePath, JSON.stringify(bundle, null, 2));
  }
}

describe('runSamples (fake engine)', () => {
  let repoDir: string;
  let samplesRoot: string;
  let workDir: string;
  let outDir: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), 'c4-run-fake-repo-'));
    await buildFakeTemplateRepo(repoDir);
    samplesRoot = await mkdtemp(path.join(tmpdir(), 'c4-run-samples-'));
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-run-work-'));
    outDir = await mkdtemp(path.join(tmpdir(), 'c4-run-out-'));

    const write = async (slug: string, sample: object) => {
      const dir = path.join(samplesRoot, slug);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'sample.json'), JSON.stringify(sample));
    };
    await write('slow', { name: 'Slow', template: 'python', expect: { kind: 'game_forfeit', reason: 'clock_expired' } });
    await write('crashy', { name: 'Crashy', template: 'python', expect: { kind: 'game_forfeit', reason: 'invalid_move' } });
    await write('build-broken', { name: 'BuildBroken', template: 'python', expect: { kind: 'build_failed' } });
    await write('checkout-broken', { name: 'CheckoutBroken', template: 'python', expect: { kind: 'checkout_failed' } });
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(samplesRoot, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  it('runs materialize -> roster -> fake engine -> validate -> expectations -> provenance', async () => {
    const result = await runSamples({
      samplesRoot,
      workDir,
      outDir,
      engineCli: new FakeEngineCli(),
      templateSourceOpts: { templateRepo: repoDir, allowUnpublished: true, templateRef: 'HEAD' },
      seed: 1,
      thinkMs: 1000,
    });

    expect(result.bundle.matches.length).toBe(4);
    expect(result.coverageChecks.every((c) => c.ok)).toBe(true);
    expect(result.expectationChecks.length).toBe(4);
    expect(result.ok).toBe(true);

    const provenance = JSON.parse(await readFile(path.join(outDir, 'provenance.json'), 'utf8'));
    expect(provenance.template_commit_sha).toBeTruthy();
    expect(provenance.samples.length).toBe(4);

    const roster = JSON.parse(await readFile(path.join(outDir, 'roster.json'), 'utf8'));
    expect(roster.teams.length).toBe(4);
    expect(roster.teams[0].repo_url.startsWith('file://')).toBe(true);
  });

  it('--only filters to a subset', async () => {
    const result = await runSamples({
      samplesRoot,
      workDir,
      outDir: path.join(outDir, 'only'),
      engineCli: new FakeEngineCli(),
      templateSourceOpts: { templateRepo: repoDir, allowUnpublished: true, templateRef: 'HEAD' },
      only: ['slow', 'crashy', 'build-broken', 'checkout-broken'],
    });
    expect(result.bundle.matches.length).toBe(4);
  });
});
