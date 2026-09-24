// Roster input: CSV (team name, repo URL) matching the Google Form export,
// per IMPLEMENTATION_PLAN.md work package 2. Deliberately tiny — no CSV
// library dependency for a two-column format with occasional quoted commas
// (team names can contain commas if quoted, e.g. `"Code, Inc.",https://...`).

import { readFile } from 'node:fs/promises';
import { normalizeRepoUrl } from './lock.js';
import type { Team } from './types.js';

export class RosterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterParseError';
  }
}

export const MAX_TEAMS = 32;

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

  return enforceRosterInvariants(teams);
}

// ---------------------------------------------------------------------------
// JSON roster: the c4-registry Worker's `/api/roster` shape (EVENT_PLAN.md
// "Shared interfaces"): { "teams": [{ id, team_name, repo_url, members,
// submitter_email, updated_at }] }.
// ---------------------------------------------------------------------------

interface RosterApiTeam {
  id?: string;
  team_name: string;
  repo_url: string;
  members?: string[];
  submitter_email?: string;
  updated_at?: string;
}

interface RosterApiResponse {
  teams: RosterApiTeam[];
}

/** Parses the JSON roster shape `{ teams: [{ team_name, repo_url, members, ... }] }` into engine Teams. */
export function parseRosterJson(jsonText: string): Team[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new RosterParseError(`roster JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const response = parsed as Partial<RosterApiResponse>;
  if (!response || !Array.isArray(response.teams)) {
    throw new RosterParseError('roster JSON must have the shape { "teams": [...] }');
  }

  const teams: Team[] = response.teams.map((t, index) => {
    if (!t || typeof t.team_name !== 'string' || t.team_name.trim() === '') {
      throw new RosterParseError(`roster JSON team ${index + 1} is missing team_name`);
    }
    if (typeof t.repo_url !== 'string' || t.repo_url.trim() === '') {
      throw new RosterParseError(`roster JSON team ${index + 1} (${t.team_name}) is missing repo_url`);
    }
    return {
      name: t.team_name,
      repoUrl: t.repo_url,
      ...(Array.isArray(t.members) && t.members.length > 0 ? { members: t.members } : {}),
    };
  });

  return enforceRosterInvariants(teams);
}

/**
 * Enforces the shared roster invariants regardless of source (CSV or JSON):
 * at most MAX_TEAMS entries, and no duplicate team names or repo URLs
 * (normalized).
 */
export function enforceRosterInvariants(teams: readonly Team[]): Team[] {
  if (teams.length > MAX_TEAMS) {
    throw new RosterParseError(`roster has ${teams.length} teams, exceeding the max of ${MAX_TEAMS}`);
  }

  const seenNames = new Set<string>();
  const seenRepos = new Set<string>();
  for (const team of teams) {
    const nameKey = team.name.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new RosterParseError(`duplicate team name in roster: ${team.name}`);
    }
    seenNames.add(nameKey);

    const repoKey = normalizeRepoUrl(team.repoUrl);
    if (seenRepos.has(repoKey)) {
      throw new RosterParseError(`duplicate repo URL in roster: ${team.repoUrl}`);
    }
    seenRepos.add(repoKey);
  }

  return [...teams];
}

/**
 * Loads a roster from a CSV path, a JSON path, or an https URL (per
 * EVENT_PLAN.md: "--roster accepts a CSV path, a JSON path, or an https
 * URL (it sends C4_ROSTER_TOKEN as a bearer token)"). Source detection: an
 * `https://` (or `http://`, for local testing) prefix is a URL; otherwise
 * a `.json` extension is JSON, anything else is CSV.
 */
export async function loadRoster(source: string): Promise<Team[]> {
  if (/^https?:\/\//i.test(source)) {
    const token = process.env.C4_ROSTER_TOKEN;
    const res = await fetch(source, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      throw new RosterParseError(`failed to fetch roster from ${source}: HTTP ${res.status}`);
    }
    return parseRosterJson(await res.text());
  }

  const text = await readFile(source, 'utf8');
  if (source.toLowerCase().endsWith('.json')) {
    return parseRosterJson(text);
  }
  return parseRosterCsv(text);
}
