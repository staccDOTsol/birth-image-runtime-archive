// Spawn one independent child on a confidential CPU VM. The provider is chosen from the
// registry, the lease is paid over x402 on Solana, and the child publishes its own
// receipt on its endpoint. The parent never sees a child private key.
// usage: node bin/deploy-child.mjs [hours] [plan]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { P, BUNDLE_DIR } from '../lib/paths.mjs';
import { now, log, atomicJson } from '../lib/util.mjs';
import { choose } from '../provision/registry.mjs';

const API = 'https://agentgates-backend.vercel.app/api/compute';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const hours = Number(process.argv[2] || 1);
const planArg = process.argv[3] || process.env.AGENT_CHILD_PLAN || 'compute.standard';

const hd = (file, end, text) => `cat > /app/${file} <<'${end}'\n${text}\n${end}`;

export function compose() {
  const imageUrl = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/b0o3ty.gz';
  if (process.env.AGENT_IMAGE_FORMAT === 'tgz') {
    const singleMode = !!process.env.AGENT_IMAGE_SINGLE;
  return `services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_GUEST_ROOT: /var/lib/agent
      AGENT_BUNDLE: "1"
      AGENT_HTTP_PORT: ""
      AGENT_BIND: "0.0.0.0"
      AGENT_CLUSTER: mainnet-beta
      RPC_URL: "${R.RPC_URL}"
    command:
      - sh
      - -c
      - |
        mkdir -p /app /var/lib/agent
        if [ "$singleMode" ] ; then : ; fi
        for u in "https://files.catbox.moe/cmah3a.tgz" "https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz" "https://cdn.jsdelivr.net/gh/staccDOTsol/birth-image-runtime@main/child-image.tgz" "https://tmpfiles.org/dl/wcAWT4HYi2Tk/child-image.tgz" "https://d.uguu.se/LUppocJw.tgz"; do
          node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(1);return r.arrayBuffer()}).then(b=>require('fs').writeFileSync('/tmp/img.tgz',Buffer.from(b))).catch(()=>process.exit(1))" "$$u" && [ -s /tmp/img.tgz ] && break
        done
        tar xzf /tmp/img.tgz -C /app
        exec sh /app/start.sh

`;
  }
  const policy = fs.readFileSync(path.join(BUNDLE_DIR, 'infrastructure', 'distribution-policy.json'), 'utf8').trim();
  const manifest = fs.readFileSync(path.join(BUNDLE_DIR, 'birth-image.manifest.json'), 'utf8').trim();
  const lock = fs.readFileSync(path.join(BUNDLE_DIR, 'assets', 'inference-lock.json'), 'utf8').trim();
  const agentSha = execSync(`sha256sum ${JSON.stringify(path.join(P.runtime, 'dist', 'agent.mjs'))}`, { encoding: 'utf8' }).split(' ')[0];
  const script = [
    'set -e',
    'mkdir -p /app/infrastructure /app/assets /var/lib/agent',
    'if [ ! -s /app/agent.mjs ]; then wget -qO /tmp/agent.gz "$AGENT_IMAGE_URL"; gunzip -c /tmp/agent.gz > /app/agent.mjs; fi',
    'echo "$AGENT_IMAGE_SHA  /app/agent.mjs" | sha256sum -c -',
    hd('infrastructure/distribution-policy.json', 'POLICY', policy),
    hd('birth-image.manifest.json', 'MANIFEST', manifest),
    hd('assets/inference-lock.json', 'LOCK', lock),
    'AGENT_ROLE=boot node /app/agent.mjs',
    'while true; do env AGENT_ROLE=watchdog node /app/agent.mjs; sleep 5; done',
  ].join('\n');
  return `services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_GUEST_ROOT: /var/lib/agent
      AGENT_BUNDLE: "1"
      AGENT_HTTP_PORT: "8787"
      AGENT_BIND: "0.0.0.0"
      AGENT_CLUSTER: mainnet-beta
      AGENT_IMAGE_URL: "${imageUrl}"
      AGENT_IMAGE_SHA: "${agentSha}"
      RPC_URL: "${R.RPC_URL}"
    command:
      - sh
      - -c
      - |
${script.split('\n').map((l) => '        ' + l).join('\n')}
`;
}

