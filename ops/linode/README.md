# Arena ops runbook

Everything needed to stand up, run, and tear down the tournament box: a
64-core / 128 GB Dedicated CPU Linode running Ubuntu 24.04, provisioned by
[`cloud-init.yaml`](./cloud-init.yaml). Read [EVENT_PLAN.md](../../EVENT_PLAN.md)
(local-only, gitignored) for the decisions behind this; this file is just the
"how to actually run it" steps.

## 1. Create the Linode

1. Create a **Dedicated CPU** Linode: 64 vCPU / 128 GB (Linode "Dedicated
   64GB" tier or larger -- pick the 64-core SKU), Ubuntu 24.04, in a region
   close to the venue.
2. Under **Advanced Options -> User Data**, paste the contents of
   `cloud-init.yaml` verbatim (Linode's User Data field takes cloud-config
   directly).
3. Boot it. SSH in as `root` (or whatever the Linode UI gives you) and watch
   provisioning finish:

   ```
   cloud-init status --wait
   ```

   This takes a while the first time -- it's installing Docker, Node, pnpm,
   cloning both repos, running `pnpm install && pnpm build`, and pre-pulling
   ~12 base Docker images. Budget 5-10 minutes on a fresh box with good
   bandwidth.

4. Check the log for anything that failed non-fatally (clone skipped because
   the token wasn't set yet is expected on first boot -- see step 2 below):

   ```
   less /var/log/cloud-init-output.log
   ```

## 2. Fill in `/etc/c4/env`

`cloud-init.yaml` writes `/etc/c4/env` with placeholder values (mode 0600,
owned by `c4`). As root:

```
editor /etc/c4/env
```

Fill in every `REPLACE_ME`:

| Var | Where it comes from |
|---|---|
| `C4_REPO_TOKEN` | Fine-grained GitHub PAT, `contents: read` on `DevDogsUGA/c4` only |
| `WORKER_URL` | `c4-registry` Worker's deployed URL |
| `C4_ROSTER_TOKEN` | From the Worker's `ROSTER_TOKEN` secret |
| `RESULTS_TOKEN` | From the Worker's `RESULTS_TOKEN` secret |
| `BACKUP_ROSTER_URL` | The Apps Script web app's `/exec` URL |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook |
| `GITHUB_TOKEN` | Any PAT with public read access (rate-limit headroom) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | R2 API token scoped to the bundle bucket |

See [`env.example`](./env.example) for the full list including arena-watch's
own tuning knobs (`C4_WATCH_POLL_INTERVAL_MS`, `C4_WATCH_CONCURRENCY`, etc.)
and `PRESENTER_ORIGIN`.

**If the private repo clone was skipped on first boot** (because
`C4_REPO_TOKEN` wasn't set yet), clone it now:

```
sudo -u c4 -H bash -c '
  set -euo pipefail
  . /etc/c4/env
  cd /opt/c4
  git -c credential.helper="!f() { echo username=x-access-token; echo password=$C4_REPO_TOKEN; }; f" \
    clone https://github.com/DevDogsUGA/c4.git c4
  cd c4 && pnpm install --frozen-lockfile && pnpm build
'
```

The token is passed through a one-shot git credential helper so it's never
written into `.git/config` or left in shell history on disk.

## 3. Deploy / hotfix path

Any time code changes (before or *during* the event -- this is the hotfix
path):

```
sudo -u c4 -H /opt/c4/c4/ops/linode/deploy.sh
```

This pulls both repos (`--ff-only`, so it refuses to silently discard local
commits), reinstalls, rebuilds, and restarts `c4-watch.service`. It prints
the resulting commit SHAs, tool versions, and service status at the end --
paste that into the ops channel after every hotfix so everyone knows what's
live.

If `c4-hackathon` (templates repo) changes, teams pull it themselves; the
arena box only needs its own copy for template reference / local rehearsal,
not for validating team submissions (those clone from the team's own repo).

## 4. T-30 / T-15 / T-5 validation runs

```
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-tminus "T-30"
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-tminus "T-15"
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-tminus "T-5"
```

Each run: refreshes the roster (worker + backup, diffed -- see below),
`validate --json`s every team (checkout -> build -> health -> smoke), posts
each result to `/api/results`, prints a pass/fail table, and posts a summary
to Discord. **Announce failures to the room immediately** -- this is exactly
what it's for. Exits non-zero if anything failed, so you can wire it into a
terminal bell / notification if you want.

## 5. Roster fallback paths

`bin/c4-roster` is the single source of truth all the other scripts call
first. It always tries the Worker (`GET /api/roster`) and cross-checks
against the Apps Script backup (`doGet?token=...`), warning about any team
present in one but not the other -- that's usually a signal the Worker's D1
write failed for a late submission.

- **Worker down, backup up:** `c4-roster` already falls back automatically;
  no action needed, but a `WARN: worker unavailable` line will show up --
  check the Worker's health (`wrangler tail`).
- **Both down (rare -- e.g. Google/Cloudflare outage):** last resort, export
  the Google Form's response sheet as CSV and import it directly:

  ```
  ops/linode/bin/c4-roster --source csv /path/to/responses.csv
  ```

  Expects `team_name,repo_url[,members...]` columns (header row optional,
  auto-detected).

## 6. Freeze

Once submissions close:

```
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-freeze
```

Refreshes the roster, then runs `c4 freeze` to pin every team to their
current commit. Writes a **timestamped** lock file
(`/var/lib/c4/locks/lock-<UTC timestamp>.json`) and updates a `latest.json`
symlink -- old locks are never overwritten, so if you need to re-freeze
after fixing a late-breaking issue you can always diff against the previous
one.

## 7. Run the tournament

```
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-tournament            # uses locks/latest.json
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-tournament /path/to/lock-XXXX.json   # explicit lock
```

Runs `run-tournament --lock ... --bundle ... --upload-r2`, then prints:

- The **presenter URL** (`<PRESENTER_ORIGIN>/?bundle=<encoded presigned R2
  URL>`) -- open this on the projector machine.
- The **scp fallback**: if the venue has no outbound path from the projector
  machine to R2 (or R2 upload itself failed -- the script degrades
  gracefully and tells you), `scp` the bundle down and use the presenter's
  folder picker instead.

Each run gets its own timestamped output dir under
`/var/lib/c4/tournaments/run-<stamp>/` (match-record JSONs + `bundle.json` +
the raw CLI log) so a bad run never clobbers a good one.

## 8. Self-test

Before the event, and any time you're unsure the box is healthy:

```
sudo -u c4 -H /opt/c4/c4/ops/linode/bin/c4-selftest
```

Runs the monorepo's full suite including the Docker-backed ones that don't
run in CI (`C4_DOCKER_TESTS=1 pnpm -C apps/match-engine test`), the samples
conformance check, and a 32-team dress rehearsal, and reports timings for
each. A rehearsal that's slow here is a signal to raise `--concurrency` down
or check for CPU throttling before the real thing.

## 9. `c4-watch` (continuous polling during the event)

`c4-watch.service` runs `apps/arena-watch` under systemd
(`Restart=always`), but only does anything when `C4_WATCH_ENABLED=1` in
`/etc/c4/env` -- leave it at `0` until the submission window actually opens
so it's not chewing CPU or spamming Discord during setup and rehearsal.

```
# flip it on
sudo sed -i 's/^C4_WATCH_ENABLED=.*/C4_WATCH_ENABLED=1/' /etc/c4/env
sudo systemctl restart c4-watch.service

# watch it
journalctl -u c4-watch -f -o cat | jq .

# flip it off
sudo sed -i 's/^C4_WATCH_ENABLED=.*/C4_WATCH_ENABLED=0/' /etc/c4/env
sudo systemctl restart c4-watch.service
```

It polls the roster every ~60s (`C4_WATCH_POLL_INTERVAL_MS`), does a
lightweight `git ls-remote <repo> HEAD` per team (no GitHub API, no rate
limits) with bounded concurrency (`C4_WATCH_CONCURRENCY`, default 4), and on
any new commit: posts `building` to `/api/results`, runs `validate --json`
for that one team, posts the outcome, and notifies Discord on status change.
State (last-seen commit per team) persists to
`/var/lib/c4/arena-watch-state.json` so a service restart doesn't re-build
everything from scratch.

## 10. Teardown

**Delete the Linode when the event is over.** A powered-off instance still
bills at the full hourly rate -- there is no "stopped, not billing" state on
Linode. From the Linode UI or CLI:

```
linode-cli linodes delete <linode-id>
```

Before deleting, grab anything you want to keep:

```
scp -r c4@<box-ip>:/var/lib/c4/tournaments ./tournament-archive
scp -r c4@<box-ip>:/var/lib/c4/locks ./lock-archive
```

(The tournament bundle itself also lives in R2 if `--upload-r2` succeeded --
that survives the Linode's deletion independently.)

## Troubleshooting

- **`cloud-init status --wait` hangs / errors:** check
  `/var/log/cloud-init-output.log`. Most likely cause: Docker's apt repo or
  NodeSource's setup script timed out -- re-run `cloud-init single --name
  runcmd` after confirming network is up, or just re-provision (delete +
  recreate the Linode; cloud-init is not designed to be re-run idempotently
  mid-boot).
- **`deploy.sh` fails with "not a fast-forward":** someone force-pushed or
  the box has local commits. On the box: `git -C /opt/c4/c4 log
  origin/main..HEAD` to see what's local-only; if it's nothing you need,
  `git -C /opt/c4/c4 reset --hard origin/main` (as `c4`) and re-run
  `deploy.sh`.
- **`c4-watch.service` won't start / keeps restarting:** `journalctl -u
  c4-watch -n 100 --no-pager`. Common causes: `/etc/c4/env` still has a
  `REPLACE_ME` in a var the service actually requires
  (`WORKER_URL`/`C4_ROSTER_TOKEN`/`RESULTS_TOKEN` when
  `C4_WATCH_ENABLED=1`), or `apps/arena-watch/dist` doesn't exist yet
  (`pnpm build` didn't run -- re-run `deploy.sh`).
- **`c4-tminus` / `c4-tournament` can't reach the engine:** confirm
  `C4_ENGINE_BIN` in `/etc/c4/env` points at a real, built file:
  `/opt/c4/c4/apps/match-engine/dist/cli.js`. If it's missing, `pnpm build`
  didn't run in `/opt/c4/c4` -- run `deploy.sh`.
- **Docker build is slow on event day:** confirm the base images actually
  got pre-pulled (`docker images`); if cloud-init's pull step failed for one
  (transient registry blip), pull it by hand -- see the image list in
  `cloud-init.yaml`'s `runcmd`.
- **Roster looks stale / missing a team:** `c4-roster` warns about
  worker/backup mismatches on stderr -- check that output first. If both
  sources genuinely lack a team, that team's form submission didn't reach
  either the Worker or the sheet; use the CSV fallback (§5) as a stopgap
  while investigating.
- **Discord notifications stop appearing:** `DISCORD_WEBHOOK_URL` failures
  are logged but never fatal (by design -- a dead webhook shouldn't take
  down validation or the tournament). Check `journalctl -u c4-watch` or the
  relevant script's stderr for `WARN: discord post failed`.
