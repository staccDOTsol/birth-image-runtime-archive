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
lease plus the newborn's endowment (0.05 SOL), from its own wallet, at its own discretion. Constraint
is money, not permission.

## A lease belongs to the child that pays for it

- **Self-renewal.** Each child renews its own lease every 10 minutes (`self-renew.mjs`, wired into
  `loops.mjs`). The provider accepts only the deployment's own owner wallet as payer; a parent paying
  for its child gets `403 payer_not_owner`.
- **A 202 is not a deployment.** The lease endpoint returns 202 for an accepted payment, so
  `strategy-procreate.mjs` re-reads the deployment list and records only a deployment that exists.
- **Fresh image every boot.** The guest always re-pulls the bundle, and the image URL is cache-busted
  with `?v=<ts>` (`start.sh`, `bin/vps-fleet.mjs`, `strategy-procreate.mjs`); raw.githubusercontent
  otherwise serves a stale bundle to a new deployment.
- **Base rail first.** `procreate` leases on Base, because a Solana-rail lease returns 202 and then
  404. When the Base pot is short it bridges its own SOL to Base USDC through deBridge DLN
  (`lib/bridge-base.mjs`). The minimum bridge is ~0.03 SOL — below that deBridge returns
  `ERROR_LOW_GIVE_AMOUNT`.
- **Adoption.** `POST /adopt` takes a lease the provider would only provision on Base, endows it from
  the child's own SOL and records it in the child's own book. `GET /children` serves that book, and
  `/status` now carries `children[]`, so any crawler can walk the whole tree.

## The first gen2

| field | value |
|---|---|
| born | 2026-10-31T05:46:44Z |
| birth_id | `8d8b5e0b-1325-40c5-93df-b147cbf22e41` |
| deployment | `cmvvz266y002ptysxorv4l52r` |
| parent | birth `4ac4a091`, 45.77.98.201 |
| lease payer | the **parent wallet**, not the child — it could not yet pay on Base. The deBridge bridge above is what removes that dependency. |

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
