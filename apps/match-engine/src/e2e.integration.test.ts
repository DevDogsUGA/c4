// TASK 2: a full, real end-to-end acceptance run through the CLI + real
// Docker — the first place the whole pipeline (freeze -> validate ->
// run-tournament) is exercised together against real git repos and real
// container builds, rather than fakes. Skipped by default; run with:
//
//   C4_DOCKER_TESTS=1 npx vitest run src/e2e.integration.test.ts
//
// or as part of the full gated suite:
//
//   C4_DOCKER_TESTS=1 pnpm -C apps/match-engine test
//
// Builds 5 throwaway local git repos (file:// remotes) from the REAL
// starter templates in the sibling c4-hackathon repo (via `git archive`,
// never the working tree directly, per the task brief), patches two of
// them to exercise specific failure modes, adds a 6th roster entry
// pointing at a repo that doesn't exist, then drives the built CLI
// (dist/cli.js) exactly as an organizer would: `c4 freeze`, `c4 validate
// --json`, `c4 run-tournament --lock ... --bundle ...`.
//
// Requires: a working Docker daemon, and the sibling
// /home/sloan/code/acm-uga/c4-hackathon checkout this environment ships
// with (skipped if it isn't present, so this doesn't break the suite in a
// different environment).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TournamentBundleSchema, type TournamentBundle } from '@acm-uga/c4-contract';

const execFileAsync = promisify(execFile);

