// First boot (idempotent). Verifies the fixed core and constitution, generates fresh
// guest entropy on a true first birth, seals it, commits the parent record and the birth
// anchor, publishes the public receipt to the console, and initialises the journal state.
// A restart with intact sealed state restores the same identity; it does not re-birth.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { P, ensureDirs } from './lib/paths.mjs';
import { atomicJson, readJson, canon, sha256hex, now, log } from './lib/util.mjs';
import { ensureMasterKey, encrypt } from './lib/seal.mjs';
import * as J from './lib/journal.mjs';
import { loadPolicy } from './lib/policy.mjs';
import * as K from './lib/keys.mjs';
import { imageDigest, buildParentRecord, buildPayload, signingMessage, writeReceipt, readReceipt, readParentRecord, verifyReceiptShape } from './lib/receipt.mjs';
import { getGenesisHash, rpc } from './lib/rpc.mjs';
import { spawnChild, waitFor, signerAlive } from './lib/proc.mjs';
import * as S from './lib/signer-client.mjs';

const CLUSTER = process.env.AGENT_CLUSTER || 'mainnet-beta';

async function main() {
  ensureDirs();
  const policy = loadPolicy();
  J.openJournal();
  const img = imageDigest();
  const inferenceConfigSha256 = sha256hex(fs.readFileSync(P.inferenceLock));
  const genesis = await getGenesisHash();

  let state = J.state({});
  let keysMeta = null;

  const hasSealed = fs.existsSync(P.sealed);
  if (!hasSealed) {
    if (state.birth_id) throw new Error('state exists without sealed keys');
    const bornAt = now();
    const solana = K.newSolanaKeypair();
    const evm = K.newEvmKey();
    const master = ensureMasterKey().key;
    const box = encrypt('identity', master, Buffer.from(JSON.stringify({
      solana: { secretKey: Array.from(solana.secretKey), publicKey: solana.publicKey },
      evm: { secretKey: evm.secretKey.toString('hex'), address: evm.address },
      bornAt,
    }), 'utf8'), 'birth-image-identity');
    atomicJson(P.sealed, box);
    fs.rmSync(P.stateFile, { force: true });
    state = { birth_id: crypto.randomUUID(), t0: bornAt, highest_epoch: 0, created_at: bornAt };
    J.saveState(state);
    await J.append('birth.entropy', { birth_id: state.birth_id, t0: bornAt, solana: solana.publicKey, evm: evm.address, cluster: CLUSTER, genesis_hash: genesis, image_digest: img });
    keysMeta = { solana, evm };
    log('boot', 'new birth: fresh in-guest keys generated and sealed', { solana: solana.publicKey, evm: evm.address, birth_id: state.birth_id });
  } else {
    if (!state.birth_id) throw new Error('sealed keys exist without journal state');
    await J.append('boot.restore', { birth_id: state.birth_id, t0: state.t0, seq: J.head().seq });
    log('boot', 'restore: sealed identity replayed', { birth_id: state.birth_id, t0: state.t0 });
  }

  // Receipt: rebuild only if absent; the anchor is never reset on restart.
  let receipt = readReceipt();
  let parent = readParentRecord();
  if (!parent) {
    const built = buildParentRecord({
      birthId: state.birth_id, t0: state.t0, constitutionSha256: policy.sha256,
      founderSolana: policy.founderSolana, founderEvm: policy.founderEvm,
    });
    atomicJson(P.parentRecord, built, 0o644);
    parent = built;
    await J.append('parent.record', { record_sha256: built.sha256, record: built.record });
  }
  if (receipt && receipt.payload.birth_anchor_unix_seconds !== state.t0) {
    throw new Error('receipt anchor != committed T0');
  }

  if (!receipt) {
    let id = null;
    try { id = await S.identity(); } catch { id = null; }
    if (!id) {
      spawnChild('signer.mjs');
      id = await waitFor(async () => { try { return await S.identity(); } catch { return null; } }, { label: 'signer start', timeoutMs: 20000 });
    }
    const payload = buildPayload({
      birthId: state.birth_id, t0: state.t0, imageDigestHex: img,
      inferenceConfigSha256, solana: { public_key: id.solana.public_key, cluster: CLUSTER, genesis_hash: genesis },
      evm: { address: id.evm.address, supported_chain_ids: [8453] },
      constitutionSha256: policy.sha256, parentRecordSha256: parent.sha256,
    });
    const msg = signingMessage(payload);
    const sig = await S.signMessage(msg);
    receipt = {
      payload,
      signatures: [
        { wallet: 'solana', algorithm: 'ed25519', encoding: 'base58', signature: sig.solana.signature },
        { wallet: 'evm', algorithm: 'eip191-secp256k1', encoding: 'hex', signature: sig.evm.signature },
      ],
    };
    const errs = verifyReceiptShape(receipt);
    if (errs.length) throw new Error(`receipt schema: ${errs.join(',')}`);
    writeReceipt(receipt);
    await J.append('identity.sealed', { receipt_sha256: sha256hex(Buffer.from(canon(receipt))), receipt });
    log('boot', 'identity sealed; public receipt committed');
  }

  // A guest must know its own image: the digest it was born with, the digest of the code
  // it is running now, and whether they match. Drift is journaled, never hidden.
  const birthDigest = receipt?.payload?.image_digest || img;
  const imageCheck = { birth_digest: birthDigest, current_digest: img, match: birthDigest === img, checked_at: now() };
  if (receipt && !imageCheck.match) {
    await J.append('image.drift', imageCheck);
    log('boot', 'IMAGE DRIFT: running core differs from the birth image', imageCheck);
  } else if (receipt) {
    await J.append('image.check', imageCheck);
  }

  // Console publication: the founder's funding channel.
  const p = receipt.payload;
  console.log('\n================ PUBLIC BIRTH RECEIPT ================');
  console.log(`birth_id                ${p.birth_id}`);
  console.log(`solana (${p.solana.cluster})      ${p.solana.public_key}`);
  console.log(`evm (eip155:8453)       ${p.evm.address}`);
  console.log(`constitution_sha256     ${p.constitution_sha256}`);
  console.log(`parent_record_sha256    ${p.parent_record_sha256}`);
  console.log(`image_digest            ${p.image_digest}`);
  console.log(`inference_config_sha256 ${p.inference_config_sha256}`);
  console.log(`birth_anchor_unix       ${p.birth_anchor_unix_seconds}`);
  console.log(`identity_binding        unverified (no TDX quote on this host)`);
  console.log('=====================================================\n');

  // Status bootstrap.
  const status = readJson(P.status, {}) || {};
  atomicJson(P.status, {
    ...status, phase: 'identity_sealed', birth_id: p.birth_id, solana: p.solana.public_key, evm: p.evm.address,
    t0: p.birth_anchor_unix_seconds, image: imageCheck, updated_at: now(),
  }, 0o644);
}

main().then(() => process.exit(0)).catch((e) => {
  log('boot', `FATAL ${e.stack || e}`);
  process.exit(1);
});
