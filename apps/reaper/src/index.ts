// c4-reaper: a dead-man's switch for the arena Linode. Every 5 minutes it
// lists Linodes tagged TAG; warns on Discord 60 and 15 minutes before
// DEADLINE, and deletes them once DEADLINE has passed. GET /status shows
// the plan; POST /run (Bearer RUN_TOKEN) runs a check immediately.

interface Env {
  TAG: string;
  DEADLINE: string;
  LINODE_TOKEN: string;
  DISCORD_WEBHOOK_URL?: string;
  RUN_TOKEN?: string;
}

interface Linode {
  id: number;
  label: string;
  type: string;
  status: string;
  created: string;
}

const API = 'https://api.linode.com/v4';
// Cron fires every 5 minutes, so each warning lands in exactly one run.
const WARNINGS_MIN = [60, 15];
const CRON_PERIOD_MIN = 5;

async function linodeFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.LINODE_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Filter': JSON.stringify({ tags: env.TAG }),
      ...(init.headers ?? {}),
    },
  });
}

async function taggedLinodes(env: Env): Promise<Linode[]> {
  const res = await linodeFetch(env, '/linode/instances?page_size=100');
  if (!res.ok) throw new Error(`list linodes: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: Linode[] };
  // X-Filter on tags is exact-match on any tag; double-check client-side.
  return body.data;
}

async function discord(env: Env, content: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  }).catch(() => undefined);
}

function describe(ls: Linode[]): string {
  return ls.map((l) => `\`${l.label}\` (${l.type}, id ${l.id})`).join(', ');
}

async function check(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  const deadline = Date.parse(env.DEADLINE);
  if (Number.isNaN(deadline)) throw new Error(`bad DEADLINE: ${env.DEADLINE}`);
  const linodes = await taggedLinodes(env);
  const minutesLeft = (deadline - now) / 60_000;

  if (linodes.length === 0) return { action: 'none', reason: 'no tagged linodes', minutesLeft };

  if (minutesLeft <= 0) {
    const results: Record<string, number> = {};
    for (const l of linodes) {
      const res = await linodeFetch(env, `/linode/instances/${l.id}`, { method: 'DELETE' });
      results[l.label] = res.status;
    }
    const ok = Object.values(results).every((s) => s === 200);
    await discord(
      env,
      ok
        ? `:wastebasket: **c4-reaper** deleted ${describe(linodes)}: deadline ${env.DEADLINE} passed.`
        : `:rotating_light: **c4-reaper** FAILED to delete some Linodes past the deadline: ${JSON.stringify(results)}. Delete manually NOW.`,
    );
    return { action: 'delete', results };
  }

  for (const w of WARNINGS_MIN) {
    if (minutesLeft <= w && minutesLeft > w - CRON_PERIOD_MIN) {
      await discord(
        env,
        `:alarm_clock: **c4-reaper** will DELETE ${describe(linodes)} in ~${Math.ceil(minutesLeft)} min (at ${env.DEADLINE}). ` +
          'Upload results to R2 now. To extend: `wrangler deploy --var DEADLINE:<iso>` in apps/reaper.',
      );
      return { action: 'warn', warning: w, minutesLeft };
    }
  }
  return { action: 'wait', minutesLeft, linodes: linodes.map((l) => l.label) };
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      check(env).catch((err) =>
        discord(env, `:rotating_light: **c4-reaper** check failed: ${String(err).slice(0, 300)}`),
      ),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/status') {
      const deadline = Date.parse(env.DEADLINE);
      return Response.json({ tag: env.TAG, deadline: env.DEADLINE, minutesLeft: Math.round((deadline - Date.now()) / 60_000) });
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      if (!env.RUN_TOKEN || req.headers.get('Authorization') !== `Bearer ${env.RUN_TOKEN}`) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        return Response.json(await check(env));
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
