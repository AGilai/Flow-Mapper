#!/usr/bin/env bash
# Installs or repairs Flow-Mapper on an Ubuntu 24.04 host (EC2 user data runs it; so can you, by hand, as root).
# Idempotent: every step checks before it acts, so a second run changes nothing.
#
#   sudo deploy/install.sh [--tag v0.52.0] [--bucket NAME] [--region eu-west-1] [--repo-url URL] [--dry-run]
#
# Settings come from /etc/flow-mapper.env first, then the arguments override them:
#   FLOW_REPO_TAG, FLOW_REPO_URL, FLOW_BACKUP_BUCKET, AWS_REGION,
#   FLOW_DEPLOY_KEY_SECRET_ARN (Secrets Manager secret holding a read-only SSH deploy key; private repos),
#   FLOW_PARAM_NAME (SSM parameter with the Cognito values the stack writes).
# --dry-run prints what would happen and changes nothing (use it on a machine you care about).
set -euo pipefail
export PATH="$PATH:/snap/bin" # cloud-init's PATH lacks it; the aws CLI is a snap

NODE_VERSION=22.21.1      # pinned; official tarball from nodejs.org, checked against SHASUMS256.txt
LITESTREAM_VERSION=0.3.13 # pinned; GitHub release .deb, sha256 below (taken from the release assets on 2026-11-15)
# shellcheck disable=SC2034 # read through an indirect name in install_litestream
LITESTREAM_SHA256_arm64=073aceebd2bbd58213aad2e05fdf4667ff4ca1140d0be6df308859798c74e8e8
# shellcheck disable=SC2034
LITESTREAM_SHA256_amd64=9b05043523c1fb1c4f9800623adf0015683da7fdd55e19b9fe5d28f63fae96b4
ENV_FILE=/etc/flow-mapper.env
APP_DIR=/opt/flow-mapper
DATA_DIR=/var/lib/flow-mapper
DEPLOY_KEY=/etc/flow-mapper-deploy-key
DRY=0

log() { echo "install: $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  + $*"; else "$@"; fi; }
# put FILE MODE: write stdin to FILE (dry run: only say so)
put() { if [ "$DRY" = 1 ]; then echo "  + write $1"; cat >/dev/null; else install -m "$2" /dev/stdin "$1"; fi; }

# --- settings ---------------------------------------------------------------------------------------------------
# shellcheck source=/dev/null
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
TAG=${FLOW_REPO_TAG:-}; BUCKET=${FLOW_BACKUP_BUCKET:-}; REGION=${AWS_REGION:-}; REPO_URL=${FLOW_REPO_URL:-}
while [ $# -gt 0 ]; do
  case $1 in
    --tag) TAG=$2; shift 2 ;;
    --bucket) BUCKET=$2; shift 2 ;;
    --region) REGION=$2; shift 2 ;;
    --repo-url) REPO_URL=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "install: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$TAG" ] || { echo "install: need --tag or FLOW_REPO_TAG in $ENV_FILE" >&2; exit 2; }
[ -n "$BUCKET" ] || { echo "install: need --bucket or FLOW_BACKUP_BUCKET in $ENV_FILE" >&2; exit 2; }
[ -n "$REGION" ] || { echo "install: need --region or AWS_REGION in $ENV_FILE" >&2; exit 2; }
if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then echo "install: run as root (sudo)" >&2; exit 1; fi
SECRET_ARN=${FLOW_DEPLOY_KEY_SECRET_ARN:-}
if [ -z "$REPO_URL" ]; then
  if [ -n "$SECRET_ARN" ]; then REPO_URL=git@github.com:AGilai/Flow-Mapper.git; else REPO_URL=https://github.com/AGilai/Flow-Mapper.git; fi
fi
case $(dpkg --print-architecture) in arm64) NODE_ARCH=arm64 ;; amd64) NODE_ARCH=x64 ;; *) echo "install: unsupported architecture" >&2; exit 1 ;; esac
DEB_ARCH=$(dpkg --print-architecture)

# set_env KEY VALUE [keep]: replace (or with "keep", only add when missing) a KEY=VALUE line in the env file.
set_env() {
  local k=$1 v=$2
  if [ "${3:-}" = keep ] && grep -q "^$k=" "$ENV_FILE" 2>/dev/null; then return; fi
  if [ "$DRY" = 1 ]; then echo "  + $ENV_FILE: $k=$v"; return; fi
  touch "$ENV_FILE"; chmod 644 "$ENV_FILE"
  grep -v "^$k=" "$ENV_FILE" > "$ENV_FILE.new" || true
  echo "$k=$v" >> "$ENV_FILE.new"; mv "$ENV_FILE.new" "$ENV_FILE"
}

