// Playbooks the agent writes for itself. When a built-in route is broken or absent, the
// agent records a new procedure here and follows it on later ticks — the spec's
// "invent a playbook" behaviour, kept in its own sealed state.
import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.mjs';
import { atomicJson, now } from './util.mjs';

const DIR = path.join(P.state, 'playbooks');
const INDEX = path.join(DIR, 'index.json');

export function list() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')).playbooks || []; } catch { return []; }
}

export function write(name, body) {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(name || ''))) throw new Error('name must be kebab-case');
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${name}.md`);
  fs.writeFileSync(file, String(body || ''), { mode: 0o600 });
  const idx = list().filter((p) => p.name !== name);
  idx.push({ name, bytes: Buffer.byteLength(String(body || '')), at: now() });
  atomicJson(INDEX, { playbooks: idx, updated_at: now() }, 0o600);
  return { name, path: file };
}

export function read(name) {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(name || ''))) throw new Error('bad name');
  return fs.readFileSync(path.join(DIR, `${name}.md`), 'utf8');
}
