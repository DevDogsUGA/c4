# @acm-uga/c4-registry

Cloudflare Worker for the Connect Four hackathon's submission/registration
pipeline: form intake (via a Google Apps Script), roster, arena results,
a public status page, and a private admin console.

See `../../EVENT_PLAN.md` (untracked, local) for the decisions this was
built against, and the shared-interfaces contract it implements exactly.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | liveness check |
| GET | `/` | none | public status page (see below); serves the admin console instead in `MODE=admin` |
| POST | `/api/form` | `X-C4-Signature: hex(HMAC-SHA256(FORM_HMAC_SECRET, rawBody))` | Apps Script form intake |
| GET | `/api/roster` | `Authorization: Bearer $ROSTER_TOKEN` | `?env=staging` returns the staging-only roster instead of production (default) |
| POST | `/api/results` | `Authorization: Bearer $RESULTS_TOKEN` | arena machine result reporting |
| GET | `/admin` | Cloudflare Access, verified JWT (+ optional `ADMIN_EMAILS` allowlist) | full detail, arena history, form log, CSV export |
| POST | `/admin/competition-started` | same as `/admin` | toggles the `settings.competition_started` flag; same-origin only |
| POST | `/admin/staging/:id/delete` | same as `/admin` | purge a staging registration |
| GET | `/admin/roster.csv` | same as `/admin` | CSV export of the (production) roster |

Request/response bodies follow the shared-interfaces contract in
`EVENT_PLAN.md` exactly:

```
GET /api/roster -> { teams: [{ id, team_name, repo_url, members, submitter_email, updated_at }] }
POST /api/form  <- { response_id, submitter_email, team_name, repo_url, members: string[], submitted_at, env? }
POST /api/results <- { repo_url, commit, status: "building"|"passed"|"failed", stage: "checkout"|"build"|"health"|"smoke", detail?, log_tail?, at }
```

`env` on `/api/form` and `/api/roster?env=` is an addition beyond the base
contract for the staging dress-rehearsal (see below); when omitted it
defaults to `production` and the base contract is unaffected.

## Public status page

Lists every **production** team (name, members, repo link, state). Before
`competition_started`: repo reachable / empty / unreachable-or-private.
After: the team's own GitHub Actions status for its default branch
(success/failure/in progress/none). **Arena (`/api/results`) outcomes are
never shown here** — only on `/admin`.

## Staging isolation

The real form and an unrestricted staging copy post to the same Worker with
the same `WORKER_URL`/`FORM_HMAC_SECRET` (same Apps Script code, different
Script Properties — see `apps-script/README.md`). Each submission carries
`env: "production" | "staging"` (from the Apps Script's `FORM_ENV`
property). Staging teams are:

- excluded from the public status page and the default `/api/roster`,
- excluded from the 32-team cap and duplicate-repo checks (scoped per
  `env`, so a staging test repo can reuse a URL independently of prod),
- visible via `/api/roster?env=staging` (same bearer auth) — this is what
  `scripts/staging-e2e.ts` polls,
- shown as a separate section on `/admin`, with a purge button per row.

## Bindings, secrets, and vars

- D1 binding `DB` (database `c4-registry`, id in `wrangler.toml`).
- Secrets (`wrangler secret put <NAME>`, never committed — see
  `.dev.vars.example` for local dev): `FORM_HMAC_SECRET`, `ROSTER_TOKEN`,
  `RESULTS_TOKEN`, `GITHUB_TOKEN`, `DISCORD_WEBHOOK_URL`.
- Var `ADMIN_EMAILS`: optional comma-separated allowlist checked against the
  *verified* Access JWT email claim, on top of Cloudflare Access itself.
- Var `MODE`: see Deployment below. Unset behaves like `public` (admin
  routes are never served) — a safe default, though the top-level
  `wrangler.toml` config for this project's actual deployment
  (`c4.devdogsuga.org`) sets it to `both`.