const RUN_DOCKER_TESTS = process.env.C4_DOCKER_TESTS === '1';
const HACKATHON_REPO = '/home/sloan/code/acm-uga/c4-hackathon';
const HAS_HACKATHON_REPO = existsSync(path.join(HACKATHON_REPO, 'templates'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(PACKAGE_ROOT, 'dist', 'cli.js');

const docker = new Docker();

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Labels everything this test's CLI runs create (c4.run=<RUN_ID>), so leak checks ignore other users of a shared daemon. */
const RUN_ID = `e2e-${process.pid}-${Date.now()}`;

/** Runs a `c4` CLI subcommand as a real child process, exactly like an organizer would. Never throws on a non-zero exit — `freeze`/`validate` are expected to exit 1 when the roster has broken teams. */
async function runCli(args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, C4_RUN_ID: RUN_ID },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** `git -C <hackathon repo> archive HEAD templates/<lang>` -> extracted into `destDir` (the template's own subdirectory contents land directly in destDir), per the task brief: never read the hackathon repo's working tree directly. */
async function extractTemplate(lang: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const tarPath = path.join(destDir, '..', `${lang}.tar`);
  const { stdout } = await execFileAsync(
    'git',
    ['-C', HACKATHON_REPO, 'archive', '--format=tar', 'HEAD', `templates/${lang}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  await writeFile(tarPath, stdout);
  // The archive's paths are rooted at `templates/<lang>/...`; strip that
  // prefix so destDir ends up containing the template's files directly
  // (Dockerfile at destDir/Dockerfile, matching a real submission repo).
  await execFileAsync('tar', ['-xf', tarPath, '-C', destDir, '--strip-components=2']);
  await rm(tarPath, { force: true });
}

async function gitInitCommit(dir: string, message: string): Promise<string> {
  await execFileAsync('git', ['init', '-q', '-b', 'main', dir]);
  await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'hello@sloanfinger.com']);
  await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'c4 e2e test']);
  await execFileAsync('git', ['-C', dir, 'add', '-A']);
  await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', message]);
  const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

/** Patches the node template's bot.js to busy-wait 6s on its first move — past the 5s think budget, so the game forfeits with `clock_expired`. Must stay synchronous: the template's server.js calls `chooseMove` and uses its return value directly, not a promise. */
async function patchSlowNodeBot(dir: string): Promise<void> {
  const botPath = path.join(dir, 'bot.js');
  const original = await readFile(botPath, 'utf8');
  const patched = original.replace(
    'function chooseMove(board, you, info) {',
    `function chooseMove(board, you, info) {
  // c4-e2e fixture: sleep past the 5s clock budget on the first move.
  if ((info.moves || []).length === 0) {
    const until = Date.now() + 6000;
    while (Date.now() < until) { /* busy-wait: chooseMove must stay synchronous */ }
  }`,
  );
  expect(patched).not.toBe(original); // fail loudly if the template's chooseMove signature ever changes
  await writeFile(botPath, patched, 'utf8');
}

/** Patches the C template's bot.c with a deliberate compile error, to exercise `build_failed`. */
async function patchBrokenCBot(dir: string): Promise<void> {
  const botPath = path.join(dir, 'bot.c');
  const original = await readFile(botPath, 'utf8');
  const patched = original.replace(
    'int n = legal_moves(board, moves);',
    'int n = legal_moves(board, moves);\n    this_identifier_does_not_exist syntax error here',
  );
  expect(patched).not.toBe(original);
  await writeFile(botPath, patched, 'utf8');
}

interface Fixture {
  workDir: string;
  rosterPath: string;
  lockPath: string;
  outputDir: string;
  bundlePath: string;
  checkoutsDir: string;
  teamRepoUrl: Record<string, string>;
}

async function buildFixture(): Promise<Fixture> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'c4-e2e-'));
  const teamsDir = path.join(workDir, 'teams');
  await mkdir(teamsDir, { recursive: true });

  const teamDirs: Record<string, string> = {
    python: path.join(teamsDir, 'team-python'),
    go: path.join(teamsDir, 'team-go'),
    rust: path.join(teamsDir, 'team-rust'),
    'slow-node': path.join(teamsDir, 'team-slow-node'),
    'broken-c': path.join(teamsDir, 'team-broken-c'),
  };

  await Promise.all([
    extractTemplate('python', teamDirs.python),
    extractTemplate('go', teamDirs.go),
    extractTemplate('rust', teamDirs.rust),
    extractTemplate('node', teamDirs['slow-node']),
    extractTemplate('c', teamDirs['broken-c']),
  ]);

  await patchSlowNodeBot(teamDirs['slow-node']);
  await patchBrokenCBot(teamDirs['broken-c']);

  for (const dir of Object.values(teamDirs)) {
    await gitInitCommit(dir, 'c4-e2e fixture');
  }

  const teamRepoUrl: Record<string, string> = {
    Pythonic: `file://${teamDirs.python}`,
    Gopher: `file://${teamDirs.go}`,
    Rustacean: `file://${teamDirs.rust}`,
    Sleepy: `file://${teamDirs['slow-node']}`,
    Segfault: `file://${teamDirs['broken-c']}`,
    Ghost: `file://${path.join(teamsDir, 'does-not-exist')}`,
  };

  const roster = {
    teams: [
      { id: 't-python', team_name: 'Pythonic Pieces', repo_url: teamRepoUrl.Pythonic, members: ['Ada', 'Grace'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
      { id: 't-go', team_name: 'Gopher Squad', repo_url: teamRepoUrl.Gopher, members: ['Rob', 'Ken'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
      { id: 't-rust', team_name: 'Rustaceans', repo_url: teamRepoUrl.Rustacean, members: ['Ferris'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
      { id: 't-slow-node', team_name: 'Sleepy Node', repo_url: teamRepoUrl.Sleepy, members: ['Ryan', 'Dahl'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
      { id: 't-broken-c', team_name: 'Segfault Squad', repo_url: teamRepoUrl.Segfault, members: ['Dennis'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
      { id: 't-missing', team_name: 'Ghost Team', repo_url: teamRepoUrl.Ghost, members: ['Nobody'], submitter_email: 'hello@sloanfinger.com', updated_at: '2026-09-24T00:00:00.000Z' },
    ],
  };

  const rosterPath = path.join(workDir, 'roster.json');
  await writeFile(rosterPath, JSON.stringify(roster, null, 2), 'utf8');

  return {
    workDir,
    rosterPath,
    lockPath: path.join(workDir, 'lock.json'),
    outputDir: path.join(workDir, 'out'),
    bundlePath: path.join(workDir, 'out', 'bundle.json'),
    checkoutsDir: path.join(workDir, 'checkouts'),
    teamRepoUrl,
  };
}

describe.skipIf(!RUN_DOCKER_TESTS || !HAS_HACKATHON_REPO)('c4 CLI end-to-end acceptance run (real Docker + real git)', () => {
  let fixture: Fixture;
  let imageLabelsBefore: Set<string>;
  let containerIdsBefore: Set<string>;
  let networkIdsBefore: Set<string>;

  beforeAll(async () => {
    if (!RUN_DOCKER_TESTS || !HAS_HACKATHON_REPO) return;
    // Build dist/cli.js fresh so this test exercises exactly what `node
    // apps/match-engine/dist/cli.js ...` runs, not stale output.
    await execFileAsync('pnpm', ['build'], { cwd: PACKAGE_ROOT, timeout: 120_000 });
    fixture = await buildFixture();
    const images = await docker.listImages({ filters: JSON.stringify({ label: ['c4.arena=1'] }) });
    imageLabelsBefore = new Set(images.flatMap((i) => i.RepoTags ?? []));
    // Baseline snapshot for the "nothing new leaked" check below: a shared
    // Docker daemon may have other agents'/tests' own c4.arena=1 containers
    // or networks already running concurrently, so "leftovers from THIS
    // test" is defined as IDs that appear after the run but not before.
    const containers = await docker.listContainers({ all: true, filters: JSON.stringify({ label: ['c4.arena=1'] }) });
    containerIdsBefore = new Set(containers.map((c) => c.Id));
    const networks = await docker.listNetworks({ filters: JSON.stringify({ label: ['c4.arena=1'] }) });
    networkIdsBefore = new Set(networks.map((n) => n.Id));
  }, 180_000);

  afterAll(async () => {
    if (fixture) await rm(fixture.workDir, { recursive: true, force: true });
  });

  it(
    'freeze -> validate --json -> run-tournament runs the whole pipeline for real and produces a valid bundle',
    async () => {
      const timings: Record<string, number> = {};

      // ---- freeze ---------------------------------------------------------
      let t0 = Date.now();
      const freezeResult = await runCli(['freeze', '--roster', fixture.rosterPath, '--output', fixture.lockPath]);
      timings.freeze_ms = Date.now() - t0;
      // Ghost Team can't resolve -> freeze exits 1, but still writes a lock
      // file recording every OTHER team's commit (one broken submission
      // never aborts the freeze sweep).
      expect(freezeResult.code).toBe(1);
      expect(freezeResult.stdout).toContain('6 teams, 1 unresolved');

      // ---- validate --json --------------------------------------------------
      t0 = Date.now();
      const validateResult = await runCli([
        'validate',
        '--roster',
        fixture.rosterPath,
        '--json',
        '--work-dir',
        path.join(fixture.checkoutsDir, 'validate'),
      ]);
      timings.validate_ms = Date.now() - t0;
      expect(validateResult.code).toBe(1); // some teams are deliberately broken
      const validateJson = JSON.parse(validateResult.stdout) as Array<{
        team: string;
        ok: boolean;
        stage: string;
        detail: string;
      }>;
      expect(validateJson).toHaveLength(6);
      const byTeam = Object.fromEntries(validateJson.map((r) => [r.team, r]));
      expect(byTeam['Pythonic Pieces'].ok).toBe(true);
      expect(byTeam['Gopher Squad'].ok).toBe(true);
      expect(byTeam['Rustaceans'].ok).toBe(true);
      expect(byTeam['Sleepy Node'].ok).toBe(false); // clock budget blown on the smoke move
      expect(byTeam['Segfault Squad'].ok).toBe(false);
      expect(byTeam['Segfault Squad'].stage).toBe('build');
      expect(byTeam['Ghost Team'].ok).toBe(false);
      expect(byTeam['Ghost Team'].stage).toBe('checkout');

      // ---- run-tournament -----------------------------------------------
      t0 = Date.now();
      const runResult = await runCli([
        'run-tournament',
        '--roster',
        fixture.rosterPath,
        '--lock',
        fixture.lockPath,
        '--output',
        fixture.outputDir,
        '--bundle',
        fixture.bundlePath,
        '--seed',
        '1',
        '--work-dir',
        path.join(fixture.checkoutsDir, 'run'),
      ]);
      timings.run_tournament_ms = Date.now() - t0;
      timings.total_ms = timings.freeze_ms + timings.validate_ms + timings.run_tournament_ms;
      console.error(`[c4 e2e] wall time: freeze=${timings.freeze_ms}ms validate=${timings.validate_ms}ms run-tournament=${timings.run_tournament_ms}ms total=${timings.total_ms}ms`);

      // The run completes cleanly — no abort — despite two entirely broken teams.
      expect(runResult.code).toBe(0);
      expect(runResult.stderr).toContain('BROKEN  Segfault Squad: build_failed');
      expect(runResult.stderr).toContain('BROKEN  Ghost Team: checkout_failed');

      // Stays well inside the ~5 minute budget this test is meant to fit in.
      expect(timings.total_ms).toBeLessThan(4 * 60_000);

      // ---- bundle validates against the shared contract schema ---------
      const bundleRaw = await readFile(fixture.bundlePath, 'utf8');
      const bundle = JSON.parse(bundleRaw) as TournamentBundle;
      const parsed = TournamentBundleSchema.safeParse(bundle);
      expect(parsed.success, parsed.success ? '' : JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);

      // ---- languages + members carried through TeamRefs ------------------
      const teamByName = Object.fromEntries(bundle.summary.standings.map((s) => [s.team.name, s.team]));
      expect(teamByName['Pythonic Pieces'].language).toBe('python');
      expect(teamByName['Gopher Squad'].language).toBe('go');
      expect(teamByName['Rustaceans'].language).toBe('rust');
      expect(teamByName['Sleepy Node'].language).toBe('node');
      expect(teamByName['Segfault Squad'].language).toBe('c'); // detected before the build step ever ran
      expect(teamByName['Pythonic Pieces'].members).toEqual(['Ada', 'Grace']);
      expect(teamByName['Ghost Team'].members).toEqual(['Nobody']);

      // ---- forfeit reasons -------------------------------------------------
      const forfeitMatches = bundle.matches.filter((m) => m.result.reason === 'forfeit');
      expect(forfeitMatches.length).toBeGreaterThan(0);

      const buildFailed = forfeitMatches.filter((m) => m.result.forfeits?.some((f) => f.reason === 'build_failed'));
      expect(buildFailed.length).toBeGreaterThan(0);
      for (const m of buildFailed) {
        const forfeitedSlot = m.result.forfeits!.find((f) => f.reason === 'build_failed')!.team;
        expect(m.teams[forfeitedSlot].name).toBe('Segfault Squad');
      }

      const checkoutFailed = forfeitMatches.filter((m) => m.result.forfeits?.some((f) => f.reason === 'checkout_failed'));
      expect(checkoutFailed.length).toBeGreaterThan(0);
      for (const m of checkoutFailed) {
        const forfeitedSlot = m.result.forfeits!.find((f) => f.reason === 'checkout_failed')!.team;
        expect(m.teams[forfeitedSlot].name).toBe('Ghost Team');
      }

      // Segfault Squad vs Ghost Team: both broken -> a double forfeit (no winner).
      const doubleForfeit = bundle.matches.find(
        (m) => m.teams.some((t) => t.name === 'Segfault Squad') && m.teams.some((t) => t.name === 'Ghost Team'),
      );
      expect(doubleForfeit).toBeTruthy();
      expect(doubleForfeit!.result.forfeits).toHaveLength(2);
      expect(doubleForfeit!.result.winner_team).toBeNull();

      // ---- clock_expired game forfeit for the slow bot -------------------
      const sleepyMatches = bundle.matches.filter((m) => m.teams.some((t) => t.name === 'Sleepy Node') && m.result.reason === 'played');
      const clockExpiredGames = sleepyMatches.flatMap((m) => m.games).filter((g) => g.outcome.type === 'forfeit' && g.outcome.reason === 'clock_expired');
      expect(clockExpiredGames.length).toBeGreaterThan(0);

      // ---- each healthy team's image was built exactly once --------------
      // The build-once cache mechanism itself (prepare() builds once, start()
      // reuses it, no per-match rebuild) is unit/integration-tested directly
      // in docker.integration.test.ts (a buildImage call-count spy). Here, at
      // the CLI/process level, the observable proxy is: exactly one
      // deterministically-tagged image per successfully-built team exists
      // once the run finishes (broken teams never get one).
      // Image tags are deterministic from the ROSTER team name (safeDirName,
      // see git.ts/container-runtime.ts's imageTagFor) — not this fixture's
      // local directory names — e.g. "Pythonic Pieces" -> "pythonic_pieces".
      const healthyTeamTagPrefixes = ['c4-bot-pythonic_pieces-', 'c4-bot-gopher_squad-', 'c4-bot-rustaceans-', 'c4-bot-sleepy_node-'];
      const imagesAfter = await docker.listImages({ filters: JSON.stringify({ label: ['c4.arena=1'] }) });
      const tagsAfter = imagesAfter.flatMap((i) => i.RepoTags ?? []);
      const newTags = tagsAfter.filter((t) => !imageLabelsBefore.has(t));
      for (const prefix of healthyTeamTagPrefixes) {
        const matches = newTags.filter((t) => t.startsWith(prefix));
        expect(matches, `expected exactly one built image for ${prefix}, got ${JSON.stringify(matches)}`).toHaveLength(1);
      }
      // Neither broken team ever got a final tagged image.
      expect(newTags.some((t) => t.startsWith('c4-bot-segfault_squad-'))).toBe(false);
      expect(newTags.some((t) => t.startsWith('c4-bot-ghost_team-'))).toBe(false);

      // ---- no containers/networks left running for this run --------------
      // Every container/network orchestrateMatch creates is disposed in a
      // `finally` before it returns, so nothing new should still be alive
      // once the CLI subprocess has exited. Scoped by ID-diff against the
      // beforeAll baseline (see its comment) so this doesn't false-fail
      // against unrelated c4.arena=1 resources from another concurrently
      // running test file / agent sharing this Docker daemon.
      const containersAfter = await docker.listContainers({ all: true, filters: JSON.stringify({ label: [`c4.run=${RUN_ID}`] }) });
      const newContainers = containersAfter.filter((c) => !containerIdsBefore.has(c.Id));
      expect(newContainers, JSON.stringify(newContainers.map((c) => c.Names))).toHaveLength(0);

      const networksAfter = await docker.listNetworks({ filters: JSON.stringify({ label: [`c4.run=${RUN_ID}`] }) });
      const newNetworks = networksAfter.filter((n) => !networkIdsBefore.has(n.Id));
      expect(newNetworks, JSON.stringify(newNetworks.map((n) => n.Name))).toHaveLength(0);

      // Clean up the images this test built (opt-in per DOCKER SAFETY: only
      // images this test itself just created).
      await Promise.all(newTags.map((tag) => docker.getImage(tag).remove({ force: true }).catch(() => undefined)));
    },
    240_000,
  );
});
