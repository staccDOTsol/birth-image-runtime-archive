// Guest paths. The spec names Linux roots; this guest runs on the host at GUEST_ROOT,
// with the same tree shape so a Linux/TEE build is a path remap, not a rewrite.
//   /opt/agent/birth-image -> <bundle>            (read only core)
//   /var/lib/agent          -> <guest>/var/lib/agent
//   /run/agent              -> <guest>/run/agent
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const RUNTIME_DIR = process.env.AGENT_RUNTIME_DIR
  || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const BUNDLE_DIR = process.env.AGENT_BUNDLE_DIR
  || (process.env.AGENT_BUNDLE === '1' ? RUNTIME_DIR : path.resolve(RUNTIME_DIR, '..'));
export const GUEST_ROOT = process.env.AGENT_GUEST_ROOT || path.join(BUNDLE_DIR, 'guest');

export const P = {
  bundle: BUNDLE_DIR,
  runtime: RUNTIME_DIR,
  guest: GUEST_ROOT,
  state: path.join(GUEST_ROOT, 'var', 'lib', 'agent'),
  run: path.join(GUEST_ROOT, 'run', 'agent'),
  policy: path.join(BUNDLE_DIR, 'infrastructure', 'distribution-policy.json'),
  manifest: path.join(BUNDLE_DIR, 'birth-image.manifest.json'),
  toolContracts: path.join(BUNDLE_DIR, 'tool-contracts.json'),
  inferenceLock: path.join(BUNDLE_DIR, 'assets', 'inference-lock.json'),
  receiptSchema: path.join(BUNDLE_DIR, 'assets', 'birth-receipt.schema.json'),
  sealed: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'sealed-keys.enc'),
  sealKey: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'seal.key'),
  journal: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'journal.jsonl'),
  stateFile: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'state.enc'),
  anchor: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'anchor.json'),
  receipt: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'birth-receipt.json'),
  parentRecord: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'parent-record.json'),
  log: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'agent.log'),
  pid: path.join(GUEST_ROOT, 'run', 'agent', 'agent.pid'),
  port: path.join(GUEST_ROOT, 'run', 'agent', 'http.port'),
  signerPort: path.join(GUEST_ROOT, 'run', 'agent', 'signer.port'),
  heartbeat: path.join(GUEST_ROOT, 'run', 'agent', 'heartbeat.json'),
  status: path.join(GUEST_ROOT, 'run', 'agent', 'status.json'),
  strategy: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'strategy'),
  outbox: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'outbox'),
  snapshots: path.join(GUEST_ROOT, 'var', 'lib', 'agent', 'snapshots'),
};

export function ensureDirs() {
  for (const d of [P.state, P.run, P.strategy, P.outbox, P.snapshots]) fs.mkdirSync(d, { recursive: true });
}

// Windows note: os.homedir() is used by the reused v1 code for the RPC endpoint.
export const HOME = os.homedir();
