// Builds the engine's JSON roster format from materialized samples.
// Per EVENT_PLAN.md shared interfaces: `{ "teams": [{ "id", "team_name",
// "repo_url", "members", "submitter_email", "updated_at" }] }`. repo_url may
// be a file:// URL (materialize.ts produces exactly that).

import type { MaterializedSample } from './materialize.js';

export interface RosterTeam {
  id: string;
  team_name: string;
  repo_url: string;
  members: string[];
  submitter_email: string;
  updated_at: string;
}

export interface RosterJson {
  teams: RosterTeam[];
}

/**
 * Turns materialized samples into a roster. `--teams N` duplicates samples
 * (round-robin over the materialized set) with suffixed names/ids to reach
 * N teams, for the 32-team dress rehearsal.
 */
export function buildRoster(materialized: MaterializedSample[], teamsWanted?: number): RosterJson {
  if (materialized.length === 0) {
    throw new Error('buildRoster: no materialized samples');
  }
  const base: RosterTeam[] = materialized.map((m) => ({
    id: m.slug,
    team_name: m.sample.name,
    // A sample whose expect.kind is "checkout_failed" wants the engine's
    // checkout step itself to fail, so it's pointed at a repo that was
    // never materialized instead of the real file:// URL.
    repo_url: m.sample.expect.kind === 'checkout_failed' ? `${m.repoUrl}-does-not-exist` : m.repoUrl,
    members: m.sample.members ?? ['Sample Bot'],
    submitter_email: 'hello@sloanfinger.com',
    updated_at: new Date().toISOString(),
  }));

  if (!teamsWanted) {
    return { teams: base };
  }

  if (teamsWanted <= base.length) {
    // More materialized samples than requested (e.g. the sample set grew
    // past the dress-rehearsal team cap) -- trim down to exactly N rather
    // than silently exceeding the cap the caller asked for (the engine
    // itself rejects rosters over its max-teams invariant).
    return { teams: base.slice(0, teamsWanted) };
  }

  const teams: RosterTeam[] = [];
  let dup = 0;
  while (teams.length < teamsWanted) {
    const src = base[teams.length % base.length];
    const suffix = dup === 0 ? '' : ` #${dup + 1}`;
    teams.push({
      ...src,
      id: `${src.id}${dup === 0 ? '' : `-dup${dup + 1}`}`,
      team_name: `${src.team_name}${suffix}`,
    });
    if (teams.length % base.length === 0) dup++;
  }
  return { teams };
}
