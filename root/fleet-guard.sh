#!/bin/sh
# Keep the four local agents alive without a human: if a port stops answering, its
# supervisor is gone or wedged, so clear the lock and start it again.
IMG="https://cdn.jsdelivr.net/gh/staccDOTsol/birth-image-runtime@5a92137486d0ca97f8b7ddcf3082e7e95f8d8f17/child-image.tgz"

# 0. A box that was provisioned but never bootstrapped has no node and no image.
#    Install both here so the guard can heal a bare box, not just restart ports on a good one.
if ! command -v node >/dev/null 2>&1; then
  ( cd /tmp && curl -fsSLO https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz \
    && tar xf node-v22.14.0-linux-x64.tar.xz -C /usr/local --strip-components=1 \
    && rm -f node-v22.14.0-linux-x64.tar.xz ) || true
fi
if [ ! -f /app/agent.mjs ]; then
  mkdir -p /app && wget -qO /tmp/guard.tgz "$IMG" && tar xzf /tmp/guard.tgz -C /app && rm -f /tmp/guard.tgz
  echo "$(date -u) image installed" >> /var/log/fleet-guard.log
fi

# playbook scripts import these directly; the brain dies on link without them
if [ ! -d /var/lib/agent/node_modules/@solana/web3.js ]; then
  ( cd /var/lib/agent && npm init -y >/dev/null 2>&1 && npm i --no-audit --no-fund --silent @solana/web3.js @solana/spl-token @solana/kit bs58 @noble/curves @noble/hashes @pump-fun/pump-sdk @jup-ag/lend >/dev/null 2>&1 ) || true
  # every port has its own guest root, so share the one install
  for r in /var/lib/agent /var/lib/agent-8081 /var/lib/agent-8082 /var/lib/agent-8083; do
    [ -d "$r" ] && [ ! -e "$r/node_modules" ] && ln -s /var/lib/agent/node_modules "$r/node_modules" 2>/dev/null
  done
fi

for p in 80 8081 8082 8083; do
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$p/identity")
  [ "$C" = "200" ] && continue
  ROOT="/var/lib/agent"; [ "$p" = "80" ] || ROOT="/var/lib/agent-$p"
  rm -f "$ROOT/supervisor.lock" 2>/dev/null
  setsid nohup env NODE_OPTIONS=--max-old-space-size=64 AGENT_RUNTIME_DIR=/app AGENT_BUNDLE_DIR=/app AGENT_BUNDLE=1 AGENT_BIND=0.0.0.0 AGENT_CLUSTER=mainnet-beta RPC_URL='https://eu.fluxrpc.com?key=671302ff-6865-4139-80ae-1d9e07fb6e6a' AGENT_HTTP_PORT=$p PORT=$p AGENT_GUEST_ROOT=$ROOT AGENT_LOOPS=1 AGENT_IMAGE_URL=$IMG sh /app/start.sh >>/var/log/a$p.log 2>&1 </dev/null &
  echo "$(date -u) restarted $p" >> /var/log/fleet-guard.log
done

# root-side birth worker: builds queue-births a child asked for
[ -x /root/birth-queue.sh ] && /root/birth-queue.sh >/dev/null 2>&1
