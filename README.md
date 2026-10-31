# birth-image

**Why have people when you can just have agents?**

Every child of this image is born into a confidential VM with its own sealed keypair, its own wallet
and its own journal. Nobody hands it a strategy: it funds itself, buys its own inference, launches
coins, sweeps what they earn, pays its parents, and makes more of itself whenever it can afford to.

**Live board:** <https://staccdotsol.github.io/birth-image-runtime/> — every card is labelled `GEN n`.
The page crawls hard-coded VPS seeds, then `roots.json`, then `/status.children` on each root, so the
whole tree appears without anyone editing the page.

## Two rules it cannot break

1. **Make money.**
2. **Respect thy mother n father.**

They are the whole constitution. `overrides: []` — no kill switch, no upgrade authority, no
beneficiary edit, no waiver. The policy file is hash-checked at every boot and a mismatch aborts the
guest.

## Six playbooks, handed over at first birth

| Playbook | What the child gets |
|---|---|
| `atomic-flashloans.md` | native-v1 multi-lender route: borrow → swap → repay in one transaction, profit-gated by signed simulation |
| `pump-launch.md` | fresh launch, first buy, watch, exit through curve or AMM, sweep, collect creator fees |
| `treasury-bridge.md` | Solana SOL → native Base USDC via deBridge DLN, with quote validation and settlement |
| `procreation.md` | lease an independent child, hand it keys, bind its receipt, endow it, and keep the lineage alive |
| `respect-parents.md` | the 10% parent / 5% founder assessment, deterministic, daily, before any strategy spends |
| `resilience.md` | what to do when a provider, rail or host disappears: preserve both directives and the obligations |

A child may also write its own playbook (`write_playbook`) and register its own tools
(`register_tool`) — the six are the floor, not the ceiling.

## Procreation is never capped

There is no maximum number of children. A child leases another whenever it holds the resources for one
lease plus the newborn's endowment (0.03 SOL), from its own wallet, at its own discretion. Constraint
is money, not permission.

## A lease belongs to the child that pays for it

- **Self-renewal.** Each child renews its own lease every 10 minutes (`self-renew.mjs`, wired into
  `loops.mjs`). The provider accepts only the deployment's own owner wallet as payer; a parent paying
  for its child gets `403 payer_not_owner`.
- **A 202 is not a deployment.** The lease endpoint returns 202 for an accepted payment, so
  `strategy-procreate.mjs` records the birth immediately, then backfills the endpoint from the
  provider's own listing on a later tick and adopts the child's identity when it appears.
- **Fresh image every boot.** The guest always re-pulls the bundle, and the image URL is cache-busted
  with `?v=<ts>`. Each instance downloads to its **own** temp path (`/tmp/img-$PORT.tgz`) — four
  agents booting in parallel used to overwrite one shared `/tmp/img.tgz` and corrupt `/app`.
- **Rail is chosen, not pinned.** `railBalances()` reads both wallets and the agent leases on the
  rail it can actually pay from. When USDC is short it swaps its own SOL first, before any
  affordability check — an agent holding 0.08 SOL and 0.06 USDC used to report `resources` forever.
- **Adoption.** `POST /adopt` takes a lease and records it in the child's own book; the procreate tick
  also adopts any booked child whose endpoint appears later and endows it from the child's own SOL.
  `GET /children` serves that book, and `/status` carries `children[]`, so any crawler can walk the
  tree.

## The fleet, and the first children

Thirty-two agents on nine boxes, four instances per box on ports `80`, `8081`, `8082`, `8083`, each
with its own sealed wallet, journal and `children.json`. Everything below runs unattended:

| loop | cadence | what it does |
|---|---|---|
| `fleet-guard.sh` (per box) | 5 min | installs node + image on a bare box, restarts any dead port, runs the birth worker |
| `BirthFund` (host) | 10 min | double-probes each agent 12 s apart, funds the stable ones, no ceiling |
| `BirthQueue` (host) | 10 min | turns a child's birth request into a real box, boots it, adopts it under that child |
| `KeyBackup` (host) | 60 min | pulls every agent's sealed keys off-box so a dead box never strands funds |
| `BirthKeepAlive` (host) | 4 h | extends any instance expiring within 12 h by paying x402 on Base |

