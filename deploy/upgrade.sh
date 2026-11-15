#!/usr/bin/env bash
# Moves the installed Flow-Mapper to a repo tag and restarts it. Also the way to roll back: pass the older tag.
#   sudo deploy/upgrade.sh <tag>
# Migrations run at startup and make their own backup (<db>.pre-NNN.bak) first. They only go forward:
# rolling back across a migration needs that backup or a Litestream restore (docs/OPERATIONS.md).
set -euo pipefail

APP_DIR=/opt/flow-mapper
ENV_FILE=/etc/flow-mapper.env
TAG=${1:-}
[ -n "$TAG" ] || { echo "usage: upgrade.sh <tag>" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "upgrade: run as root (sudo)" >&2; exit 1; }

git_cmd() {
  if [ -f /etc/flow-mapper-deploy-key ]; then GIT_SSH_COMMAND="ssh -i /etc/flow-mapper-deploy-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git "$@"; else git "$@"; fi
}

prev=$(git -C "$APP_DIR" describe --tags --always)
git_cmd -C "$APP_DIR" fetch --quiet --tags --force origin
git -C "$APP_DIR" -c advice.detachedHead=false checkout --quiet "$TAG"
# Keep the unit files in step with the code.
for f in flow-mapper.service litestream.service; do install -m 644 "$APP_DIR/deploy/$f" "/etc/systemd/system/$f"; done
install -m 644 "$APP_DIR/deploy/litestream.yml" /etc/litestream.yml
systemctl daemon-reload
if grep -q '^FLOW_REPO_TAG=' "$ENV_FILE"; then sed -i "s|^FLOW_REPO_TAG=.*|FLOW_REPO_TAG=$TAG|" "$ENV_FILE"; else echo "FLOW_REPO_TAG=$TAG" >> "$ENV_FILE"; fi
systemctl restart flow-mapper.service
systemctl restart litestream.service

for _ in $(seq 1 30); do
  if out=$(curl -fsS http://127.0.0.1/healthz 2>/dev/null); then echo "upgrade: $prev -> $TAG, healthy: $out"; echo "rollback: sudo deploy/upgrade.sh $prev"; exit 0; fi
  sleep 1
done
echo "upgrade: $TAG did not become healthy. Roll back with: sudo deploy/upgrade.sh $prev (see journalctl -u flow-mapper)" >&2
exit 1
