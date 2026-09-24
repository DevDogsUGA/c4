#!/usr/bin/env bash
# Hotfix path: pull the latest of both repos, rebuild, restart c4-watch.
# Runs ON THE ARENA BOX, as the c4 user:
#
#   sudo -u c4 -H /opt/c4/c4/ops/linode/deploy.sh
#
# (or, once checked out: ssh c4@arena 'ops/linode/deploy.sh')
set -euo pipefail

if [ "$(id -un)" != "c4" ]; then
  echo "deploy.sh must run as the c4 user (got: $(id -un)). Use: sudo -u c4 -H $0" >&2
  exit 1
fi

C4_DIR=/opt/c4/c4
HACKATHON_DIR=/opt/c4/c4-hackathon
ENV_FILE=/etc/c4/env

if [ -r "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

echo "== c4 deploy: $(date -u +%FT%TZ) =="

if [ ! -d "$C4_DIR/.git" ]; then
  echo "FATAL: $C4_DIR is not a git checkout. Run the clone step from cloud-init.yaml first." >&2
  exit 1
fi

echo "-- pulling $C4_DIR (private) --"
git -C "$C4_DIR" pull --ff-only

if [ -d "$HACKATHON_DIR/.git" ]; then
  echo "-- pulling $HACKATHON_DIR (public) --"
  git -C "$HACKATHON_DIR" pull --ff-only
else
  echo "WARN: $HACKATHON_DIR not cloned, skipping (templates won't be refreshed)" >&2
fi

echo "-- pnpm install --"
cd "$C4_DIR"
pnpm install --frozen-lockfile

echo "-- pnpm build --"
pnpm build

echo "-- restarting c4-watch.service --"
if command -v sudo >/dev/null 2>&1 && sudo -n systemctl restart c4-watch.service 2>/dev/null; then
  :
else
  echo "WARN: could not restart c4-watch.service as c4 (need passwordless sudo for systemctl, or run as root: systemctl restart c4-watch)" >&2
fi

echo "== versions =="
echo "c4 commit:           $(git -C "$C4_DIR" rev-parse --short HEAD) ($(git -C "$C4_DIR" log -1 --format=%cI))"
if [ -d "$HACKATHON_DIR/.git" ]; then
  echo "c4-hackathon commit:  $(git -C "$HACKATHON_DIR" rev-parse --short HEAD) ($(git -C "$HACKATHON_DIR" log -1 --format=%cI))"
fi
echo "node:                 $(node --version)"
echo "pnpm:                 $(pnpm --version)"
echo "docker:               $(docker --version)"
echo "c4-watch.service:     $(systemctl is-active c4-watch.service 2>/dev/null || echo unknown)"

echo "== deploy complete =="
