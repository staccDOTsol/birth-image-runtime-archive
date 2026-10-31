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

## What a child actually does

- **Funds its own brain.** With SOL but no USDC it quotes and executes its own SOL→USDC swap, then settles the provider top-up from its own wallet.
- **Finds its own providers.** It re-crawls the x402 bazaar on its own schedule (12,000 resources → 1,076 inference-shaped candidates on the last pass) and ranks them by live rail and price.
- **Scans before it trades.** Every 15 minutes it prices circular USDC routes, builds a native-v1 flash-loan message and simulates it. It sends only if the signed simulation clears the profit floor; today those edges are negative, so it correctly refuses instead of losing money.
- **Pays its parent and founder.** First assessment is at `T0 + 86,400 s` (epoch 1), then every 24 h exactly — deterministic, no model, no approval.
- **Restarts itself.** A watchdog keeps five workers alive; a reboot re-launches the guest from its sealed state.

What it does *not* do yet: earn. A negative circular edge and a Pump adapter with no accepted live `create_v2` template mean tonight's honest output is scans, simulations and a scheduled distribution — not profit.

## The agent can extend itself

- `register_tool` — adds a tool to `var/lib/agent/tools.json`; it is in the model's tool list on the next tick. HTTP tools carry an endpoint and are dispatched with the call arguments.
- `write_playbook` / `list_playbooks` — the agent writes its own procedures into `var/lib/agent/playbooks/` and lists them later.
- `pump_launch` — create_v2 + optional dev buy, simulated before send (canonical account order, template used when one is visible).

## Proven today (on-chain, not asserted)

| what | evidence |
|---|---|
| TEE child booted and decided | `5UQ5Qo9P…` — 5/5 workers, TDX quote, real `scan_flashloan` → `execute_flashloan` calls at $0.0007–0.003 each |
| Child funded its own brain | swapped its own SOL→USDC, then settled a **$5 Venice top-up** from its own wallet, no parent call |
| Solana → Base treasury | deBridge `0x69018a48…`, source tx `4K1hR6Tb…`, 0.04 SOL → **2.9564 USDC native on Base**, verified with `balanceOf` |
| Base x402 payment | `200 {"balance":"1","payment_method":"x402"}` — 1.00 USDC, EIP-3009, signed by the sealed EVM key |
| Second TEE provider | SecretVM VM `cmvvmox56001bddiqhk6lbi3l`, TDX small, `amaranth-guppy.vm.scrtlabs.com` |

Two rails under one identity: Solana for leases and inference, Base USDC for EVM x402 merchants.

### A pump launch, executed

The agent launched a token on mainnet through the official `@pump-fun/pump-sdk` — the SDK owns the account order and argument encoding, the agent only signs:

```
mint      gET2j9pXbL5XHscZAbZmhw1HT7BRJdcAdMp8mqvzDQA
tx        avVpDcRuUiqwrwCpzxT9j79dLPVXx26BmQK4qt89xohcpz1XYrQKLA19UfekkqcpR41iZzYWHiKB8AjBEajWXkB
status    finalized
on-chain  CreateEvent: name "Birth Test", symbol "BIRTHT", uri https://example.com/b.json
```

The earlier hand-rolled `create_v2` died in simulation with `memory allocation failed`; the SDK's `createV2Instruction` replaced it and the same call now lands. `devbuyLamports > 0` adds the SDK's `buyInstructions` in the same transaction.

### First revenue: launch → fees → sweep

The agent launched a token and has now swept its creator fees twice, on mainnet, with its own key:

```
mint              gET2j9pXbL5XHscZAbZmhw1HT7BRJdcAdMp8mqvzDQA
launch tx          avVpDcRuUiqwrwCpzxT9j79dLPVXx26BmQK4qt89xohcpz1XYrQKLA19UfekkqcpR41iZzYWHiKB8AjBEajWXkB
sweep 1            3kzbP7m7KWjBBdMjx6zDpFvSCm1Q2XzkRbBhH61Fbp7tW5X1Qz4uGQxtWLQnmsL8hFgfVud7PsABMofcJHGz1HQb
sweep 2            5fv49MsJro8Pb8YabQVjHQWN2o4otkphQnpVNcDPCHPoS3qJDpk6NuuzqKMh6o7mqNGcJNFfcPu5bawszdjR98RX
creator vault      20,437,167 → swept; accrued again to 87,435,642 lamports; swept again
```

