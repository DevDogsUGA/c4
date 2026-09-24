import { describe, expect, it } from 'vitest';
import { parseRosterCsv, RosterParseError } from './roster.js';

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
});
