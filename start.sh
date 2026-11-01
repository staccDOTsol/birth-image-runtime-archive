#!/bin/sh
# Guest entrypoint. Everything that needs shell variables lives here, not in the compose,
# because docker-compose interpolates $ in the YAML before the container ever runs.
set -u
PORT_NUM="${PORT:-8787}"
export AGENT_HTTP_PORT="$PORT_NUM"
echo "start $(date -u) port=$AGENT_HTTP_PORT" > /tmp/boot.log

cd /app || { echo "no /app" >> /tmp/boot.log; exit 1; }
AGENT_ROLE=boot node /app/agent.mjs >> /tmp/boot.log 2>&1
echo "boot_exit=$?" >> /tmp/boot.log

while true; do
  AGENT_ROLE=watchdog node /app/agent.mjs >> /tmp/boot.log 2>&1
  echo "watchdog_exit=$?" >> /tmp/boot.log
  sleep 5
done