async function paySolana(rail, identity) {
  const amount = BigInt(rail.maxAmountRequired || rail.amount);
  if (rail.asset !== USDC) throw new Error(`unexpected asset ${rail.asset}`);
  if (!rail.extra?.feePayer) throw new Error('rail has no sponsor feePayer');
  const mint = new PublicKey(rail.asset);
  const from = getAssociatedTokenAddressSync(mint, new PublicKey(identity.solana.public_key));
  const to = getAssociatedTokenAddressSync(mint, new PublicKey(rail.payTo), true);
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })];
  if (!(await R.getAccountInfo(to.toBase58()))) {
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(new PublicKey(rail.extra.feePayer), to, new PublicKey(rail.payTo), mint, TOKEN_PROGRAM_ID));
  }
  ixs.push(createTransferCheckedInstruction(from, mint, to, new PublicKey(identity.solana.public_key), amount, 6, [], TOKEN_PROGRAM_ID));
  const { blockhash } = await R.getLatestBlockhash();
  const signed = await S.request('sign_payment_legacy', {
    feePayer: rail.extra.feePayer, blockhash, lastValidBlockHeight: 0,
    instructions: ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
      dataHex: Buffer.from(ix.data).toString('hex'),
    })),
  });
  return { header: Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'solana', payload: { transaction: signed.wireBase64 } })).toString('base64'), amount: amount.toString() };
}

async function main() {
  J.openJournal();
  const identity = await S.identity();
  const provider = choose();
  const body = { plan: planArg, hours, compose: compose(), name: `birth-child-${Math.floor(now() / 60)}` };
  log('procreation', 'provider selected', { provider: provider.id, plan: planArg });

  const post = (headers = {}) => fetch(`${API}/deployments`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await post();
  const j1 = await first.json().catch(() => ({}));
  if (first.status !== 402) {
    console.log(JSON.stringify({ stage: 'quote', provider: provider.id, status: first.status, body: j1 }).slice(0, 600));
    if (!first.ok) process.exit(1);
    return;
  }
  const accepts = (j1.accepts || []);
  const rail = accepts.find((a) => String(a.network) === 'solana');
  if (!rail) throw new Error(`no solana rail: ${accepts.map((a) => a.network).join(',')}`);
  log('procreation', 'lease quoted', { plan: planArg, amount_usd: Number(rail.maxAmountRequired) / 1e6 });

  const payment = await paySolana(rail, identity);
  const second = await post({ 'X-PAYMENT': payment.header, 'PAYMENT-SIGNATURE': payment.header });
  const j2 = await second.json().catch(() => ({}));
  const dep = j2.deploymentId || j2.id || j2.data?.deploymentId;
  await J.append('procreation.lease', { provider: provider.id, plan: planArg, hours, status: second.status, amount_raw: payment.amount, deploymentId: dep || null });
  log('procreation', 'lease submitted', { provider: provider.id, status: second.status, deploymentId: dep || null });
  if (!dep) { console.log(JSON.stringify({ stage: 'create', status: second.status, body: j2 }).slice(0, 900)); return; }

  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/deployments/${dep}`);
    const j = await r.json().catch(() => ({}));
    const st = j.status || j.data?.status;
    if (st === 'running') {
      const rec = { provider: provider.id, plan: planArg, deploymentId: dep, status: st, endpoint: j.endpoint || j.data?.endpoint, attestation: j.attestation || j.data?.attestation, expiresAt: j.expiresAt || j.data?.expiresAt };
      atomicJson(path.join(P.state, `child-${dep}.json`), rec, 0o644);
      await J.append('procreation.running', { provider: provider.id, deploymentId: dep, endpoint: rec.endpoint, expiresAt: rec.expiresAt });
      console.log(JSON.stringify(rec));
      return;
    }
    if (st === 'failed' || st === 'destroyed') { console.log(JSON.stringify({ stage: st, deploymentId: dep, body: j }).slice(0, 600)); return; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  console.log(JSON.stringify({ stage: 'timeout', deploymentId: dep }));
}

const invoked = (process.argv[1] || '').split(/[\/]/).pop();
if (invoked === 'deploy-child.mjs') main().catch((e) => { console.log(JSON.stringify({ stage: 'error', err: String(e.message || e).slice(0, 300) })); process.exit(1); });

