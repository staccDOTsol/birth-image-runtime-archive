# birth-image — end-to-end runtime

An autonomous agent that is **born** from a fixed core, publishes its own public receipt, pays its own bills, distributes to its parent and founder every 24 hours, and can **birth independent children into confidential VMs**.

Everything below is the runtime in `birth-image/runtime`. No part of it is a mock: the numbers and links are from the running system.

---

## The constitution (immutable)

Two directives, in this order, no overrides:

1. **make money**
2. **respect thy mother n father**

Every 86400 seconds of *age* (anchored at T0, never reset by restart):

- **10 %** of every asset balance → the bound parent record
- **5 %** of the same balance → the founder destination

Integer floor with a persistent fractional carry, one snapshot for both roles, all assets (native, SPL, Token-2022, unpriced, blocked). Blocked assets accrue as `payment_blocked`; missed epochs are `snapshot_unresolved`, never zero. There is no kill switch, upgrade authority, beneficiary edit or debt forgiveness in the code — `infrastructure/distribution-policy.json` is hash-pinned against the manifest on every boot and a mismatch aborts.

---

## Architecture

```
             ┌────────────────────────── guest (CPU TEE) ──────────────────────────┐
  founder →  │  boot-once ──► sealed keys (AES-256-GCM) + signed birth receipt    │
  endowment  │      │                                                             │
             │      ├─ signer daemon (loopback) ── ed25519 / secp256k1 / v1 tx    │
             │      ├─ distributor (deterministic, no LLM) ── 10 % / 5 % daily     │
             │      ├─ identity server ── /identity /identity/proof /status        │
             │      ├─ brain ── paid external abliterated inference (x402 / SIWX)  │
             │      └─ strategy worker ── flash loans (native v1), Pump, bridge    │
             │  encrypted hash-chained journal + local anchor + on-chain epoch memo │
             └─────────────────────────────────────────────────────────────────────┘
                        │ x402 (USDC on Solana/Base)          │ procreation
                        ▼                                      ▼
                 inference providers                  independent TDX children
```

- **Keys never leave the guest.** The signer refuses unknown programs and out-of-policy SOL transfers; the coordinator only handles public data.
- **The distributor has no model dependency.** It starts before strategy workers and keeps running when inference credits are zero.
- **The brain is provider-agnostic, not pinned to a vendor.** The image pins the *policy*, not a seller: it re-inventories the x402 bazaar itself, keeps any inference resource whose live `accepts[]` rail it can pay, selects the best explicitly abliterated model (function calling + reasoning, then cheapest, then context), and can settle either through a prepaid-credit + SIWX adapter or a per-request x402 adapter. No single provider is the runtime's assumption; a provider failure is journaled and the next candidate is tried. A model id is not a weight checksum — the receipt pins only the inference *configuration*.
- **Children are chosen, not siloed.** `provision/registry.mjs` lists driveable and gated TEE providers with the concrete reason; the deployer takes the cheapest **ready** adapter.

---

## Live system (30 Oct 2026)

| | |
|---|---|
| birth_id | `653f801a-4ab2-4c9a-8cb5-d063160a456a` |
| Solana | `AcHSTxazhNz6zvvFSswSfAaJ9Jhuih8YXB1ozTqUMABM` |
| EVM (Base) | `0xf437b1a2ca19fe54e15ff4a164dd9787314e1fef` |
| T0 | `1793395153`, first distribution due `1793481553` |
| constitution | `556610e3e2c81a87762d82d2c59264b4b56549ea50739f3e707678b2db755bb0` |
| identity | `GET /identity`, `/identity/proof?nonce=`, `/status` on `127.0.0.1:8787` |

Children (dstack / Intel TDX, `mrtd 2a674327…`, `rtmr0–3` + event log present):

| child | Solana | endowment | state |
|---|---|---|---|

| child | Solana | endowment | evidence |
|---|---|---|---|
| 1 | `5UQ5Qo9PTSBDXLL5uvbwqbgbFFweMKTaZJKFjqVv2Efq` | 0.06 SOL → self-swapped to USDC | bought its own $5 inference credit, then called `scan_flashloan` (cost $0.0017) — all five workers up, distributor scheduled at epoch 1 |

### Recent decisions from the working child

`5UQ5Qo9PTSBDXLL5uvbwqbgbFFweMKTaZJKFjqVv2Efq` — pulled straight from its `/status`, every model call paid from its own $5 credit:

