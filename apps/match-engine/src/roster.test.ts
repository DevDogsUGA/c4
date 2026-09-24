import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoster, MAX_TEAMS, parseRosterCsv, parseRosterJson, RosterParseError } from './roster.js';

describe('parseRosterCsv', () => {
  it('parses simple rows with no header', () => {
    const csv = `Team A,https://github.com/a/a\nTeam B,https://github.com/b/b`;
    expect(parseRosterCsv(csv)).toEqual([
      { name: 'Team A', repoUrl: 'https://github.com/a/a' },
      { name: 'Team B', repoUrl: 'https://github.com/b/b' },
    ]);
  });

  it('skips a recognizable header row', () => {
    const csv = `Team Name,Repo URL\nTeam A,https://github.com/a/a`;
    expect(parseRosterCsv(csv)).toEqual([{ name: 'Team A', repoUrl: 'https://github.com/a/a' }]);
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = `"Code, Inc.",https://github.com/code-inc/repo`;
    expect(parseRosterCsv(csv)).toEqual([{ name: 'Code, Inc.', repoUrl: 'https://github.com/code-inc/repo' }]);
  });

  it('ignores blank lines', () => {
    const csv = `Team A,https://a\n\n\nTeam B,https://b\n`;
    expect(parseRosterCsv(csv)).toHaveLength(2);
  });

  it('returns an empty list for empty input', () => {
    expect(parseRosterCsv('')).toEqual([]);
    expect(parseRosterCsv('   \n  \n')).toEqual([]);
  });

  it('throws on a malformed row (missing repo URL)', () => {
    expect(() => parseRosterCsv('Team A')).toThrow(RosterParseError);
  });

  it('throws on duplicate team names', () => {
    const csv = `Team A,https://a\nTeam A,https://a-again`;
    expect(() => parseRosterCsv(csv)).toThrow(RosterParseError);
  });

  it('throws on duplicate repo URLs under different team names', () => {
    const csv = `Team A,https://github.com/a/a.git\nTeam B,https://github.com/a/a`;
    expect(() => parseRosterCsv(csv)).toThrow(RosterParseError);
  });

  it('throws when the roster exceeds MAX_TEAMS', () => {
    const rows = Array.from({ length: MAX_TEAMS + 1 }, (_, i) => `Team ${i},https://team-${i}`).join('\n');
    expect(() => parseRosterCsv(rows)).toThrow(RosterParseError);
  });
});

describe('parseRosterJson', () => {
  const validJson = JSON.stringify({
    teams: [
      { id: '1', team_name: 'Team A', repo_url: 'https://a', members: ['Alice'], submitter_email: 'a@uga.edu', updated_at: '2026-09-24T00:00:00Z' },
      { id: '2', team_name: 'Team B', repo_url: 'https://b' },
    ],
  });

  it('parses the roster-worker JSON shape into teams, carrying members through', () => {
    expect(parseRosterJson(validJson)).toEqual([
      { name: 'Team A', repoUrl: 'https://a', members: ['Alice'] },
      { name: 'Team B', repoUrl: 'https://b' },
    ]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseRosterJson('not json')).toThrow(RosterParseError);
  });

  it('throws when the top-level shape is wrong', () => {
    expect(() => parseRosterJson(JSON.stringify({ notTeams: [] }))).toThrow(RosterParseError);
  });

  it('throws when a team is missing team_name or repo_url', () => {
    expect(() => parseRosterJson(JSON.stringify({ teams: [{ repo_url: 'https://a' }] }))).toThrow(RosterParseError);
    expect(() => parseRosterJson(JSON.stringify({ teams: [{ team_name: 'A' }] }))).toThrow(RosterParseError);
  });

  it('throws on duplicate repo URLs', () => {
    const json = JSON.stringify({
      teams: [
        { team_name: 'Team A', repo_url: 'https://github.com/a/a' },
        { team_name: 'Team B', repo_url: 'https://github.com/a/a.git' },
      ],
    });
    expect(() => parseRosterJson(json)).toThrow(RosterParseError);
  });
});

describe('loadRoster', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'c4-roster-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    delete process.env.C4_ROSTER_TOKEN;
  });

  it('loads a CSV file by path', async () => {
    const filePath = path.join(dir, 'roster.csv');
    await writeFile(filePath, 'Team A,https://a\n', 'utf8');
    expect(await loadRoster(filePath)).toEqual([{ name: 'Team A', repoUrl: 'https://a' }]);
  });

  it('loads a JSON file by path (.json extension)', async () => {
    const filePath = path.join(dir, 'roster.json');
    await writeFile(filePath, JSON.stringify({ teams: [{ team_name: 'Team A', repo_url: 'https://a' }] }), 'utf8');
    expect(await loadRoster(filePath)).toEqual([{ name: 'Team A', repoUrl: 'https://a' }]);
  });

  it('fetches an https URL as JSON, sending C4_ROSTER_TOKEN as a bearer token when set', async () => {
    process.env.C4_ROSTER_TOKEN = 'secret-token';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ teams: [{ team_name: 'Team A', repo_url: 'https://a' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const teams = await loadRoster('https://worker.example.com/api/roster');
    expect(teams).toEqual([{ name: 'Team A', repoUrl: 'https://a' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example.com/api/roster',
      expect.objectContaining({ headers: { Authorization: 'Bearer secret-token' } }),
    );
    vi.unstubAllGlobals();
  });

  it('throws when the roster URL fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => '' })),
    );
    await expect(loadRoster('https://worker.example.com/api/roster')).rejects.toThrow(RosterParseError);
    vi.unstubAllGlobals();
  });
});
