// `c4 freeze` exits 1 when any individual team's commit can't be resolved
// (e.g. checkout-fail-team's repo doesn't exist) -- that's by design per
// EVENT_PLAN.md ("teams whose build fails stay in and forfeit"): the lock
// file still gets written with a `commit: null` entry, and downstream
// `run-tournament` turns that into a per-team checkout_failed forfeit, not a
// run-wide failure. `RealEngineCli.freeze()` must tolerate that nonzero
// exit instead of aborting the whole samples pipeline before a single
// container is even built. `runTournament()` has no such "partial failure
// is fine" contract, so it must still reject on a nonzero exit.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RealEngineCli } from './engine-cli.js';

function fakeCliScript(dir: string, exitCode: number): string {
  const file = path.join(dir, 'fake-cli.js');
  writeFileSync(
    file,
    `const code = ${JSON.stringify(exitCode)};\nconst cmd = process.argv[2];\nif (cmd === 'freeze') { process.stderr.write('FAIL  Some Team: could not resolve default branch commit\\n'); }\nprocess.exitCode = code;\n`,
  );
  return file;
}

describe('RealEngineCli', () => {
  it('freeze() resolves even when the underlying CLI exits nonzero (a team could not be resolved)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'c4-engine-cli-test-'));
    try {
      const bin = fakeCliScript(dir, 1);
      const cli = new RealEngineCli(bin, dir);
      await expect(cli.freeze({ rosterPath: 'roster.json', lockPath: 'lock.json' })).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runTournament() rejects when the underlying CLI exits nonzero', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'c4-engine-cli-test-'));
    try {
      const bin = fakeCliScript(dir, 1);
      const cli = new RealEngineCli(bin, dir);
      await expect(
        cli.runTournament({ rosterPath: 'roster.json', lockPath: 'lock.json', outputDir: 'out', bundlePath: 'out/bundle.json' }),
      ).rejects.toThrow(/exited 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runTournament() resolves when the underlying CLI exits 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'c4-engine-cli-test-'));
    try {
      const bin = fakeCliScript(dir, 0);
      const cli = new RealEngineCli(bin, dir);
      await expect(
        cli.runTournament({ rosterPath: 'roster.json', lockPath: 'lock.json', outputDir: 'out', bundlePath: 'out/bundle.json' }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
