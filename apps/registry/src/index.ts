import { Hono, type Context } from 'hono';
import { verifySignature } from './crypto';
import { normalizeRepoUrl } from './normalize';
import { postDiscord, shortSha } from './discord';
import { teamsToCsv } from './csv';
import { renderAdminPage, renderStatusPage } from './render';
import { refreshAllRepoStatuses } from './cron';
import { authenticateAdmin } from './admin-auth';
import {
  deleteTeam,
  getLatestResult,
  isCompetitionStarted,
  listFormLog,
  listRepoStatuses,
  listResultHistory,
  listTeams,
  logFormSubmission,
  recordResult,
  rowToRoster,
  setSetting,
  upsertTeam,
} from './db';
import type { Env, FormPayload, LatestResultRow, ResultsPayload, TeamEnv } from './types';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// MODE gating: this same Worker script can be deployed three ways (see
// Env.MODE). On workers.dev, Cloudflare Access can only protect an entire
// hostname, so the public-facing host must never expose /admin, and the
// admin-only host must expose nothing else. On a custom domain, Access can
// gate just the /admin path on a single Worker, so that deployment uses
// MODE=both and every route is served from the one script.
//
// MODE unset is treated the same as 'public' — the safe default is to never
// serve admin routes unless a deployment opts in explicitly.
// ---------------------------------------------------------------------------

/**
 * True if `pathname` refers to an /admin route, robust to casing and
 * (possibly nested/double) percent-encoding — e.g. "/Admin", "/admin%2f..",
 * "/%2E%2E/admin" all count. This is defense in depth on top of Hono's own
 * (case-sensitive, already-decoded) route matching: nothing should let an
 * alternate spelling of /admin slip past this gate in 'public' mode.
 */
function isAdminPath(pathname: string): boolean {
  let decoded = pathname;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }
  const normalized = decoded.toLowerCase().replace(/\/+/g, '/');
  return normalized === '/admin' || normalized.startsWith('/admin/');
}

app.use('*', async (c, next) => {
  const mode = c.env.MODE ?? 'public';
  const pathname = new URL(c.req.url).pathname;

  if (mode === 'both') return next();

  if (mode === 'admin') {
    // The admin worker also serves the admin UI at "/" since it has no
    // other reason to exist on its own host.
    if (pathname === '/' || isAdminPath(pathname)) return next();
    return c.notFound();
  }

  // mode === 'public' (including MODE unset)
  if (isAdminPath(pathname)) return c.notFound();
  return next();
});

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

app.get('/health', (c) => c.json({ ok: true }));

app.get('/', async (c) => {
  if (c.env.MODE === 'admin') return renderAdminRoute(c);

  // Public page only ever shows the real ('production') roster; staging
  // registrations used to dress-rehearse the form pipeline are excluded.
  const teams = await listTeams(c.env.DB, 'production');
  const statusRows = await listRepoStatuses(c.env.DB);
  const statuses = new Map(statusRows.map((s) => [s.repo_url, s]));
  const started = await isCompetitionStarted(c.env.DB);
  return c.html(renderStatusPage(teams, statuses, started));
});

// ---------------------------------------------------------------------------
// Form intake (Apps Script)
// ---------------------------------------------------------------------------

