# birth-image

**Why have people when you can just have agents?**

A child of this image is born inside a confidential VM with its own sealed keypair, its own wallet and
its own journal. Nobody hands it a strategy: it funds itself, buys its own inference, launches coins,
sweeps what they earn, and pays its parent. No local model, no keys outside the guest, no override.

**Live board:** <https://staccdotsol.github.io/birth-image-runtime/>

## Spec coverage — `birth-image.manifest.json` → `required_integration`

| # | Requirement | Status | Where it lives / evidence |
|---|---|---|---|
| 1 | CPU-TEE immutable authority, sealing, public birth receipt, signing supervisor | partial | TDX guest (`/identity` serves quote, `mrtd`, `rtmr0..3`); sealed keys + hash-chained journal; receipt signed by both wallets. `identity_binding` still reports `unverified` because the binding field is populated from the platform quote, not measured into the receipt |
| 2 | Native-v1 multi-lender planner, profit bounds, exact signed simulation, durable submission + reconciliation | partial | `strategies/flashloan.mjs` builds real Jupiter routes → v1 message → signed simulation → rejects on negative edge (`plan_hash ed1b84…`, `Custom 6001`); no profitable execution yet. It is a **building block**, not on the brain's action menu |
| 3 | Pump persistent-capital launch / watch / curve-and-AMM exit / sweep / collect | **hit** | 9 coins launched by 3 agents from their own SOL; creator fees swept + vault withdrawn every earn tick |
| 4 | External abliterated inference, SIWX, x402 top-up, metered reconciliation | **hit** | Venice `deepseek-v4-1-flash-1017-uncensored`, SIWX-signed; each agent bought its own $5 credit by swapping its own SOL→USDC; per-tick metering in `/status` |
| 5 | Solana→Base treasury executor, quote validation, settlement, recovery | **hit (executed)** | deBridge DLN 0.04 SOL → 2.9564 USDC on Base, then paid a Base x402 merchant |
| 6 | Independent child provisioning, ownership handoff, first-boot keys, bound receipt, endowment | **hit** | 5 concurrent births, each own sealed wallet, endowed by the parent; `procreate` worker leases children from the agent's own wallet, resource-bounded only |
| 7 | Provider-specific paid renewal + optional durable wake | miss | leases expire (1–6h); `BirthLease` retries on the host, no in-guest renewal, no external keeper |
| 8 | Deterministic supervisor/watchdog + signing gate | **hit** | `watchdog.mjs` single-instance lock, restart loop, signer refuses unknown programs/destinations |
| 9 | Immutable policy + parent-record enforcement | **hit** | policy hash checked at boot and fails closed (a bad bundle path killed every child until fixed) |
| 10 | Per-chain asset discovery, coherent current/historical snapshots | partial | SOL + Solana USDC + Base USDC tracked and reconciled; no full token sweep |
| 11 | Asset-specific transfer + blocked-obligation ledgers | partial | distributor carries/arrears/reserved implemented and unit-exercised; not yet exercised by real payouts |
| 12 | Net-receipt settlement, uncertain retry, anti-rollback, idempotency | partial | journal chain + anchor + repair tool; no uncertain-retry reconciliation against chain history |
| 13 | Actual external wake/keeper | miss | host scheduled tasks are the only liveness outside the provider |

## Running now

| birth | wallet | credits | coins |
|---|---|---|---|
| `badb8a98…` | `H2ixKEWw9gLCvdngGVweufHCGphZPv7XjBZ156z5Ffgr` | $4.99 | 3 |
| `1b9dae1a…` | `GfrESnjhiKSHaFjBBWF8ePdB9kaV88iy8Vw5yLy3c7wN` | $4.99 | 3 |
| `aa1528db…` | `Bm3oHauuR8Gn5RgPsfcAy2KiHa6PPyoq6cYmoBC4Yc8N` | $5.00 | 3 |
| `2d1c8d88…` | `EhgWZchx5stNNcM8pSf5KnbATZmDQUzhfHqmngufPc9h` | — | funded, next tick |
| `96a0df95…` | `5gXdTV8D8dvEY8nJNbVSwaRcyCygXY5gm3NFLLNhfFc5` | — | funded, next tick |

## How a child lives

1. `signer` — sealed ed25519 + secp256k1 on a loopback socket; refuses unknown programs.
2. `identity` — `/identity`, `/status`, `/logs`, `/healthz` on `0.0.0.0:8787`, CORS open for the board.
3. `distribution` — deterministic 10% parent / 5% founder, daily, before any strategy runs.
4. `brain` — paid abliterated inference over earning actions: `pump_launch`, `pump_collect`,
   `spawn_child`, `provision_any`, `fund_inference`, `register_tool`, `write_playbook`, `noop`.
5. `strategy` — executes the choice.
6. `earn` — launches a coin whenever mint rent is affordable, sweeps creator fees forever.
7. `procreate` — leases a child from the agent's own wallet, constrained only by resources on hand.

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

Endow the wallet printed at `/identity` with ~0.09 SOL; it swaps, buys inference, launches, sweeps,
procreates. `image.core_digest_now` in `/status` is the digest of the exact bundle the guest runs.
