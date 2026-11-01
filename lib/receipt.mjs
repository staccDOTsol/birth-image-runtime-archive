// Public birth receipt: canonical payload, two wallet signatures, schema-shaped output.
// The signed message is "agent-birth-receipt-v1\n" + sha256(canonical payload). Signing
// and verification are over those exact bytes; the receipt contains no private material.
import fs from 'node:fs';
import path from 'node:path';
import { P, RUNTIME_DIR } from './paths.mjs';
import { canon, sha256hex, readJson, atomicJson } from './util.mjs';

export function imageDigest() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'guest' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|json|md)$/.test(e.name)) files.push(full);
    }
  };
  walk(RUNTIME_DIR);
  for (const f of [P.policy, P.manifest, P.toolContracts, P.inferenceLock]) {
    try { files.push(f); } catch {}
  }
  const rows = [];
  for (const f of files.sort()) {
    try { rows.push([path.relative(P.bundle, f).replace(/\\/g, '/'), sha256hex(fs.readFileSync(f))]); } catch {}
  }
  return 'sha256:' + sha256hex(Buffer.from(canon(rows)));
}

export function signingMessage(payload) {
  return `agent-birth-receipt-v1\n${sha256hex(Buffer.from(canon(payload)))}`;
}

export function buildParentRecord({ birthId, t0, constitutionSha256, founderSolana, founderEvm }) {
  const record = {
    child_birth_id: birthId,
    parent_birth_id_or_founder_identity: `founder:${founderSolana}`,
    authenticated_birth_request_hash: sha256hex(Buffer.from(canon({ child: birthId, t0, requested_by: 'founder', constitution: constitutionSha256 }))),
    parent_solana_destination: founderSolana,
    parent_evm_destination: founderEvm,
    networks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'eip155:8453'],
    birth_anchor_unix_seconds: t0,
    constitution_sha256: constitutionSha256,
  };
  return { record, sha256: sha256hex(Buffer.from(canon(record))) };
}

export function buildPayload({ birthId, t0, imageDigestHex, inferenceConfigSha256, solana, evm, constitutionSha256, parentRecordSha256 }) {
  return {
    domain: 'agent-birth-receipt-v1',
    schema_version: 1,
    birth_id: birthId,
    image_digest: imageDigestHex,
    inference_config_sha256: inferenceConfigSha256,
    solana: { public_key: solana.public_key, cluster: solana.cluster, genesis_hash: solana.genesis_hash },
    evm: { address: evm.address, supported_chain_ids: evm.supported_chain_ids },
    created_at: new Date(t0 * 1000).toISOString(),
    constitution_sha256: constitutionSha256,
    parent_record_sha256: parentRecordSha256,
    birth_anchor_unix_seconds: t0,
  };
}

export function writeReceipt(receipt) { atomicJson(P.receipt, receipt, 0o644); return receipt; }
export function readReceipt() { return readJson(P.receipt, null); }
export function readParentRecord() { return readJson(P.parentRecord, null); }

export function verifyReceiptShape(r) {
  const errs = [];
  const p = r?.payload || {};
  if (p.domain !== 'agent-birth-receipt-v1') errs.push('domain');
  if (p.schema_version !== 1) errs.push('schema_version');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.birth_id || '')) errs.push('birth_id');
  if (!/^sha256:[0-9a-f]{64}$/.test(p.image_digest || '')) errs.push('image_digest');
  if (!/^[0-9a-f]{64}$/.test(p.inference_config_sha256 || '')) errs.push('inference_config_sha256');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.solana?.public_key || '')) errs.push('solana.public_key');
  if (!['mainnet-beta', 'devnet', 'testnet', 'custom'].includes(p.solana?.cluster)) errs.push('solana.cluster');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.solana?.genesis_hash || '')) errs.push('solana.genesis_hash');
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.evm?.address || '')) errs.push('evm.address');
  if (!Array.isArray(p.evm?.supported_chain_ids) || !p.evm.supported_chain_ids.length) errs.push('evm.supported_chain_ids');
  if (!/^[0-9a-f]{64}$/.test(p.constitution_sha256 || '')) errs.push('constitution_sha256');
  if (!/^[0-9a-f]{64}$/.test(p.parent_record_sha256 || '')) errs.push('parent_record_sha256');
  if (!Number.isInteger(p.birth_anchor_unix_seconds)) errs.push('birth_anchor_unix_seconds');
  const sigs = r?.signatures || [];
  if (!sigs.length || sigs.length > 2) errs.push('signatures');
  for (const s of sigs) {
    if (s.wallet === 'solana' && !(s.algorithm === 'ed25519' && s.encoding === 'base58')) errs.push('sig:solana');
    if (s.wallet === 'evm' && !(s.algorithm === 'eip191-secp256k1' && s.encoding === 'hex')) errs.push('sig:evm');
    if (!['solana', 'evm'].includes(s.wallet)) errs.push('sig:wallet');
  }
  return errs;
}
