// Jupiter aggregator quotes and executable instructions. The response resolves every
// account to a public key, so the instructions can be inlined into a native v1 message
// (no address lookup table), subject to the 64-address / 4096-byte v1 limits.
const KEY = process.env.JUP_API_KEY || 'jup_928fb80ecd518586abd99371fc46506bb398758ce74c12358393da774bc0d591';
// Pro endpoints answer on the key; lite-api is the anonymous fallback.
const BASES = ['https://api.jup.ag/swap/v1', 'https://lite-api.jup.ag/swap/v1'];
const hdr = () => ({ 'x-api-key': KEY });
const QUOTE = BASES[0] + '/quote';
const IX = BASES[0] + '/swap-instructions';

let lastCall = 0;
async function gate() {
  const wait = Math.max(0, 900 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function getJson(url, init, label, attempts = 8) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await gate();
    const r = await fetch(url, { ...init, headers: { ...(init?.headers || {}), ...hdr() } });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, Math.min(3000 * 2 ** i, 45000)));
      lastErr = new Error(`${label} 429`);
      continue;
    }
    if (!r.ok) throw new Error(`${label} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw lastErr || new Error(`${label} failed`);
}

export async function quote({ inputMint, outputMint, amount, slippageBps = 20 }) {
  const u = `${QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  return getJson(u, { headers: { accept: 'application/json' } }, 'jupiter quote');
}

export async function swapInstructions({ quoteResponse, userPublicKey, wrapAndUnwrapSol = false }) {
  return getJson(IX, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol, useSharedAccounts: false, dynamicComputeUnitLimit: false }),
  }, 'jupiter swap-instructions');
}

export function asIx(j) {
  return {
    programId: j.programId,
    keys: (j.accounts || []).map((a) => ({ pubkey: a.pubkey, isSigner: !!a.isSigner, isWritable: !!a.isWritable })),
    dataHex: Buffer.from(j.data, 'base64').toString('hex'),
  };
}

export function ixsOf(set) {
  const out = [];
  for (const k of ['computeBudgetInstructions', 'setupInstructions', 'swapInstruction', 'cleanupInstructions']) {
    const v = set[k];
    if (!v) continue;
    if (Array.isArray(v)) out.push(...v.map(asIx));
    else out.push(asIx(v));
  }
  return out;
}

export function uniqueAccounts(ixs) {
  return [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey)))];
}
