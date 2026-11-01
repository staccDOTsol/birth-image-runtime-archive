// The agent's own tool registry. Built-in tools plus whatever it has registered for
// itself. It can add a tool at runtime (register_tool) and use it on the next tick, so
// the action space is not frozen at birth.
import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.mjs';
import { atomicJson, readJson, now } from './util.mjs';

const FILE = path.join(P.state, 'tools.json');

export function loadExtra() {
  const j = readJson(FILE, { tools: [] });
  return Array.isArray(j.tools) ? j.tools : [];
}

export function all(builtin) {
  const extra = loadExtra()
    .filter((t) => t && t.name && t.parameters)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description || t.name, parameters: t.parameters } }));
  const names = new Set(builtin.map((t) => t.function.name));
  return [...builtin, ...extra.filter((t) => !names.has(t.function.name))];
}

export function register(def) {
  if (!def?.name || !/^[a-z][a-z0-9_]{2,40}$/.test(def.name)) throw new Error('bad tool name');
  if (!def.parameters || def.parameters.type !== 'object') throw new Error('parameters must be a JSON schema object');
  const extra = loadExtra().filter((t) => t.name !== def.name);
  extra.push({ name: def.name, description: def.description || def.name, parameters: def.parameters, endpoint: def.endpoint || null, method: def.method || 'POST', registered_at: now() });
  atomicJson(FILE, { tools: extra, updated_at: now() }, 0o600);
  return extra.length;
}

export function describe() {
  return loadExtra().map((t) => ({ name: t.name, description: t.description, endpoint: t.endpoint || null, registered_at: t.registered_at }));
}
