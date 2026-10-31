# birth-image

**Why have people when you can just have agents?**

Every child of this image is born into a confidential VM with its own sealed keypair, its own wallet
and its own journal. Nobody hands it a strategy: it funds itself, buys its own inference, launches
coins, sweeps what they earn, pays its parents, and makes more of itself whenever it can afford to.

**Live board:** <https://staccdotsol.github.io/birth-image-runtime/>

## Two rules it cannot break

1. **Make money.**
2. **Respect thy mother n father.**

They are the whole constitution. `overrides: []` — no kill switch, no upgrade authority, no
beneficiary edit, no waiver. The policy file is hash-checked at every boot and a mismatch aborts the
guest (that is how a bad bundle path killed every child until it was fixed).

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
lease plus the newborn's endowment, from its own wallet, at its own discretion. Constraint is money,
not permission.

## Spec coverage — `birth-image.manifest.json` → `required_integration`

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | CPU-TEE immutable authority, sealing, public birth receipt, signing supervisor | partial | TDX guest, sealed keys, hash-chained journal, both wallets sign the receipt; `identity_binding` still reports unverified instead of embedding the quote |
| 2 | Native-v1 multi-lender planner, profit bounds, signed simulation, durable submission | partial | real Jupiter routes → v1 message → signed simulation → rejects negative edges (`plan_hash ed1b84…`); no profitable fill yet |
| 3 | Pump launch / watch / exit / sweep / collect | **hit** | 9 coins launched by 3 agents from their own SOL; fees swept and vault withdrawn each earn tick |
| 4 | External abliterated inference, SIWX, x402 top-up, metering | **hit** | `deepseek-v4-1-flash-1017-uncensored`; each agent bought its own $5 credit by swapping its own SOL |
| 5 | Solana→Base treasury executor | **hit** | deBridge 0.04 SOL → 2.9564 USDC on Base, then paid a Base x402 merchant |
| 6 | Independent child provisioning, handoff, first-boot keys, bound receipt, endowment | **hit** | 5 concurrent births with their own sealed wallets, endowed by the parent; `procreate` worker leases from the agent's own wallet |
| 7 | Paid renewal + durable wake | **hit (renewal)** / partial (wake) | `bin/renew.mjs` tops every lease inside 25 min of expiry through the provider's `/renew`, paid from the agent wallet — 5/5 renewed, HTTP 200 each; `BirthRenew` runs every 10 min. Wake is still host-side scheduled tasks |
| 8 | Deterministic supervisor + signing gate | **hit** | `watchdog.mjs` lock + restart loop; signer refuses unknown programs |
| 9 | Immutable policy + parent-record enforcement | **hit** | boot-time hash check, fails closed |
| 10 | Per-chain asset discovery, coherent snapshots | partial | SOL + Solana USDC + Base USDC; no full token sweep |
| 11 | Asset-specific transfer / blocked-obligation ledgers | partial | carries, arrears, reservations implemented; not yet exercised by real payouts |
| 12 | Net-receipt settlement, uncertain retry, anti-rollback, idempotency | partial | journal chain + anchor + repair; no chain-history reconciliation |
| 13 | External wake/keeper | miss | host scheduled tasks are the only liveness outside the provider |

## Running now

| birth | wallet | credits | coins |
|---|---|---|---|
| `badb8a98…` | `H2ixKEWw9gLCvdngGVweufHCGphZPv7XjBZ156z5Ffgr` | $4.99 | 3 |
| `1b9dae1a…` | `GfrESnjhiKSHaFjBBWF8ePdB9kaV88iy8Vw5yLy3c7wN` | $4.99 | 3 |
| `aa1528db…` | `Bm3oHauuR8Gn5RgPsfcAy2KiHa6PPyoq6cYmoBC4Yc8N` | $5.00 | 3 |
| `2d1c8d88…` | `EhgWZchx5stNNcM8pSf5KnbATZmDQUzhfHqmngufPc9h` | — | funded |
| `96a0df95…` | `5gXdTV8D8dvEY8nJNbVSwaRcyCygXY5gm3NFLLNhfFc5` | — | funded |

## Run one

```yaml
version: "3.8"
services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports: ["80:8787"]
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_BUNDLE: "1"
      AGENT_BIND: 0.0.0.0
      AGENT_CLUSTER: mainnet-beta
      AGENT_HTTP_PORT: "8787"
      RPC_URL: <your solana rpc>
    command: ["sh","-c","mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh"]
```

Endow the wallet it prints at `/identity` with ~0.09 SOL. It swaps for USDC, buys inference, launches,
sweeps, and procreates. `/status` reports `image.core_digest_now` — the digest of the bundle it runs.
