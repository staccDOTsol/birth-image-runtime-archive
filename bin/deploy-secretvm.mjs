// Provision a confidential VM on SecretVM (Secret Network, TDX) and hand it the same
// guest image. Wallet-authenticated with x-agent headers; the VM is paid from the
// agent's x402 balance. Multipart signature is a stable JSON of fields + file metadata.
// usage: node bin/deploy-secretvm.mjs [vmTypeId]
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { RUNTIME_DIR, P } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

import { compose as guestCompose } from './deploy-child.mjs';
const BASE = process.env.SECRETVM_BASE || 'https://secretai.scrtlabs.com';
const vmTypeId = process.argv[2] || 'small';
const imageUrl = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/n1tpt9.tgz';
J.openJournal();

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function compose() {
  const IMG = imageUrl;
  const cmd = "mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz " + IMG + " && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh";
  return [
    "version: \"3.8\"",
    "services:",
    "  agent:",
    "    image: node:22-alpine",
    "    restart: unless-stopped",
    "    ports:",
    "      - \"80:8787\"",
    "    environment:",
    "      AGENT_RUNTIME_DIR: /app",
    "      AGENT_BUNDLE_DIR: /app",
    "      AGENT_BUNDLE: \"1\"",
    "      AGENT_BIND: 0.0.0.0",
    "      AGENT_CLUSTER: mainnet-beta",
    "      AGENT_HTTP_PORT: \"8787\"",
    "      EARN_MIN_LAUNCH_LAMPORTS: \"8000000\"",
    "      AGENT_IMAGE_URL: " + IMG,
    "      RPC_URL: " + (process.env.RPC_URL || ''),
    "    command: [\"sh\", \"-c\", \"" + cmd.replace(/\"/g, String.fromCharCode(39)) + "\"]",
  ].join("\n") + "\n";
}

async function authHeaders(bodyForSig) {
  const id = await S.identity();
  const ts = String(Date.now());
  const hashHex = crypto.createHash('sha256').update(bodyForSig ? `POST${'/api/vm/create'}${bodyForSig}${ts}` : '').digest('hex');
  return { id, ts, hashHex };
}

const yml = compose();
const fileBytes = Buffer.from(yml, 'utf8');
const fields = { name: `birth-child-${Math.floor(now() / 60)}`, vmTypeId, skip_launch: '0' };
const file = { fieldname: 'dockercompose', originalname: 'docker-compose.yml', mimetype: 'application/x-yaml', size: fileBytes.length, sha256: crypto.createHash('sha256').update(fileBytes).digest('hex') };
const bodyForSig = stable({ fields, file });

const id = await S.identity();
const ts = String(Date.now());
const payload = `POST/api/vm/create${bodyForSig}${ts}`;
const sig = await S.signEvmHash(crypto.createHash('sha256').update(payload).digest('hex'));

const form = new FormData();
for (const [k, v] of Object.entries(fields)) form.append(k, v);
form.append('dockercompose', new Blob([fileBytes], { type: 'application/x-yaml' }), 'docker-compose.yml');

const r = await fetch(BASE + '/api/vm/create', {
  method: 'POST',
  headers: {
    'x-agent-address': id.evm.address,
    'x-agent-timestamp': ts,
    'x-agent-signature': sig.signature.startsWith('0x') ? sig.signature : `0x${sig.signature}`,
  },
  body: form,
});
const text = await r.text();
const rec = { at: now(), provider: 'secretvm', vmTypeId, status: r.status, body: text.slice(0, 600), signature_hash: crypto.createHash('sha256').update(payload).digest('hex') };
try { rec.json = JSON.parse(text); } catch {}
await J.append('procreation.secretvm_create', rec);
console.log(JSON.stringify(rec));