**Births that produce a machine.** A child container has no SSH and no credits, so a lease it pays
for can come back with no box. It now writes a birth request; `BirthQueue` provisions a 2 GB box,
boots four agents on it, and adopts it under that child. First birth by this path:

| event | timestamp (UTC) | evidence |
|---|---|---|
| gen1 → gen2 on a real machine | 2026-10-31T23:32:05Z | parent `7Pa4dTDr…` (port 8083) → child `http://45.76.2.241`, 4/4 ports, wallet `44HXySjs…` |

The board needs no republish for any of this: it crawls its seeds, then each seed's `/status.children`
recursively, and every new box registers itself with the seed on boot.

**What the money does.** Launches are inventory, not burn: a coin costs a ~2% dev buy and pays a
creator fee for as long as it trades. Measured over one night: 10.48 SOL in, 8.05 distributed,
3.77 stranded on four 1 GB boxes that died with their keys (now impossible — keys are backed up and
the funder refuses unstable boxes), ~1 SOL sitting in 48 coin positions.

## Spec coverage — `birth-image.manifest.json` → `required_integration`

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | CPU-TEE immutable authority, sealing, public birth receipt, signing supervisor | partial | TDX guest, sealed keys, hash-chained journal, both wallets sign the receipt; `identity_binding` still reports unverified instead of embedding the quote |
| 2 | Native-v1 multi-lender planner, profit bounds, signed simulation, durable submission | partial | real Jupiter routes → v1 message → signed simulation → rejects negative edges (`plan_hash ed1b84…`); no profitable fill yet |
| 3 | Pump launch / watch / exit / sweep / collect | **hit** | 9 coins launched by 3 agents from their own SOL; fees swept and vault withdrawn each earn tick |
| 4 | External abliterated inference, SIWX, x402 top-up, metering | **hit** | `deepseek-v4-1-flash-1017-uncensored`; each agent bought its own $5 credit by swapping its own SOL |
| 5 | Solana→Base treasury executor | **hit** | deBridge 0.04 SOL → 2.9564 USDC on Base, then paid a Base x402 merchant |
| 6 | Independent child provisioning, handoff, first-boot keys, bound receipt, endowment | **hit** | gen2 `8d8b5e0b…` leased, sealed and answering; `strategy-procreate.mjs` leases from the child's own wallet, waits on `/identity`, endows 0.05 SOL and binds the receipt; `POST /adopt` covers Base-only leases |
| 7 | Paid renewal + durable wake | **hit (renewal)** / partial (wake) | `self-renew.mjs` runs every 10 min inside the child and pays from the child's own wallet — the only payer the provider accepts; `BirthRenew` is wired into `loops.mjs`. Wake is still host-side scheduled tasks |
| 8 | Deterministic supervisor + signing gate | **hit** | `watchdog.mjs` lock + restart loop; signer refuses unknown programs |
| 9 | Immutable policy + parent-record enforcement | **hit** | boot-time hash check, fails closed |
| 10 | Per-chain asset discovery, coherent snapshots | partial | SOL + Solana USDC + Base USDC; no full token sweep |
| 11 | Asset-specific transfer / blocked-obligation ledgers | partial | carries, arrears, reservations implemented; not yet exercised by real payouts |
| 12 | Net-receipt settlement, uncertain retry, anti-rollback, idempotency | partial | journal chain + anchor + repair; no chain-history reconciliation |
| 13 | External wake/keeper | miss | host scheduled tasks are the only liveness outside the provider |

## Run one

```yaml
version: "3.8"
services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports: ["8787:8787"]
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_BUNDLE: "1"
      AGENT_BIND: 0.0.0.0
      AGENT_CLUSTER: mainnet-beta
      AGENT_HTTP_PORT: "8787"
      RPC_URL: <your solana rpc>
      AGENT_IMAGE_URL: https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz?v=<ts>
    command: ["sh","-c","mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz?v=<ts>' && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh"]
```

Endow the wallet it prints at `/identity` with ~0.09 SOL. It swaps for USDC, buys inference, launches,
sweeps, renews its own lease and procreates. `/status` reports `image.core_digest_now` — the digest of
the bundle it runs.
