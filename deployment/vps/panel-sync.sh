#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/lock/horizon-site-sync.lock
flock -n 9 || exit 0
cd /opt/horizon-site
target="$(git -C source rev-parse HEAD)"
published="$(cat .last-deployed-sha 2>/dev/null || true)"
if [[ "$target" != "$published" ]]; then
  echo "[horizon-panel] awaiting site validation: $target"
  exit 0
fi
previous="$(cat .last-panel-deployed-sha 2>/dev/null || true)"
status="$(docker inspect horizon-orbita-painel --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' 2>/dev/null || true)"
if [[ "$target" == "$previous" && "$status" == "healthy" ]]; then exit 0; fi
old_image="$(docker inspect horizon-orbita-painel --format '{{.Image}}' 2>/dev/null || true)"
echo "[horizon-panel] deploying validated main $target"
if docker compose -f source/deployment/panel/docker-compose.yml build --quiet &&
   docker compose -f source/deployment/panel/docker-compose.yml up --no-deps -d --wait --wait-timeout 100; then
  printf '%s\n' "$target" > .last-panel-deployed-sha
  echo "[horizon-panel] published $target (healthy)"
else
  echo "[horizon-panel] deployment failed; restoring previous image" >&2
  if [[ -n "$old_image" ]]; then
    docker tag "$old_image" horizon-orbita-painel:latest
    docker compose -f source/deployment/panel/docker-compose.yml up --no-deps -d --force-recreate --wait --wait-timeout 100 || true
  fi
  exit 1
fi