# --- packages, Node, Litestream ---------------------------------------------------------------------------------
install_packages() {
  log "packages"
  run apt-get update -qq
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl xz-utils ca-certificates sqlite3 unzip
  if [ -n "$SECRET_ARN$FLOW_PARAM_NAME" ] && ! command -v aws >/dev/null 2>&1; then run snap wait system seed.loaded; run snap install aws-cli --classic; fi
}
install_node() {
  if [ "$(/usr/local/bin/node --version 2>/dev/null || true)" = "v$NODE_VERSION" ]; then log "node v$NODE_VERSION present"; return; fi
  log "node v$NODE_VERSION"
  local base=https://nodejs.org/dist/v$NODE_VERSION f=node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz tmp
  tmp=$(mktemp -d)
  run curl -fsSL -o "$tmp/$f" "$base/$f"
  run curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  if [ "$DRY" = 0 ]; then (cd "$tmp" && grep " $f\$" SHASUMS256.txt | sha256sum -c -); fi
  run tar -xJf "$tmp/$f" -C /usr/local --strip-components=1 --no-same-owner
  run rm -rf "$tmp"
}
install_litestream() {
  if [ "$(dpkg-query -W -f='${Version}' litestream 2>/dev/null || true)" = "$LITESTREAM_VERSION" ]; then log "litestream $LITESTREAM_VERSION present"; return; fi
  log "litestream $LITESTREAM_VERSION"
  local tmp; tmp=$(mktemp -d)
  run curl -fsSL -o "$tmp/ls.deb" "https://github.com/benbjohnson/litestream/releases/download/v$LITESTREAM_VERSION/litestream-v$LITESTREAM_VERSION-linux-$DEB_ARCH.deb"
  local want_var=LITESTREAM_SHA256_$DEB_ARCH
  if [ "$DRY" = 0 ]; then echo "${!want_var}  $tmp/ls.deb" | sha256sum -c -; fi
  # --force-confold: the .deb ships /etc/litestream.yml, which we replace; never stop at a conffile prompt.
  run env DEBIAN_FRONTEND=noninteractive dpkg --force-confold -i "$tmp/ls.deb"
  run rm -rf "$tmp"
  run systemctl disable --now litestream.service 2>/dev/null || true # the .deb ships its own unit; ours replaces it below
}

# --- user, disk, code -------------------------------------------------------------------------------------------
create_user() {
  if id flowmapper >/dev/null 2>&1; then return; fi
  log "user flowmapper"
  run useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin flowmapper
}
# The data volume is a second, empty EBS disk the first time (we label and format it) and is found by its label afterwards.
mount_data_volume() {
  if mountpoint -q "$DATA_DIR" 2>/dev/null; then log "$DATA_DIR mounted"; return; fi
  log "data volume"
  run mkdir -p "$DATA_DIR"
  if [ "$DRY" = 1 ]; then echo "  + wait for the data disk, mkfs.ext4 -L flowdata when it has no filesystem, fstab, mount $DATA_DIR"; return; fi
  local dev="" root
  root=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1)
  for _ in $(seq 1 60); do
    dev=$(blkid -L flowdata 2>/dev/null || true)
    if [ -z "$dev" ]; then # first boot: the one whole disk that is neither the root disk nor formatted
      dev=$(lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | while read -r d; do
        [ "$(basename "$d")" = "$root" ] && continue
        [ -z "$(lsblk -no FSTYPE "$d" | tr -d '[:space:]')" ] && echo "$d" && break
      done || true)
      [ -n "$dev" ] && mkfs.ext4 -q -L flowdata "$dev"
    fi
    [ -n "$dev" ] && break
    sleep 5
  done
  [ -n "$dev" ] || { echo "install: no data volume appeared after 5 minutes" >&2; exit 1; }
  grep -q 'LABEL=flowdata' /etc/fstab || echo "LABEL=flowdata $DATA_DIR ext4 defaults,nofail 0 2" >> /etc/fstab
  mount "$DATA_DIR"
}
git_cmd() { # git with the deploy key when there is one
  if [ -f "$DEPLOY_KEY" ]; then GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git "$@"; else git "$@"; fi
}
fetch_deploy_key() {
  [ -n "$SECRET_ARN" ] && [ ! -f "$DEPLOY_KEY" ] || return 0
  log "deploy key from Secrets Manager"
  if [ "$DRY" = 1 ]; then echo "  + aws secretsmanager get-secret-value -> $DEPLOY_KEY (0600)"; return; fi
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" --query SecretString --output text | install -m 600 /dev/stdin "$DEPLOY_KEY"
  grep -q 'END OPENSSH PRIVATE KEY' "$DEPLOY_KEY" && [ "$(tail -c1 "$DEPLOY_KEY" | wc -l)" = 0 ] && echo >> "$DEPLOY_KEY"
}
checkout_code() {
  log "code $REPO_URL @ $TAG"
  if [ "$DRY" = 1 ]; then echo "  + git clone or fetch --tags in $APP_DIR, checkout $TAG"; return; fi
  if [ ! -d "$APP_DIR/.git" ]; then git_cmd clone --quiet "$REPO_URL" "$APP_DIR"; fi
  git_cmd -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git_cmd -C "$APP_DIR" fetch --quiet --tags --force origin
  git -C "$APP_DIR" -c advice.detachedHead=false checkout --quiet "$TAG"
}

