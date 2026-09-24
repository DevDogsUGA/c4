import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MatchRecord, TournamentSummary } from '@acm-uga/c4-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTournamentBundle, writeMatchRecord, writeTournamentBundle, writeTournamentSummary } from './output.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'c4-output-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const validMatch: MatchRecord = {
  match_id: 'rr-001',
  phase: 'roundrobin',
  teams: [
    { name: 'Team A', repo_url: 'https://github.com/a/a' },
    { name: 'Team B', repo_url: 'https://github.com/b/b' },
  ],
  games: [],
  result: { winner_team: 0, games_won: [2, 0], reason: 'played' },
};

const validSummary: TournamentSummary = {
  standings: [],
  bracket: [],
  generated_at: new Date().toISOString(),
};

describe('writeMatchRecord', () => {
  it('writes a validated, pretty-printed JSON file the presenter can read', async () => {
    const filePath = await writeMatchRecord(dir, validMatch);
    const contents = JSON.parse(await readFile(filePath, 'utf8'));
    expect(contents).toEqual(validMatch);
    expect(filePath).toBe(path.join(dir, 'rr-001.json'));
  });

  it('sanitizes match_id into a safe file name', async () => {
    const record: MatchRecord = { ...validMatch, match_id: 'bracket/round 1: final?' };
    const filePath = await writeMatchRecord(dir, record);
    expect(path.basename(filePath)).toMatch(/^[a-zA-Z0-9_-]+\.json$/);
  });

  it('throws rather than writing a record that fails the contract schema', async () => {
    const bad = { ...validMatch, teams: [validMatch.teams[0]] } as unknown as MatchRecord;
    await expect(writeMatchRecord(dir, bad)).rejects.toThrow();
  });

  it('creates the output directory if it does not exist yet', async () => {
    const nested = path.join(dir, 'a', 'b', 'c');
    const filePath = await writeMatchRecord(nested, validMatch);
    expect(await readFile(filePath, 'utf8')).toContain('rr-001');
  });
});

describe('writeTournamentSummary', () => {
  it('writes tournament-summary.json', async () => {
    const filePath = await writeTournamentSummary(dir, validSummary);
    expect(path.basename(filePath)).toBe('tournament-summary.json');
    const contents = JSON.parse(await readFile(filePath, 'utf8'));
    expect(contents.standings).toEqual([]);
  });

  it('throws on an invalid summary', async () => {
    const bad = { ...validSummary, generated_at: 'not-a-date' } as unknown as TournamentSummary;
    await expect(writeTournamentSummary(dir, bad)).rejects.toThrow();
  });
});

describe('buildTournamentBundle / writeTournamentBundle', () => {
  it('builds a schema-valid bundle with format/version and optional provenance', () => {
    const bundle = buildTournamentBundle(validSummary, [validMatch], { seed: 42 });
    expect(bundle.format).toBe('c4-tournament-bundle');
    expect(bundle.version).toBe(1);
    expect(bundle.matches).toEqual([validMatch]);
    expect(bundle.provenance).toEqual({ seed: 42 });
  });

  it('omits provenance entirely when not given', () => {
    const bundle = buildTournamentBundle(validSummary, [validMatch]);
    expect(bundle.provenance).toBeUndefined();
  });

  it('throws when building a bundle from an invalid match record', () => {
    const bad = { ...validMatch, teams: [validMatch.teams[0]] } as unknown as MatchRecord;
    expect(() => buildTournamentBundle(validSummary, [bad])).toThrow();
  });

  it('writes the bundle to the given file path, creating parent directories', async () => {
    const bundle = buildTournamentBundle(validSummary, [validMatch]);
    const filePath = path.join(dir, 'nested', 'tournament.json');
    const written = await writeTournamentBundle(filePath, bundle);
    expect(written).toBe(filePath);
    const contents = JSON.parse(await readFile(filePath, 'utf8'));
    expect(contents.format).toBe('c4-tournament-bundle');
    expect(contents.matches).toEqual([validMatch]);
  });
});