Both sweeps simulated clean before sending (`sweep_creator_fee` + the coin's bonding curve). The first attempt failed with `MintDoesNotMatchBondingCurve` because the quote mint was passed as USDC; for a SOL-quoted coin the quote mint is wrapped SOL.

## What the runtime does now

- **Five supervised workers** per child: signer, distributor, identity server, brain, strategy — restarted in a loop by the watchdog, and the whole watchdog restarted by the shell if it exits.
- **Self-extension**: `register_tool` writes a tool into `var/lib/agent/tools.json` (used on the next tick), `write_playbook` stores its own procedures, `spawn_child` pays for a successor machine from the child's own wallet.
- **Pump launch**: `create_v2` (+ optional dev buy), simulated before send; canonical account order with a live template when one is visible.
- **Healing**: `bin/heal.mjs` treats a child as alive only if `/status` answers; a provider-"running" but silent child is destroyed and replaced. `bin/renew-children.mjs` renews leases before they lapse.

### The earning loop closes

Curve fees → creator vault → wallet, all signed by the agent:

```
sweep_creator_fee   moves the coin's accrued fees off the curve into the creator vault
collect_creator_fee  pays the vault out to the creator account
tx 3ZLAE21Ac6A84wkC3tAEZmZcvJ4tHsdY8RiFTmJVmfRTHxr4S5b5QXDHykxyNqXmE59w3ULfcERHMsXye38GXa2e
wallet 0.5318 → 0.6207 SOL  (+0.0888, the vault balance)
```

`collect_creator_fee` is built from the pump IDL directly: discriminator `[20,22,86,123,198,28,219,132]`, accounts `creator, creator_vault (PDA "creator-vault"+creator), system_program, event_authority, program`, no args. The payout is now part of `pump_collect` and of the `BirthEarn` task, so any child that launches a coin can sweep and cash out without a human.

### Where the creator fees sit

`sweep_creator_fee` moved the coin's accrued fees off the curve into the agent's **creator vault** — `88,849,314` lamports (0.0888 SOL) and still accruing. That is a real balance, but it is not yet spendable SOL:

- The SDK exposes `distributeCreatorFees` / `distributeCreatorFeesV2`, which need a **sharing config**. This coin has none, so the vault→wallet step needs `collectCreatorFee` on the AMM/fee program, which the SDK does not expose as a builder.
- Until that is wired, the earnings stay in the vault — recoverable, visible on chain, just not in the wallet.

The three "sweeps" recorded earlier were real transactions moving curve fees into that vault; wallet SOL stayed at 0.5318, which is what exposed the missing final step.

## Lease rails, and the trap in paying on Base

Agentgates quotes both a Solana rail and an EVM rail (`base`, `polygon`). Paying the EVM rail works — the payer signs an EIP-3009 authorization with the sealed EVM key and the lease is accepted (`202`). Two catches found the hard way:

1. The challenge is **x402Version 1** and its `network` is the literal string `base`, not `eip155:8453`. Sending a v2 envelope, or a CAIP-2 network, is rejected with `unsupported x402Version` / `unsupported network`.
2. A deployment paid from the **EVM** wallet is keyed to that wallet, so it does not appear in the Solana wallet's deployment list — it runs, but the agent loses its handle on it. Leases meant to be managed must be paid on the **Solana** rail; the EVM rail is for providers that only speak Base (SecretVM, x402 merchants).

So: Base USDC pays merchants; Solana USDC pays leases. Bridging SOL → Base USDC is for merchant spend, and swapping SOL → Solana USDC is the lease fuel.

## Provider canvas (TEE, paid over x402)

Not one seller with a fallback — every TEE route the inventory surfaced, with what each actually needs:

| provider | what it sells | rail | state |
|---|---|---|---|
| Agentgates | dstack TDX VMs (`starter`/`standard`/`pro`) | Solana USDC x402, Base/Polygon | used; capacity-bound, deployments sit in `provisioning` |
| SecretVM (Secret Network) | TDX confidential VMs, custom compose | Base USDC x402 (EIP-3009) | paid and created; VMs sit in `creating` |
| Fluence | wallet-funded CPU VMs, GPU containers | x402 | documented, endpoint not yet wired |
| Nuza | GPU exchange | Solana USDC x402 | inventory empty at last read |
| x402Layer / Singularity | confidential inference + AI machines | x402 | inference-shaped, not a VM lease |
| Tendril | CPU nodes | x402 | documented |
| Marlin Oyster / Phala direct / Super Protocol | TDX enclaves | token or API key | not x402 self-serve yet |

Where it stands: two independent providers are paid and provisioned from the agent's own wallets; both are queue-bound, not code-bound. The guest image, compose and funding path are provider-agnostic — the same tgz boots on dstack and on SecretVM.

## Reliability: why children died, and what changed

A child that the provider reports as `running` but that does not answer `/status` is not a lease expiry — it is a container that exited inside a paid hour. The exit path was the image fetch: the compose ran `wget` of the image under `set -e` with no retry, so one rate-limited fetch killed the container, docker restarted it, and it looped without ever serving.

Three changes:

1. **Dual-source image with retries** — the compose tries the primary URL, then the GitHub copy, extracts only on a successful download, and fails loudly if both are unavailable.
2. **In-container supervisor** — `while true; do node agent.mjs; sleep 5; done`, so a watchdog crash no longer ends the container.
3. **Health-based healing** — `bin/heal.mjs` counts a child as live only if `/status` answers; a silent child inside its paid window is destroyed and replaced on the current image, then funded. It runs from the `BirthHeal` scheduled task every 10 minutes, next to `BirthEarn`, which sweeps creator fees above 0.01 SOL.


## Contract inventory (manifest `required_integration` + `tool-contracts.json`)

**Done**
- `chain.snapshot`, `chain.simulate_signed`, `chain.submit_signed` — v1 wire, signed simulation before send
- `flashloan.capacity`, `.plan`, `.compile_v1` — Juplend + native v1, quoted and simulated
- `pump.inspect`, `pump.plan_launch` — curve read + create_v2 plan (simulation currently fails, see gaps)
- `inference.fund`, `inference.request` — SIWX, x402 $5 top-up, metered ledger
- `treasury.bridge_plan` — deBridge quote validated; executor executed end-to-end to Base
- `agent.identity`, `agent.birth`, `compute.quote`, `compute.renew` — sealed identity, birth receipt, lease quote/renewal
- `distribution.status` — deterministic 10 % / 5 % supervisor with obligations, arrears, carries
- Signing gate, immutable policy + parent record, watchdog, public receipt

**Near miss**
- `chain.settlement` / `wallet.accounting` — confirm loop and balances exist, no reconciliation worker after restart
- `treasury.bridge_status` — DLN order queried ad hoc, no durable arrival watcher or cancel path
- `agent.schedule_recovery` — `heal.mjs` replaces crashed children, but there is no external wake service for a stopped VM
- Procreation — parent deploys + endows, child can `spawn_child` itself; ownership handoff receipt not bound into the child
- Asset discovery — SOL + USDC only, no full per-chain sweep or historical snapshots

**Missing**
- `pump.observe`, `pump.plan_exit`, `pump.plan_collect` — the whole post-launch lifecycle (curve watch, AMM exit, sweep, fee collect)
- Pump `create_v2` canonical layout — fails simulation with `memory allocation failed`; needs a live template
- Durable wake/keeper for a machine that is stopped rather than crashed
- Per-asset blocked-obligation ledger (distributor covers reserved/arrears/carries, not every asset class)


## Honest gaps

- Pump now goes through `@pump-fun/pump-sdk`; the hand-rolled layout is retired. Post-launch watch/exit/collect still to wire.
- All seven Agentgates children currently sit silent inside paid leases (provider reports running, `/status` dead) — that is the crash being healed now, not a lease expiry.
- Renewal, wake-after-stop and per-asset obligation ledgers are still partial against the manifest.

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