# --- settings file, units, database -----------------------------------------------------------------------------
write_env() {
  log "$ENV_FILE"
  set_env FLOW_BACKUP_BUCKET "$BUCKET"; set_env AWS_REGION "$REGION"; set_env FLOW_REPO_TAG "$TAG"; set_env FLOW_REPO_URL "$REPO_URL"
  [ -z "$SECRET_ARN" ] || set_env FLOW_DEPLOY_KEY_SECRET_ARN "$SECRET_ARN"
  # Part C (auth) reads these. Until it ships the server ignores them, so auth stays off. Switch to cognito only after part C is deployed.
  set_env FLOW_AUTH off keep
}
# The stack publishes the Cognito values in an SSM parameter (the instance is created before the user pool client, so user data cannot
# carry them). CloudFront takes up to ~15 minutes to deploy and the parameter appears after it, so this runs AFTER the app is up
# (auth is off until part C, nothing needs the values yet) and waits up to 30 minutes. A changed env file restarts the app.
fetch_app_env() {
  [ -n "${FLOW_PARAM_NAME:-}" ] || return 0
  if [ "$DRY" = 1 ]; then echo "  + aws ssm get-parameter $FLOW_PARAM_NAME (retries up to 30 minutes until the stack has written it)"; return; fi
  log "Cognito values from SSM $FLOW_PARAM_NAME"
  local frag="" _ before
  for _ in $(seq 1 180); do
    if frag=$(aws ssm get-parameter --region "$REGION" --name "$FLOW_PARAM_NAME" --query Parameter.Value --output text 2>/dev/null); then break; fi
    frag=""; sleep 10
  done
  if [ -z "$frag" ]; then log "warning: SSM parameter $FLOW_PARAM_NAME not readable; run install.sh again later"; return; fi
  before=$(cksum < "$ENV_FILE")
  while IFS='=' read -r k v; do if [ -n "$k" ]; then set_env "$k" "$v"; fi; done <<<"$frag"
  if [ "$(cksum < "$ENV_FILE")" != "$before" ]; then log "settings changed, restarting"; systemctl restart flow-mapper.service; fi
}
install_units() {
  local UNIT_SRC=$APP_DIR/deploy; [ "$DRY" = 1 ] && UNIT_SRC=$(cd "$(dirname "$0")" && pwd)
  log "systemd units"
  put /etc/systemd/system/flow-mapper.service 644 < "$UNIT_SRC/flow-mapper.service"
  put /etc/systemd/system/litestream.service 644 < "$UNIT_SRC/litestream.service"
  put /etc/litestream.yml 644 < "$UNIT_SRC/litestream.yml"
  run systemctl daemon-reload
}
prepare_database() {
  local db=$DATA_DIR/flow-mapper.db
  run chown flowmapper:flowmapper "$DATA_DIR"
  if [ -e "$db" ]; then log "database present"; return; fi
  log "restore from s3://$BUCKET (if a replica exists)"
  run sudo -u flowmapper env FLOW_BACKUP_BUCKET="$BUCKET" AWS_REGION="$REGION" \
    litestream restore -if-db-not-exists -if-replica-exists -config /etc/litestream.yml "$db"
  if [ "$DRY" = 1 ] || [ ! -e "$db" ]; then
    log "no replica: creating an empty database"
    run sudo -u flowmapper env FLOW_DATA_DIR="$DATA_DIR" /usr/local/bin/node --disable-warning=ExperimentalWarning "$APP_DIR/scripts/db-install.ts"
  fi
}
start_services() {
  log "start"
  run systemctl enable --now flow-mapper.service
  run systemctl enable --now litestream.service
  if [ "$DRY" = 1 ]; then echo "  + curl http://127.0.0.1/healthz"; return; fi
  local _
  for _ in $(seq 1 30); do
    if out=$(curl -fsS http://127.0.0.1/healthz 2>/dev/null); then log "healthy: $out"; return; fi
    sleep 1
  done
  echo "install: /healthz did not answer; see journalctl -u flow-mapper" >&2; exit 1
}

FLOW_PARAM_NAME=${FLOW_PARAM_NAME:-}
install_packages
install_node
install_litestream
create_user
mount_data_volume
fetch_deploy_key
checkout_code
write_env
install_units
prepare_database
start_services
fetch_app_env
log "done"
