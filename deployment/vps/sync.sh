#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/lock/horizon-site-sync.lock
flock -n 9 || exit 0
cd /opt/horizon-site
git -C source fetch -q --depth=1 origin main
target="$(git -C source rev-parse FETCH_HEAD)"
previous="$(cat .last-deployed-sha 2>/dev/null || echo '')"
if [[ "$target" == "$previous" ]]; then exit 0; fi
echo "[horizon-site] main: $target"
old="$(git -C source rev-parse HEAD)"
git -C source reset --hard -q "$target"
if docker compose -f source/deployment/vps/docker-compose.yml build --quiet &&
   docker compose -f source/deployment/vps/docker-compose.yml up --no-deps -d --wait --wait-timeout 100; then
  printf '%s\n' "$target" > .last-deployed-sha
  echo "[horizon-site] published: $target"
else
  echo "[horizon-site] deployment failed; restoring $old"
  git -C source reset --hard -q "$old"
  docker compose -f source/deployment/vps/docker-compose.yml build --quiet &&
  docker compose -f source/deployment/vps/docker-compose.yml up --no-deps -d --wait --wait-timeout 100 || true
  exit 1
fi
