// Children registry + watcher. Polls each leased child, reads its own public receipt from
// /identity, records the binding, and (optionally) endows a child that has never been
// funded. Parent state is the journal; this file is the operational view.
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../lib/paths.mjs';
import { now, log, atomicJson, readJson } from '../lib/util.mjs';
import { ownerGet } from './agentgates-auth.mjs';
import { execFileSync } from 'node:child_process';

const API = 'https://agentgates-backend.vercel.app';
const file = path.join(P.state, 'children.json');

export function load() { return readJson(file, { children: [], updated_at: null }); }
export function save(d) { d.updated_at = now(); atomicJson(file, d, 0o644); }

export async function refresh() {
  const d = load();
  for (const c of d.children) {
    try {
      const r = await ownerGet(API, `/api/compute/deployments/${c.deploymentId}`);
      const b = r.body || {};
      c.status = b.status || c.status;
      c.endpoint = b.endpoint || c.endpoint || null;
      c.expiresAt = b.expiresAt || c.expiresAt || null;
      c.attestation = b.attestation || c.attestation || null;
      if (c.endpoint && !c.identity) {
        try {
          const ir = await fetch(`${c.endpoint.replace(/\/$/, '')}/identity`);
          if (ir.ok) {
            const id = await ir.json();
            c.identity = { birth_id: id.payload?.birth_id, solana: id.payload?.solana?.public_key, evm: id.payload?.evm?.address, image_digest: id.payload?.image_digest, receipt_sha256: id.canonical_signing_message?.slice(-64) || null };
            log('children', 'child identity bound', { deploymentId: c.deploymentId, solana: c.identity.solana });
          }
        } catch (e) { c.identity_error = String(e.message || e); }
      }
      if (c.endpoint && c.identity) {
        try {
          const sr = await fetch(`${c.endpoint.replace(/\/$/, '')}/status`);
          if (sr.ok) { const s = await sr.json(); c.child_status = { phase: s.phase, image: s.image, inference: s.inference?.state, distribution: s.distribution?.next_due_epoch }; }
        } catch {}
      }
    } catch (e) { c.error = String(e.message || e); }
  }
  save(d);
  return d;
}

export function add({ deploymentId, role = 'child', endowmentLamports = null }) {
  const d = load();
  d.children.push({ deploymentId, role, endowment_lamports: endowmentLamports, created_at: now(), status: 'provisioning', endpoint: null, identity: null });
  save(d);
  return d;
}

if (process.argv[1] && process.argv[1].endsWith('children.mjs')) {
  const out = await refresh();
  console.log(JSON.stringify(out, null, 1));
}
