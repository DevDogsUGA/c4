// Roster input: CSV (team name, repo URL) matching the Google Form export,
// per IMPLEMENTATION_PLAN.md work package 2. Deliberately tiny — no CSV
// library dependency for a two-column format with occasional quoted commas
// (team names can contain commas if quoted, e.g. `"Code, Inc.",https://...`).

import type { Team } from './types.js';

export class RosterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterParseError';
  }
}

/** Splits one CSV line into fields, honoring double-quoted fields with `""`-escaped quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

const HEADER_ALIASES = new Set(['team name', 'team', 'name']);

/**
 * Parses roster CSV text into teams. Accepts an optional header row (skipped
 * if its first cell looks like "team name"/"team"/"name", case-insensitive).
 * Each data row must have at least two columns: team name, repo URL.
 */
export function parseRosterCsv(csvText: string): Team[] {
  const lines = csvText
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  let rows = lines;
  const first = splitCsvLine(lines[0]);
  if (first.length > 0 && HEADER_ALIASES.has(first[0].toLowerCase())) {
    rows = lines.slice(1);
  }

  const teams: Team[] = [];
  const seenNames = new Set<string>();

  rows.forEach((line, index) => {
    const fields = splitCsvLine(line);
    if (fields.length < 2 || fields[0] === '' || fields[1] === '') {
      throw new RosterParseError(`roster row ${index + 1} is malformed (expected "team name,repo url"): ${line}`);
    }
    const [name, repoUrl] = fields;
    if (seenNames.has(name)) {
      throw new RosterParseError(`duplicate team name in roster: ${name}`);
    }
    seenNames.add(name);
    teams.push({ name, repoUrl });
  });

  return teams;
}