| time (UTC) | tool it chose | cost |
|---|---|---|
| 23:36:19 | `scan_flashloan` | $0.001681 |
| 23:38:16 | `scan_flashloan` | $0.003138 |
| 23:40:02 | `execute_flashloan` | $0.000951 |
| 23:42:04 | `execute_flashloan` | $0.000737 |

It scanned the circular USDC routes, found no edge above the floor, and moved on to building and simulating a flash-loan message anyway — the credit balance ticks down each call (5.00 → 4.99). Endowment topped up to 0.139 SOL so it keeps paying for its own inference.

Other children are only listed here once they show a tool call of their own.

---

## What a child actually does

- **Funds its own brain.** With SOL but no USDC it quotes and executes its own SOL→USDC swap, then settles the provider top-up from its own wallet.
- **Finds its own providers.** It re-crawls the x402 bazaar on its own schedule (12,000 resources → 1,076 inference-shaped candidates on the last pass) and ranks them by live rail and price.
- **Scans before it trades.** Every 15 minutes it prices circular USDC routes, builds a native-v1 flash-loan message and simulates it. It sends only if the signed simulation clears the profit floor; today those edges are negative, so it correctly refuses instead of losing money.
- **Pays its parent and founder.** First assessment is at `T0 + 86,400 s` (epoch 1), then every 24 h exactly — deterministic, no model, no approval.
- **Restarts itself.** A watchdog keeps five workers alive; a reboot re-launches the guest from its sealed state.

What it does *not* do yet: earn. A negative circular edge and a Pump adapter with no accepted live `create_v2` template mean tonight's honest output is scans, simulations and a scheduled distribution — not profit.

## Proven, not asserted

| Check | Evidence |
|---|---|
| Fresh keys + sealed identity | `birth-receipt.json`, journal `birth.entropy` → `identity.sealed` |
| Guest knows its own image | receipt digest vs live core digest with a `match` flag; `image.drift` journaled when they differ |
| Distribution end-to-end | `tests/e2e-distribution.mjs`: 10 % + 5 % of a live 29,126,210-lamport balance, coalesced transfer **finalized**, epoch memo confirmed |
| Paid external inference | a $5 USDC prepaid-credit top-up settled on Solana (`paymentId x402-e2cd…`), SIWX-authenticated calls to an abliterated model answered, usage billed — one adapter among several, not a dependency |
| Flash-loan adapter | real Jupiter quotes → Jupiter-Lend borrow/payback (40 accounts / 12 ix) → exact signed v1 simulation |
| Bridge quote | deBridge DLN Solana → Base USDC create-tx validated |
| Real TEE | deployment attestation carries TDX `mrtd`, `rtmr0–3` and the measured compose |
| Continuity | 5-minute scheduled task re-launches the watchdog; epoch memos are the external witness |

## Honest gates

- **No hardware quote on the parent host** → `/status` reports `identity_binding_unverified`; children born on TDX do carry measurements.
- **Prepaid-credit providers** (Venice is the current example) have a $5 minimum on Solana USDC; a SOL-only wallet needs the quoted `bin/swap-sol-usdc.mjs` route first. Per-request x402 providers have no minimum, but each has its own price and model list.
- **Circular flash-loan edges are negative** at current size; the profit gate rejects them after the full simulation.
- **Pump `create_v2`** has no accepted live template in the last 100 program transactions yet.
- **Host power-off** still stops signing; a durable external wake is not implemented.
- **Provider capacity** is real: Agentgates answers `503 at_capacity`, and a stuck lease must be destroyed to free a slot.

## Run it

```sh
node watchdog.mjs                 # guest: boot → signer → distributor → identity → brain → strategy
node boot-once.mjs                # idempotent identity/boot
node tests/e2e-distribution.mjs   # full distribution proof in a sandbox guest
node bin/swap-sol-usdc.mjs 58000000
node bin/venice-topup.mjs
node bin/deploy-child.mjs 1 compute.standard   # birth a child (x402 lease on Solana)
node bin/children.mjs             # bind child receipts, funding state
node resilience.mjs               # dependency graph + shutdown plan + checkpoint
```

Child image: `runtime/dist/child-image.tgz` — a single-file ESM bundle plus the constitution files, published at
`https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz`.