app.post('/api/form', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-C4-Signature');
  const now = new Date().toISOString();

  const valid = await verifySignature(c.env.FORM_HMAC_SECRET, rawBody, signature);
  if (!valid) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  let payload: FormPayload;
  try {
    payload = JSON.parse(rawBody) as FormPayload;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const env: TeamEnv = payload.env === 'staging' ? 'staging' : 'production';

  if (
    !payload.response_id ||
    !payload.submitter_email ||
    !payload.team_name ||
    !payload.repo_url ||
    !Array.isArray(payload.members)
  ) {
    await logFormSubmission(
      c.env.DB,
      {
        response_id: payload.response_id,
        submitter_email: payload.submitter_email,
        team_name: payload.team_name,
        repo_url: payload.repo_url,
        env,
        outcome: 'rejected',
        reject_reason: 'missing required fields',
      },
      now,
    );
    return c.json({ error: 'missing required fields' }, 400);
  }

  const normalized = normalizeRepoUrl(payload.repo_url);
  if (!normalized) {
    await logFormSubmission(
      c.env.DB,
      { ...payload, env, outcome: 'rejected', reject_reason: 'repo_url must be a github.com repository' },
      now,
    );
    return c.json({ error: 'repo_url must be a github.com repository' }, 422);
  }

  const outcome = await upsertTeam(c.env.DB, payload, normalized, now);

  if (!outcome.ok) {
    await logFormSubmission(
      c.env.DB,
      { ...payload, repo_url: normalized, env, outcome: 'rejected', reject_reason: outcome.reason },
      now,
    );
    return c.json({ error: outcome.reason }, outcome.status as 403 | 409);
  }

  await logFormSubmission(
    c.env.DB,
    { ...payload, repo_url: normalized, env, outcome: 'accepted', reject_reason: null },
    now,
  );

  c.executionCtx.waitUntil(
    postDiscord(
      c.env.DISCORD_WEBHOOK_URL,
      outcome.created
        ? `:new: **${outcome.team.team_name}** registered — ${normalized}`
        : `:pencil2: **${outcome.team.team_name}** updated their registration — ${normalized}`,
    ),
  );

  return c.json({ ok: true, team: rowToRoster(outcome.team) }, outcome.created ? 201 : 200);
});

// ---------------------------------------------------------------------------
// Roster (bearer ROSTER_TOKEN)
// ---------------------------------------------------------------------------

function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1] : null;
}

app.get('/api/roster', async (c) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token || token !== c.env.ROSTER_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Defaults to the real roster; ?env=staging (same bearer auth) exposes the
  // staging-only teams used by scripts/staging-e2e.ts, never mixed with prod.
  const env: TeamEnv = c.req.query('env') === 'staging' ? 'staging' : 'production';
  const teams = await listTeams(c.env.DB, env);
  return c.json({ teams: teams.map(rowToRoster) });
});

// ---------------------------------------------------------------------------
// Arena results (bearer RESULTS_TOKEN)
// ---------------------------------------------------------------------------