- Vars `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`: **required wherever admin
  routes are served** (`MODE=admin` or `MODE=both`) — both default to `""`
  in `wrangler.toml`, so admin routes fail closed with 503 until they're
  set at deploy time. Admin routes verify the
  `Cf-Access-Jwt-Assertion` JWT (or `CF_Authorization` cookie) as a real
  RS256-signed Cloudflare Access token — checking its signature against
  Access's public keys, `aud`, `iss`, and `exp`/`nbf` — and take the caller's
  email only from that verified token, never from the plain
  `Cf-Access-Authenticated-User-Email` header (which is otherwise forgeable
  by anyone who can reach the Worker directly). If either var is missing,
  admin routes fail closed with `503 admin not configured` rather than
  trusting any header. To find the values:
  - `ACCESS_TEAM_DOMAIN`: your Zero Trust team domain, e.g.
    `devdogs.cloudflareaccess.com` — Zero Trust dashboard → Settings →
    Custom Pages shows it, or read it off the URL you're redirected to when
    logging in to any Access application for this team.
  - `ACCESS_AUD`: Zero Trust dashboard → Access → Applications → (the
    `/admin*` application) → Overview → **Application Audience (AUD) Tag**.

  Set both at deploy time (they're plain vars, not secrets, but
  deployment-specific so aren't committed):

  ```sh
  wrangler deploy --env admin \
    --var ACCESS_TEAM_DOMAIN:devdogs.cloudflareaccess.com \
    --var ACCESS_AUD:<the-aud-tag>
  ```

  or uncomment and fill in `[env.admin.vars]` (or the top-level `[vars]`
  block, for the `MODE=both` topology) in `wrangler.toml` once the values
  are known.

## Deployment

The chosen topology is a single Worker on the custom domain
**`c4.devdogsuga.org`**, with Cloudflare Access protecting just the
`/admin` path (Access application path: `c4.devdogsuga.org/admin*`) —
everything else stays publicly reachable from the same Worker. This is the
top-level config in `wrangler.toml`: `[[routes]]` already points at
`c4.devdogsuga.org`, and `MODE = "both"`. A two-Worker/workers.dev
alternative also exists (`[env.admin]`) if Access-per-path isn't available;
both are documented below.

### 1. Single Worker on the custom domain (`MODE=both`, top-level config)

```sh
wrangler d1 migrations apply c4-registry --remote   # once, and after schema changes
wrangler secret put FORM_HMAC_SECRET
wrangler secret put ROSTER_TOKEN
wrangler secret put RESULTS_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put DISCORD_WEBHOOK_URL
wrangler deploy \
  --var ACCESS_TEAM_DOMAIN:devdogs.cloudflareaccess.com \
  --var ACCESS_AUD:<the-aud-tag>
```

(Or fill `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` into the top-level `[vars]`
block in `wrangler.toml` directly and just run `wrangler deploy`.) Put a
Cloudflare Access application on `c4.devdogsuga.org/admin*` — that
application's Overview page has the AUD tag for `ACCESS_AUD` above.

### 2. Two Workers on workers.dev (`MODE=public` / `MODE=admin`)

Access on workers.dev can only protect a whole hostname, not a path, so
deploy the same script twice, sharing the D1 database:

```sh
# Public worker: c4-registry.<subdomain>.workers.dev
wrangler deploy --var MODE:public
wrangler secret put FORM_HMAC_SECRET
wrangler secret put ROSTER_TOKEN
wrangler secret put RESULTS_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put DISCORD_WEBHOOK_URL

# Admin worker: c4-registry-admin.<subdomain>.workers.dev
wrangler deploy --env admin \
  --var ACCESS_TEAM_DOMAIN:devdogs.cloudflareaccess.com \
  --var ACCESS_AUD:<the-aud-tag>
wrangler secret put ROSTER_TOKEN --env admin
wrangler secret put RESULTS_TOKEN --env admin   # only needed if /admin ever reads results directly; harmless either way
wrangler secret put GITHUB_TOKEN --env admin
wrangler secret put DISCORD_WEBHOOK_URL --env admin
wrangler secret put FORM_HMAC_SECRET --env admin
```

Then put a Cloudflare Access application in front of the entire
`c4-registry-admin.<subdomain>.workers.dev` host, and leave
`c4-registry.<subdomain>.workers.dev` public. The admin worker serves the
admin console at **both** `/` and `/admin` (it has no other routes); the
public worker 404s on `/admin*`; the public worker owns the cron trigger
(`[env.admin]` explicitly disables it).

Secrets must be set on whichever Worker(s) you actually deploy; both need
the D1 migrations applied once (they share the same database, so only run
migrations once regardless of topology).

## Local development

```sh
cp .dev.vars.example .dev.vars   # then edit with local-only values
wrangler d1 migrations apply c4-registry --local
pnpm dev            # wrangler dev --local, http://localhost:8787
```

## Tests

```sh
pnpm test           # vitest workspace: Worker tests (@cloudflare/vitest-pool-workers,
                     # real D1 via miniflare) + Apps Script pure-function tests (plain Node)
pnpm run typecheck  # tsc for src/ and scripts/
```

Coverage: HMAC signature verification, repo URL normalization, upsert/edit
identity-by-email semantics, the 32-team cap, duplicate-repo rejection,
`/api/roster` auth and shape, `/api/results` auth + status-change Discord
notification (mocked fetch), cron repo-status refresh against a mocked
GitHub API, the public status page pre/post competition start (and that it
never leaks arena results), `/admin` auth requirements, CSRF rejection on
`/admin/competition-started`, staging isolation, and `MODE` routing.

## Staging end-to-end check

Once a staging form exists (see `apps-script/README.md`):

```sh
STAGING_FORM_ID=... STAGING_ENTRY_TEAM=... STAGING_ENTRY_REPO=... \
STAGING_ENTRY_MEMBERS=... STAGING_ENTRY_EMAIL=... \
WORKER_URL=https://REGISTRY_HOST ROSTER_TOKEN=... \
pnpm run staging-e2e
```

Submits one form response over HTTP, then polls
`GET /api/roster?env=staging` for up to 60s until the team appears.

## Migrations

Schema lives in `migrations/`. Apply with:

```sh
wrangler d1 migrations apply c4-registry --local    # local dev
wrangler d1 migrations apply c4-registry --remote    # production/staging D1 (same DB either topology)
```

## Known risks / open items

- **UGA Workspace may block "Anyone" web-app access** for the Apps Script
  `doGet` backup roster; fall back to "Anyone within the organization" (see
  `apps-script/README.md`) or the manual CSV export from `/admin`.
- **UGA Workspace may block external `UrlFetchApp` calls** from Apps
  Script entirely, depending on admin console settings — verify with a
  real submission well before the event, not just the staging form.
- `repo_status` is keyed only by `repo_url`; if a staging team and a
  production team ever share the exact same repo URL, their cron-refreshed
  reachability/Actions rows collide. Unlikely in practice (staging uses
  throwaway repos) but not defended against.
- The GitHub REST cron refresh doesn't use ETags/conditional requests yet,
  so ~32 repos × up to 3 calls each (repo, commit, optionally Actions
  runs) every 2 minutes is within GitHub's authenticated rate limit
  (5000/hr) but leaves little headroom if the token is shared with other
  event-day automation.
