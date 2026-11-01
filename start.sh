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
# Fit small boxes: under ~2.5 GB the box runs a lite profile — the heavy optional roles
# stay out of memory and the earn/comms/invent workers still run inside `loops`.
MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [ "${AGENT_PROFILE:-}" = "lite" ] || { [ "${AGENT_PROFILE:-}" = "" ] && [ "$MEM_MB" -gt 0 ] && [ "$MEM_MB" -lt 2500 ]; }; then
  export AGENT_PROFILE=lite
  export AGENT_SKIP="${AGENT_SKIP:-brain,strategy,resilience}"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=160}"
fi
export AGENT_RUNTIME_DIR="${AGENT_RUNTIME_DIR:-/app}"
export AGENT_BUNDLE_DIR="${AGENT_BUNDLE_DIR:-/app}"
PORT_NUM="${PORT:-8787}"
export AGENT_HTTP_PORT="$PORT_NUM"
echo "start $(date -u) port=$AGENT_HTTP_PORT" > /tmp/boot.log

cd /app || { echo "no /app" >> /tmp/boot.log; exit 1; }
# The fixed core reads its policy from a root-level path; in a container only /app exists.
ln -sfn /app/infrastructure /infrastructure 2>/dev/null || true
# Cap the V8 heap: four instances on a 1 GB box otherwise fill RAM and the cgroup kills them
# mid-work, which is why their workers never reached a 10-minute cadence.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=48}"
AGENT_ROLE=boot node /app/agent.mjs >> /tmp/boot.log 2>&1
echo "boot_exit=$?" >> /tmp/boot.log

while true; do
  AGENT_ROLE=watchdog node /app/agent.mjs >> /tmp/boot.log 2>&1
  echo "watchdog_exit=$?" >> /tmp/boot.log
  sleep 5
done
