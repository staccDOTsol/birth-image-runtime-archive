#!/bin/sh
# Guest entrypoint. Everything that needs shell variables lives here, not in the compose,
# because docker-compose interpolates $ in the YAML before the container ever runs.
set -u
# The image is one bundle: roles are selected by AGENT_ROLE inside agent.mjs, not by
# per-role .mjs files. Without this the watchdog spawns paths that do not exist.
export AGENT_BUNDLE=1
# Deploys come from the image; a boot-time self-update silently replaced fixes with an
# older CDN bundle, so it is off unless a box explicitly opts in.
export AGENT_SELF_UPDATE="${AGENT_SELF_UPDATE:-0}"
export AGENT_BIND="${AGENT_BIND:-0.0.0.0}"
export AGENT_RUNTIME_DIR="${AGENT_RUNTIME_DIR:-/app}"
export AGENT_BUNDLE_DIR="${AGENT_BUNDLE_DIR:-/app}"
PORT_NUM="${PORT:-8787}"
export AGENT_HTTP_PORT="$PORT_NUM"
echo "start $(date -u) port=$AGENT_HTTP_PORT" > /tmp/boot.log

cd /app || { echo "no /app" >> /tmp/boot.log; exit 1; }
# The fixed core reads its policy from a root-level path; in a container only /app exists.
ln -sfn /app/infrastructure /infrastructure 2>/dev/null || true
# One supervisor per guest root. Without this, every relaunch adds another `while true`
# and the box ends up with dozens of orphaned node processes fighting over ~1 GB until
# the kernel OOMs them all (watchdog_exit=137).
LOCK="${AGENT_GUEST_ROOT:-/var/lib/agent}/supervisor.lock"
mkdir -p "$(dirname "$LOCK")" 2>/dev/null || true
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null && grep -qa "start.sh" "/proc/$(cat "$LOCK" 2>/dev/null)/cmdline" 2>/dev/null; then
  echo "supervisor already alive pid=$(cat "$LOCK")" >> /tmp/boot.log
  exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM
# always take the published image, not whatever happens to be on disk from a previous boot
# per-port temp paths: four instances booting in parallel used to share /tmp/img.tgz and
# corrupt each other mid-untar, which is why boxes kept losing random ports
echo "image $(date -u) ${AGENT_IMAGE_URL:-}" >> /tmp/boot.log
if [ -n "${AGENT_IMAGE_URL:-}" ]; then
  TMPIMG="/tmp/img-$PORT_NUM.tgz"
  wget -qO "$TMPIMG" "$AGENT_IMAGE_URL" && tar xzf "$TMPIMG" -C /app && echo "image_ok $(date -u)" >> /tmp/boot.log || echo "image_fail $(date -u)" >> /tmp/boot.log
  rm -f "$TMPIMG" 2>/dev/null || true
fi
# Cap the V8 heap: four instances on a 1 GB box otherwise fill RAM and the cgroup kills them
# mid-work, which is why their workers never reached a 10-minute cadence.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=48}"
AGENT_ROLE=boot node /app/agent.mjs >> /tmp/boot.log 2>&1
echo "boot_exit=$?" >> /tmp/boot.log

# Back off on repeated crashes: a box that cannot fit another worker should stop
# spawning them instead of OOM-killing in a tight loop all night.
fails=0
while true; do
  started=$(date +%s)
  AGENT_ROLE=watchdog node /app/agent.mjs >> /tmp/boot.log 2>&1
  code=$?
  ran=$(( $(date +%s) - started ))
  if [ "$ran" -lt 60 ]; then fails=$(( fails + 1 )); else fails=0; fi
  echo "watchdog_exit=$code ran=${ran}s fails=$fails $(date -u)" >> /tmp/boot.log
  if [ "$fails" -ge 5 ]; then
    echo "too many fast crashes; sleeping 120s $(date -u)" >> /tmp/boot.log
    sleep 120
    fails=0
  else
    sleep 10
  fi
done
