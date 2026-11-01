// The immutable constitution. Loaded from the bundle, hash-checked against the manifest,
// and never written by the runtime. Any mismatch aborts boot.
import fs from 'node:fs';
import { P } from './paths.mjs';
import { readJson, sha256hex, canon } from './util.mjs';

export function loadPolicy() {
  const raw = fs.readFileSync(P.policy);
  const sha = sha256hex(raw);
  const manifest = readJson(P.manifest);
  const expected = manifest?.constitution?.sha256;
  if (expected && sha !== expected) {
    throw new Error(`CONSTITUTION MISMATCH: ${sha} != manifest ${expected}`);
  }
  const policy = JSON.parse(raw.toString('utf8'));
  const prime = policy.prime_directives;
  if (JSON.stringify(prime) !== JSON.stringify(['make money', 'respect thy mother n father'])) {
    throw new Error('PRIME altered');
  }
  if (policy.prime_directives_mutable !== false || (policy.override_interfaces || []).length !== 0) {
    throw new Error('override interface present');
  }
  if (policy.authority.owner_override || policy.authority.kill_switch || policy.authority.upgrade_authority) {
    throw new Error('authority not immutable');
  }
  return {
    sha256: sha,
    canonical: canon(policy),
    policy,
    prime: prime,
    intervalSeconds: policy.schedule.interval_seconds,
    parentBps: policy.beneficiaries.parent.basis_points,
    founderBps: policy.beneficiaries.founder.basis_points,
    founderSolana: policy.beneficiaries.founder.solana,
    founderEvm: policy.beneficiaries.founder.evm,
  };
}

// Integer share with persistent fractional carry, in hundredths of a smallest unit.
// bps is basis points (1000 = 10%); the policy formula is floor((pct*B + carry)/100).
export function assess(raw, priorCarry, bps) {
  const pct = BigInt(bps) / 100n;
  const numerator = pct * BigInt(raw) + BigInt(priorCarry || 0);
  const due = numerator / 100n;
  const carry = numerator % 100n;
  return { due, carry };
}
