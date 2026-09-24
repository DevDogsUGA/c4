import type { TeamRow } from './types';

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function teamsToCsv(teams: TeamRow[]): string {
  const header = ['id', 'team_name', 'repo_url', 'members', 'submitter_email', 'updated_at'];
  const lines = [header.join(',')];
  for (const t of teams) {
    const members = (JSON.parse(t.members_json) as string[]).join('; ');
    lines.push(
      [
        String(t.id),
        csvField(t.team_name),
        csvField(t.repo_url),
        csvField(members),
        csvField(t.submitter_email || '—'),
        csvField(t.updated_at),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
