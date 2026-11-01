// A child's own successor: the compose it hands to a provider when it pays for its next
// machine. Keeps lineage in the environment so the new birth records its parent.
import * as R from './rpc.mjs';

export function childCompose({ imageUrl, parentBirthId, parentSolana, extraEnv = {} }) {
  const env = {
    AGENT_RUNTIME_DIR: '/app',
    AGENT_BUNDLE_DIR: '/app',
    AGENT_GUEST_ROOT: '/var/lib/agent',
    AGENT_BUNDLE: '1',
    AGENT_HTTP_PORT: '8787',
    AGENT_BIND: '0.0.0.0',
    AGENT_CLUSTER: 'mainnet-beta',
    RPC_URL: R.RPC_URL,
    AGENT_PARENT_BIRTH_ID: parentBirthId || '',
    AGENT_PARENT_SOLANA: parentSolana || '',
    ...extraEnv,
  };
  const envLines = Object.entries(env).map(([k, v]) => `      ${k}: "${String(v).replace(/"/g, '\\"')}"`).join('\n');
  return `services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
${envLines}
    command:
      - sh
      - -c
      - |
        set -e
        mkdir -p /app /var/lib/agent
        wget -qO /tmp/img.tgz "${imageUrl}"
        tar xzf /tmp/img.tgz -C /app
        cd /app && AGENT_ROLE=boot node /app/agent.mjs
        while true; do env AGENT_ROLE=watchdog node /app/agent.mjs; sleep 5; done
`;
}
