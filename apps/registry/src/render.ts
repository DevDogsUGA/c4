import type { LatestResultRow, RepoStatusRow, TeamRow } from './types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    background: #0a0a0a;
    color: #f5f5f5;
    font-family: 'Spline Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    margin: 0;
    padding: 1.5rem;
    line-height: 1.5;
  }
  h1 { color: #fff; font-size: 1.6rem; margin: 0 0 0.25rem; }
  .sub { color: #bbb; margin: 0 0 1.5rem; font-size: 0.95rem; }
  .accent { color: #BA0C2F; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid #262626; vertical-align: top; }
  th { color: #BA0C2F; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  a { color: #ff6b81; }
  a:hover { color: #ff97a8; }
  .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
  .badge-ok { background: #16351f; color: #6fdc8c; }
  .badge-bad { background: #3a1418; color: #ff8a94; }
  .badge-warn { background: #3a2f10; color: #f0c96b; }
  .badge-muted { background: #262626; color: #999; }
  .card { background: #141414; border: 1px solid #262626; border-radius: 10px; padding: 1rem; margin-bottom: 1rem; }
  .members { color: #ccc; font-size: 0.9rem; }
  footer { margin-top: 2rem; color: #666; font-size: 0.8rem; }
  @media (max-width: 640px) {
    table, thead, tbody, th, td, tr { display: block; }
    thead { display: none; }
    tr { border-bottom: 1px solid #262626; padding: 0.75rem 0; }
    td { border: none; padding: 0.15rem 0; }
    td::before { content: attr(data-label) ': '; color: #BA0C2F; font-weight: 600; }
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
${body}
<footer>ACM UGA &middot; Connect Four Hackathon</footer>
</body>
</html>`;
}

function badge(text: string, kind: 'ok' | 'bad' | 'warn' | 'muted'): string {
  return `<span class="badge badge-${kind}">${esc(text)}</span>`;
}

function reachabilityBadge(status: RepoStatusRow | null): string {
  if (!status) return badge('checking…', 'muted');
  switch (status.reachability) {
    case 'reachable':
      return badge('reachable', 'ok');
    case 'empty':
      return badge('empty repo', 'warn');
    case 'private':
      return badge('private / unreachable', 'bad');
    case 'unreachable':
      return badge('unreachable', 'bad');
    default:
      return badge('unknown', 'muted');
  }
}

function actionsBadge(status: RepoStatusRow | null): string {
  if (!status) return badge('checking…', 'muted');
  switch (status.actions_status) {
    case 'success':
      return badge('CI passing', 'ok');
    case 'failure':
      return badge('CI failing', 'bad');
    case 'in_progress':
      return badge('CI running', 'warn');
    case 'none':
      return badge('no CI runs', 'muted');
    default:
      return badge('CI unknown', 'muted');
  }
}

export function renderStatusPage(teams: TeamRow[], statuses: Map<string, RepoStatusRow>, started: boolean): string {
  const rows = teams
    .map((t) => {
      const status = statuses.get(t.repo_url) ?? null;
      const stateCell = started ? actionsBadge(status) : reachabilityBadge(status);
      const members = (JSON.parse(t.members_json) as string[]).map(esc).join(', ') || '<span class="members">—</span>';
      const runLink =
        started && status?.actions_run_url ? ` <a href="${esc(status.actions_run_url)}" target="_blank" rel="noopener">run</a>` : '';
      return `<tr>
        <td data-label="Team">${esc(t.team_name)}</td>
        <td data-label="Members" class="members">${members}</td>
        <td data-label="Repo"><a href="${esc(t.repo_url)}" target="_blank" rel="noopener">${esc(t.repo_url.replace('https://', ''))}</a></td>
        <td data-label="State">${stateCell}${runLink}</td>
      </tr>`;
    })
    .join('\n');

  const phase = started ? 'Competition in progress' : 'Registration / pre-competition';

  return page(
    'Connect Four Hackathon — Status',
    `<h1>Connect Four <span class="accent">Hackathon</span></h1>
<p class="sub">${esc(phase)} &middot; ${teams.length} team${teams.length === 1 ? '' : 's'} registered</p>
<table>
  <thead><tr><th>Team</th><th>Members</th><th>Repo</th><th>${started ? 'CI Status' : 'Repo State'}</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4">No teams registered yet.</td></tr>'}</tbody>
</table>`,
  );
}

export function renderAdminPage(opts: {
  teams: TeamRow[];
  statuses: Map<string, RepoStatusRow>;
  latestResults: Map<string, LatestResultRow>;
  history: Map<string, unknown[]>;
  formLog: unknown[];
  started: boolean;
  email: string;
}): string {
  const { teams, statuses, latestResults, history, formLog, started, email } = opts;
  const prodTeams = teams.filter((t) => t.env !== 'staging');
  const stagingTeams = teams.filter((t) => t.env === 'staging');

  const renderTeamCard = (t: TeamRow) => {
      const status = statuses.get(t.repo_url) ?? null;
      const latest = latestResults.get(t.repo_url) ?? null;
      const hist = (history.get(t.repo_url) ?? []) as Array<Record<string, unknown>>;
      const members = (JSON.parse(t.members_json) as string[]).map(esc).join(', ') || '—';
      const historyRows = hist
        .map(
          (h) =>
            `<tr><td data-label="At">${esc(String(h.at))}</td><td data-label="Status">${esc(String(h.status))}</td><td data-label="Stage">${esc(String(h.stage))}</td><td data-label="Commit">${esc(String(h.commit_sha)).slice(0, 7)}</td><td data-label="Detail">${esc(String(h.detail ?? ''))}</td><td data-label="Log">${h.log_tail ? `<pre style="white-space:pre-wrap;max-width:420px;">${esc(String(h.log_tail))}</pre>` : ''}</td></tr>`,
        )
        .join('\n');

      return `<div class="card">
  <h3>${esc(t.team_name)} <span class="members">(${esc(t.submitter_email)})</span></h3>
  <p class="members">Members: ${members}</p>
  <p><a href="${esc(t.repo_url)}" target="_blank" rel="noopener">${esc(t.repo_url)}</a> &middot; response ${esc(t.response_id)} &middot; updated ${esc(t.updated_at)}</p>
  <p>Repo: ${reachabilityBadge(status)} ${status?.latest_commit ? `(commit ${esc(status.latest_commit.slice(0, 7))})` : ''} &middot; Actions: ${actionsBadge(status)}</p>
  <p>Latest arena result: ${latest ? `${badge(latest.status, latest.status === 'passed' ? 'ok' : latest.status === 'failed' ? 'bad' : 'warn')} stage=${esc(latest.stage)} commit=${esc(latest.commit_sha.slice(0, 7))} at=${esc(latest.at)} ${latest.detail ? `— ${esc(latest.detail)}` : ''}` : '<span class="members">no results yet</span>'}</p>
  ${hist.length ? `<details><summary>History (${hist.length})</summary><table><thead><tr><th>At</th><th>Status</th><th>Stage</th><th>Commit</th><th>Detail</th><th>Log</th></tr></thead><tbody>${historyRows}</tbody></table></details>` : ''}
  ${
    t.env === 'staging'
      ? `<form method="post" action="/admin/staging/${t.id}/delete" onsubmit="return confirm('Purge this staging registration?')"><button type="submit">Purge staging row</button></form>`
      : ''
  }
</div>`;
  };

  const teamCards = prodTeams.map(renderTeamCard).join('\n');
  const stagingCards = stagingTeams.map(renderTeamCard).join('\n');

  const logRows = (formLog as Array<Record<string, unknown>>)
    .map(
      (l) =>
        `<tr><td data-label="At">${esc(String(l.created_at))}</td><td data-label="Outcome">${badge(String(l.outcome), l.outcome === 'accepted' ? 'ok' : 'bad')}</td><td data-label="Team">${esc(String(l.team_name ?? ''))}</td><td data-label="Email">${esc(String(l.submitter_email ?? ''))}</td><td data-label="Repo">${esc(String(l.repo_url ?? ''))}</td><td data-label="Reason">${esc(String(l.reject_reason ?? ''))}</td></tr>`,
    )
    .join('\n');

  return page(
    'Connect Four Hackathon — Admin',
    `<h1>Admin <span class="accent">Console</span></h1>
<p class="sub">Signed in as ${esc(email)} &middot; ${teams.length} teams</p>
<div class="card">
  <form method="post" action="/admin/competition-started">
    <label><input type="checkbox" name="started" value="true" ${started ? 'checked' : ''} onchange="this.form.requestSubmit()" /> Competition started</label>
  </form>
  <p><a href="/admin/roster.csv">Download roster CSV</a></p>
</div>
<h2>Teams (${prodTeams.length})</h2>
${teamCards || '<p class="sub">No production teams registered yet.</p>'}
${
  stagingTeams.length
    ? `<h2>Staging registrations (${stagingTeams.length})</h2>
<p class="sub">From the unrestricted staging copy of the form; excluded from the public roster, /api/roster, the 32-team cap and duplicate-repo checks.</p>
${stagingCards}`
    : ''
}
<h2>Form submission log</h2>
<table>
  <thead><tr><th>At</th><th>Outcome</th><th>Team</th><th>Email</th><th>Repo</th><th>Reason</th></tr></thead>
  <tbody>${logRows || '<tr><td colspan="6">No submissions logged yet.</td></tr>'}</tbody>
</table>`,
  );
}