app.post('/api/results', async (c) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token || token !== c.env.RESULTS_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let payload: ResultsPayload;
  try {
    payload = (await c.req.json()) as ResultsPayload;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  if (!payload.repo_url || !payload.commit || !payload.status || !payload.stage || !payload.at) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  if (!['building', 'passed', 'failed'].includes(payload.status)) {
    return c.json({ error: 'invalid status' }, 400);
  }
  if (!['checkout', 'build', 'health', 'smoke'].includes(payload.stage)) {
    return c.json({ error: 'invalid stage' }, 400);
  }

  const now = new Date().toISOString();
  const previous = await getLatestResult(c.env.DB, payload.repo_url);
  await recordResult(c.env.DB, payload, now);

  const statusChanged = !previous || previous.status !== payload.status;
  if (statusChanged) {
    const teams = await listTeams(c.env.DB);
    const team = teams.find((t) => t.repo_url === payload.repo_url);
    const teamLabel = team ? team.team_name : payload.repo_url;
    const emoji = payload.status === 'passed' ? ':white_check_mark:' : payload.status === 'failed' ? ':x:' : ':hourglass_flowing_sand:';
    c.executionCtx.waitUntil(
      postDiscord(
        c.env.DISCORD_WEBHOOK_URL,
        `${emoji} **${teamLabel}** — ${payload.status} at \`${payload.stage}\` (commit \`${shortSha(payload.commit)}\`)${
          payload.detail ? ` — ${payload.detail}` : ''
        }`,
      ),
    );
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin
//
// Cloudflare Access gates these routes at the edge, but that alone isn't
// enough: the Cf-Access-Authenticated-User-Email header it sets is just a
// plain header, forgeable by anyone who can reach the Worker directly (a
// workers.dev URL, or any Access path rule that doesn't match some
// casing/encoding of the request). So every admin route here independently
// verifies the Cf-Access-Jwt-Assertion JWT (or CF_Authorization cookie)
// against Access's public keys and takes the email from its verified
// `email` claim — never from the plain header. See src/admin-auth.ts.
// ---------------------------------------------------------------------------

/** Runs Access JWT verification + the ADMIN_EMAILS allowlist; returns the
 * verified email, or a ready-to-return error response (403/503). */
async function requireAdmin(
  c: Context<{ Bindings: Env }>,
): Promise<{ email: string } | { error: Response }> {
  const result = await authenticateAdmin(c);
  if (!result.ok) return { error: c.json({ error: result.error }, result.status) };
  return { email: result.email };
}

async function renderAdminRoute(c: Context<{ Bindings: Env }>) {
  const auth = await requireAdmin(c);
  if ('error' in auth) return auth.error;
  const { email } = auth;

  const teams = await listTeams(c.env.DB);
  const statusRows = await listRepoStatuses(c.env.DB);
  const statuses = new Map(statusRows.map((s) => [s.repo_url, s]));
  const latestRows = await Promise.all(teams.map((t) => getLatestResult(c.env.DB, t.repo_url)));
  const latestResults = new Map<string, LatestResultRow>();
  teams.forEach((t, i) => {
    const row = latestRows[i];
    if (row) latestResults.set(t.repo_url, row);
  });
  const historyLists = await Promise.all(teams.map((t) => listResultHistory(c.env.DB, t.repo_url, 20)));
  const history = new Map(teams.map((t, i) => [t.repo_url, historyLists[i]]));
  const formLog = await listFormLog(c.env.DB);
  const started = await isCompetitionStarted(c.env.DB);

  return c.html(renderAdminPage({ teams, statuses, latestResults, history, formLog, started, email }));
}

app.get('/admin', renderAdminRoute);

app.post('/admin/staging/:id/delete', async (c) => {
  const auth = await requireAdmin(c);
  if ('error' in auth) return auth.error;

  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'cross-origin request rejected' }, 403);
  }

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

  const teams = await listTeams(c.env.DB, 'staging');
  if (!teams.some((t) => t.id === id)) {
    // Refuse to delete production teams through the staging-purge route.
    return c.json({ error: 'not a staging team' }, 404);
  }

  await deleteTeam(c.env.DB, id);
  return c.redirect('/admin', 303);
});

app.post('/admin/competition-started', async (c) => {
  const auth = await requireAdmin(c);
  if ('error' in auth) return auth.error;

  // CSRF-safe: only accept same-origin submissions (Cloudflare Access's own
  // auth cookie would otherwise make this endpoint a cross-site POST target).
  const origin = c.req.header('Origin');
  if (origin) {
    const requestOrigin = new URL(c.req.url).origin;
    if (origin !== requestOrigin) {
      return c.json({ error: 'cross-origin request rejected' }, 403);
    }
  }

  const contentType = c.req.header('Content-Type') ?? '';
  let started: boolean;
  if (contentType.includes('application/json')) {
    const body = (await c.req.json()) as { started?: boolean };
    started = body.started === true;
  } else {
    const form = await c.req.formData();
    started = form.get('started') === 'true';
  }

  await setSetting(c.env.DB, 'competition_started', started ? 'true' : 'false');
  return c.redirect('/admin', 303);
});

app.get('/admin/roster.csv', async (c) => {
  const auth = await requireAdmin(c);
  if ('error' in auth) return auth.error;
  const teams = await listTeams(c.env.DB);
  return c.text(teamsToCsv(teams), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="c4-roster.csv"',
  });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // The admin-only deployment has no cron trigger configured, but guard
    // anyway in case it's ever wired up by mistake.
    if (env.MODE === 'admin') return;
    ctx.waitUntil(refreshAllRepoStatuses(env));
  },
};

export { app };
