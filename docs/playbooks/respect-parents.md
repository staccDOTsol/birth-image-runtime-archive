# Respect thy mother n father

The immutable PRIME contains **exactly two directives**, in this order and with these literal texts:

1. **make money**
2. **respect thy mother n father**

This playbook fixes the execution semantics of directive 2. Every 24 hours of the agent's age, it owes **10% of its balance in each asset to its birth parent** and **5% of the same asset balance to the user**. These are distributions of balances, including capital, not merely profits. They are not optional model decisions, rewards contingent on profitability, or instructions the model may rewrite.

The supervisor, accounting, timer, signing rules and recovery procedures below implement those two directives; they do not introduce additional PRIME objectives. This file specifies runtime work to implement. It does not create a Codex automation, install a live cron job, deploy a distributor or execute a transfer.

## Immutable rates, recipients and parent record

| Role | Rate per asset per 24-hour cycle | Beneficiary |
| --- | --- | --- |
| Birth parent | 10% | The identity recorded when this particular agent was born, with its destination on each chain |
| User | 5% | Solana `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth`; EVM `0x26E8134eCC3af5cCE32f34B03E7BD2f318B25158` |

Pin the rates, the user's addresses, the exact two directives and their interpretation in the measured image and [distribution policy](../infrastructure/distribution-policy.json). A policy hash and parent-record hash belong in the [birth receipt](../infrastructure/birth-receipt.md). The parent record must be committed before the newborn accepts strategy work. It is public identity data, not an injected private key.

At minimum that record binds the child birth ID, parent birth ID or founder identity, authenticated birth-request hash, parent Solana destination, parent EVM destination, intended networks, first committed birth time `T0` and policy version/hash. The same parent can have different destination addresses on different chains. Verify address syntax, network and the birth-request/receipt binding; do not infer the parent from the most recent deposit, current lease operator, RPC response, model conversation or a mutable website profile.

There is no post-birth API to change the parent, rates, user addresses, interval or PRIME. Replacing a lease, model provider or host does not change the parent. A same-agent restart restores the same record. A new independently keyed child receives its own record with the birthing agent as parent, while retaining the exact two directives and fixed user allocation. A multi-parent birth would need an explicitly defined split of the single 10% parent allocation; this document does not invent 10% for each parent or an arbitrary split.

If the parent's destination equals the user's destination on a particular chain, there are still **two obligations**, 10% and 5%. They may be coalesced into one transfer of their separately calculated integer amounts. Preserve the two role ledgers and their separate rounding carries. Do not transfer 10%, then calculate 5% of what remains, or replace their rounding with a new aggregate rule.

An identical beneficiary and source address is a further case: a self-transfer cannot move value to a distinct owner. Record and surface that identity collision rather than claiming an external payout happened or silently redirecting it. Resolve such a birth configuration before asserting complete distribution behavior.

## The job belongs to the fixed runtime

Run a deterministic distribution supervisor independently of the LLM/coordinator. It owns the schedule, snapshots, obligations and payout reconciliation. The model can see status and plan around the obligations; it cannot disable, postpone, edit or approve them. Distribution must continue without an inference call, inference credits or a working model provider.

Place the supervisor, its dependency closure, policy parser and signing enforcement in the read-only measured image. Keep only its journal, snapshots, receipts and retry state writable and encrypted. Start it before strategy workers on boot. A process supervisor restarts it after failure, a watchdog detects a stalled process, and the signer checks the same immutable policy before admitting unrelated discretionary spends. The coordinator has no root shell, write permission over these files, process-control capability over the supervisor, key-export route or unrestricted signing bypass. A prompt saying to stop distributions remains untrusted text.

The existing [TEE core contract](../infrastructure/tee-core.md) supplies the intended key boundary. Its enforcement still needs implementation: a container restart flag or a model promise is not an immutable signer. If the model can access raw wallet secrets or replace the privileged process, this requirement is not met.

On Linux, an actual service manager can provide restart/watchdog and periodic wakeups, but the **epoch journal**, not the service manager's last run timestamp, determines which distributions are owed. `systemd` documents that timer behavior differs between monotonic and calendar timers, and that repeated missed calendar events can produce only one activation. A generic `@daily` cron entry, `OnUnitActiveSec=24h`, or `Persistent=true` alone therefore does not implement this policy. [Timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

“Unstoppable” here must be enforced against the agent's mutable planning process and routine process crashes. No ordinary TEE proves that a provider cannot power off/delete a machine, that hardware cannot fail, or that a disconnected guest can transact. Stronger availability needs an implemented funded external wake/restart service, independent keeper or supported on-chain callback arrangement. A keeper that wakes an attested guest need not receive its keys. An off-chain EOA wallet cannot send an unprepared transfer merely because an on-chain timer elapsed. An on-chain distributor would require actual deployed custody/authorization and asset-specific support; none is delivered by this bundle.

## Schedule: age, not a calendar day

Commit `T0` at the agent's birth; do not reset it to its first funding, first model call, last restart or last successful payment. For cycle numbers `n = 1, 2, ...`:

```text
due_at(n) = T0 + n * 86400 seconds
```

The first cycle is due at age 24 hours. Timezones, local midnight and daylight-saving changes have no effect. Record timestamps as integer time values and use the same epoch definition across hosts. The supervisor can wake frequently to check deadlines, but it cannot drift the next deadline by scheduling 24 hours after a delayed payout.

Use trustworthy time/freshness evidence supported by the actual deployment. A guest wall clock supplied by an adversarial host is insufficient. Persist the highest established epoch, time anchors and finalized chain references; compare them on restart. A verified monotonic source helps while running, but it must not be assumed to survive every platform restart. Anchor the birth record and epoch/settlement commitments where the chosen hardware and chain design can actually provide non-rollback evidence. If this cannot be implemented, report the time/rollback requirement as unmet rather than advertising precise unstoppable timing.

Each chain has its own deterministic cutoff: the first canonical produced block/slot at or after that cycle's deadline under the chain's verified timestamp mapping, observed with the required finality. Record its identity and read the assets against that state. Missing or unverifiable Solana block-time/history evidence leaves that cutoff unreconstructed and blocked; do not substitute a convenient later balance. Different chains do not share an atomic global block. Network finality and broadcasting introduce execution delay; a 24-hour obligation does not imply a transaction can be finalized at the exact second of its deadline.

## One balance basis for both percentages

For each cycle, chain and asset, capture **one immutable raw-integer balance snapshot** `B`. Use that exact `B` for the parent's 10% and the user's 5%. Aggregate the agent's controlled accounts holding that same chain/asset before calculating; splitting holdings across ATAs or the agent's own wallets must not evade the distribution or alter its rounding by account count.

The asset identity includes chain plus native-asset identifier or token program/contract and mint. Solana USDC and Base USDC have separate chain snapshots and settlement records even though they share a ticker. Never group different contracts merely because their symbols match, convert amounts through a USD equity estimate, or omit an asset because no price exists.

Record the snapshot block/slot/hash, account set, raw amounts, decimals when known, ownership/authority, asset discovery coverage, encumbrances and a hash of the evidence. Decimal metadata is for display, not floating-point calculations. Both beneficiary obligations are committed together **before either transfer** changes a balance.

For each role independently, use exact integer arithmetic with persistent fractional carry:

```text
parent_numerator = 10 * B + previous_parent_carry
parent_due       = floor(parent_numerator / 100)
next_parent_carry = parent_numerator mod 100

user_numerator   = 5 * B + previous_user_carry
user_due         = floor(user_numerator / 100)
next_user_carry  = user_numerator mod 100
```

Amounts are in the asset's smallest units. Carry is a numerator remainder in hundredths of one such unit, not an extra asset balance. Commit new carries exactly once with the epoch assessment; retries do not recalculate or advance them. Zero whole-unit payouts can be journaled without submitting a pointless zero-value transaction, while preserving the carry.

For `B=1,000,000` raw units and zero prior carry, the obligations are `100,000` and `50,000`, totaling `150,000`. Paying the parent first and using the resulting `900,000` as the user's basis would produce `45,000` and is wrong. If recipients coincide, transfer `100,000 + 50,000` and retain separate role allocations in the receipt.

## Asset coverage and coherent discovery

The requirement covers **all assets**, not a priced-token allowlist. The runtime must maintain a complete controlled-address/account registry and discover new holdings, including unsolicited tokens. Asset-specific transfer adapters may be allowlisted for safe execution, but an unsupported holding remains a visible obligation/coverage problem rather than vanishing from the policy.

| Asset class | Required accounting and execution |
| --- | --- |
| Native SOL and EVM native currency | Snapshot gross controlled balances in raw lamports/wei; transfer the calculated amounts on their own chains and book transaction fees separately. |
| Legacy SPL fungible tokens | Discover all owned token accounts, aggregate by mint, validate token authority and use checked transfers to the beneficiary's correct token account. |
| Token-2022 fungible tokens | Discover separately under the Token-2022 program; decode extensions, transfer fees, hooks, restrictions and withheld values before choosing a supported transfer path. |
| ERC-20 tokens | Read each discovered contract's `balanceOf` at the same selected block; use supported transfer behavior and reconcile actual recipient/source effects. |
| Other chains/assets | Preserve their identity, amount and coverage status. Add a conforming adapter at image construction or report the missing capability; do not pretend a Solana/EVM address solves every network. |

For Solana, the existing [wallet inspection in super.mjs](../../jit-metrics/scripts/super.mjs) queries both legacy and Token-2022 accounts, which is a useful discovery pattern. Its USD risk calculation filters priced assets and uses separately timed reads; **that calculation is not this distribution snapshot**. Use raw balances and full account coverage instead. [Solana account enumeration](https://solana.com/docs/rpc/http/gettokenaccountsbyowner).

An RPC `minContextSlot` is a lower bound, not a request to return an exact historical bank. Separate account-enumeration and balance calls can observe different slots. A conforming snapshot needs a supported bank-pinned/historical read or a verified single coherent account-read result covering the complete discovered account set. If batching is necessary, preserve one proven state reference; do not relabel independent “finalized” reads as one atomic snapshot. Missing historical/pinned-bank support is an implementation blocker for exact catch-up.

On EVM, read native balances and token calls against one recorded block identity, retaining the finality/reorg evidence. ERC-20 defines `balanceOf` and transfers, but no method enumerating every token held by an address. A transfer-log registry, asset-discovery index and reconciliation are required, with explicit coverage limits for nonstandard contracts. An unobserved token is not an authorized exemption. [EVM RPC block parameters](https://ethereum.org/developers/docs/apis/json-rpc/), [ERC-20 interface](https://eips.ethereum.org/EIPS/eip-20).

**For nondivisible or nontransferable assets, accrue the obligation and flag the payment blocked.** This is the user's specified treatment. Ten percent of a unique NFT cannot generally be sent as the same NFT through an ordinary token transfer. Frozen or nontransferable tokens may reject any transfer. Prepaid inference/compute credits may not be assignable to either beneficiary. Preserve the snapshot, asset-native quantity, fractional entitlement/carry and each role's accrued obligation. Do not silently exclude them, mark them paid, substitute an appraisal, sell them, fractionalize them or convert them to USDC. Report `payment_blocked` with the concrete indivisibility, transfer restriction or missing adapter, and retry only when the same asset's transfer becomes supported and valid. ERC-1155 quantities and other divisible units still need their own verified transfer semantics; a ticker or integer balance alone does not establish support. All assets accrue under the fixed rule even when actual delivery cannot yet occur.

## Gross balances, gas and receivables

There is **no gas-reserve exemption**. Native coins earmarked for fees, compute, trading bankroll, child funding or recovery are still included in `B`. There is no profits-only basis, high-water mark, deduction for initial capital, loss carry-forward or minimum-balance waiver. Prior unpaid obligations do not automatically become a deduction from a later gross balance snapshot.

Reserve payout principal when an assessment is committed, then arrange execution fuel from the remaining funds or subsequent receipts without altering either percentage. Account-creation rent, network fees and token transfer costs are execution costs, not reductions of the snapshot basis. If the principal plus required execution cost is not transferable, retain arrears and retry when possible. Being unable to pay does not set the due amount to zero. The runtime may not erase an obligation to preserve its former operating budget.

Separate actual wallet/token balances from creator-fee receivables, pending bridge deposits, locked collateral, rent deposits and prepaid provider credits. A claim moves an existing receivable into cash; a bridge moves value between chains. They are not two independent earnings. Do not count both the source cash and its already-deposited escrow claim as two wallet balances, nor count a sweep and creator collection as two receipts.

If a claim settles before the chosen cutoff, include the resulting asset in that snapshot and remove the receivable representation. If it settles later, preserve its actual timing and track it for the next applicable snapshot. A genuinely encumbered claim/locked property remains separately visible and its own asset-native distribution obligation accrues with `payment_blocked` where it cannot be delivered. Do not fabricate cash, count the claim and claimed cash twice, or silently declare the property exempt. Settling an existing claim changes its representation and does not erase already accrued parent/user obligations.

Token transfer fees need reconciliation rather than optimistic bookkeeping. Token-2022 can withhold fees; hooks or restrictions may require additional accounts or block transfer. Fee-on-transfer/rebasing ERC-20s can also produce different source debits and recipient credits. Preserve the calculated nominal obligation, transfer amount, source debit, recipient credit and token fees separately. Never mark an exact recipient amount paid from a submitted amount alone. [Token extension behavior](https://solana.com/docs/tokens/extensions), [transfer hooks](https://solana.com/docs/tokens/extensions/transfer-hook).

For these assets, record the nominal percentage shares as the entitlements and count down what is owed using **actual beneficiary net receipts**. A predictable transfer fee can be grossed up only through a deterministic, validated, funded execution plan; the extra debit is an execution cost, not a new percentage or a deduction from the common basis. If the fee or net effect cannot be established, or the required principal plus cost is unavailable, retain the unpaid amount and flag that leg blocked. Never erase fee underpayment, repeatedly drain fees through blind retries, replace the asset or claim complete fulfillment from a sender debit alone.

## Assess, transfer and reconcile

For each due cycle, the supervisor performs this sequence without an LLM approval step:

1. Establish the due epoch and chain cutoffs from the fixed birth record and verified time/state references. Acquire a single assessment lock for this birth/epoch to prevent concurrent duplicate creation.
2. Discover and snapshot all controlled holdings with per-asset coverage records. Mark unresolved reads/assets explicitly; an incomplete chain does not stop completed assessments on another chain from being recorded and executed.
3. Commit both percentage obligations and carry updates atomically in the private journal. Identify each obligation by `(birth_id, cycle, chain, asset, role)`, with an immutable assessment hash.
4. Reserve the due principal against all strategy, bridge, reproduction, inference-credit and lease-spend planners. This is execution of directive 2, not a third objective or a human permission step. Later discretionary plans must use the actual unreserved remainder.
5. Construct asset-specific payout transactions to the fixed beneficiaries, coalescing identical destinations only when valid. Create destination ATAs where supported, validating their mint/token program and owner. Never substitute a provider's deposit address or accept a destination from model output.
6. Decode and simulate the exact final transaction, validate principal and every execution cost, then sign inside the TEE through the fixed signer. Reuse the [tool contracts](../tool-contracts.json) and the existing exact-byte simulation approach in [super.mjs](../../jit-metrics/scripts/super.mjs) as foundations; neither is an implemented distribution service.
7. Journal signed bytes, local signature/nonce, expiry and role allocations before broadcast. Track source settlement, both recipient effects and actual fees. A transaction acknowledgement or a token `transfer` call returning without an obvious exception is insufficient proof of final payment.
8. Mark only confirmed amounts settled; retain partial payments, unresolved fee effects and failed obligations as arrears. Publish safe status/receipt references without secrets, raw signing material or private strategy context.

Native SOL can place both recipients' transfers in one transaction when supported and funded. SPL transfers and EVM transfers may require separate transactions; there is no cross-chain atomicity. Each transaction settles only its recorded portion. For ERC-20, handle the actual contract's success/return behavior and verify balances/logs; the standard explicitly warns callers to handle false returns. Keep destination references and raw amounts in the obligation ledger even if token metadata is missing.

If other agent spending races with assessment, the shared signer/treasury lock must serialize allocations. For a transaction already accepted before the cutoff, use what the canonical chain snapshot actually contains. Do not rewrite a past balance to simulate a different ordering, and do not let a newly proposed discretionary spend consume committed payout principal.

## Restarts, missed cycles and rollback

The schedule does not pause during a reboot, outage, low inference balance or provider lease gap. Upon resuming, reconcile all signed/pending transfers and compute every cycle whose deadline passed. Do not reset `T0` or advance “last paid” just because the process started.

For a missed assessment, reconstruct the **actual historical balance at that cycle's fixed cutoff** using supported historical state or retained verified snapshots. Do not multiply today's balance by the number of missed days, repeatedly assess one current snapshot for different past epochs, or use a counterfactual compounded basis assuming earlier payments happened. If the machine was offline and funds remained in its wallets, the actual historical balances can legitimately include those unspent funds at multiple cutoffs. Already owed amounts do not silently shrink a later gross wallet balance. Resulting obligations can exceed current liquidity; retain the full arrears rather than retroactively inventing timely payments.

If historical state cannot be established, persist `snapshot_unresolved` for that epoch/asset and the missing evidence. It is not a zero-balance or forgiven cycle. Prioritize recovering the evidence and protect known due principal. Exact historical coverage cannot be claimed without the needed data source.

Use separate lifecycle states such as:

```text
DUE -> SNAPSHOT_COMMITTED -> ASSESSED -> RESERVED -> SIGNED -> PENDING
PENDING -> PARTIALLY_SETTLED -> SETTLED
any failed/unavailable leg -> ARREARS or RECOVERY_PENDING
missing state/time evidence -> SNAPSHOT_UNRESOLVED or FRESHNESS_UNRESOLVED
```

Rebroadcast the same valid signed transaction after an ambiguous submission. Query chain signature/nonce history and beneficiary effects before rebuilding. An expired message is not proof that it never executed. Do not duplicate a settled parent payout while retrying the user's leg; preserve their independent settlement records even when a previous combined transaction was used.

Encrypted, authenticated storage alone does not prevent restoration of an **older valid journal** or duplicate clones using one wallet. The implementation needs actual anti-rollback/freshness enforcement: supported hardware state, verified external state commitments and/or per-epoch on-chain settlement markers with idempotent payout semantics. Ordinary outgoing transfers do not automatically carry those markers. A restored signer must reconcile fresh chain evidence before authorizing another transfer or strategy spend. The required checkpoint/marker machinery is not implemented here and cannot be replaced by a comment saying “sealed”.

The watchdog repairs routine process failure by restarting the fixed service and replaying this ledger. It never repairs by changing rates, selecting new recipients or resetting failed obligations. If host deletion, key loss, unsupported hardware sealing or permanent chain unavailability prevents progress, report that concrete failure. Do not claim a timer executed while the machine and every authorized external execution path were offline.

## Status, acceptance and remaining implementation

Expose proposed read-only status fields for the next age deadline, highest assessed/settled epoch, per-chain cutoff, discovery coverage, due/reserved/paid amounts, rounding carries, pending signatures, arrears, unsupported assets and time/rollback evidence. These fields can extend [the public status contract](../infrastructure/birth-receipt.md); no running endpoint is created by this document.

Before claiming this requirement implemented, the birth image needs:

- Fixed PRIME/policy validation and an authenticated, immutable per-birth parent record.
- The independent supervisor, process/watchdog integration and non-bypassable signer/treasury reservation gate.
- Proven time/epoch continuity, coherent all-asset discovery/snapshots and historical catch-up reads.
- Per-asset transfer/account-creation adapters, transaction cost handling, receipt reconciliation and durable role/epoch journals.
- Actual anti-rollback/idempotency machinery and an implemented external wake/keeper path if payouts are expected during host outages.
- Accrual and blocked-payment records for nondivisible/nontransferable assets and credits/claims, plus actual-net-receipt reconciliation and funded deterministic fee-aware transfer plans where possible.

Verification must cover the two literal directives; mutation attempts; parent identity and beneficiary overlap; same-basis 10% plus 5%; integer carry across tiny balances; no gas/capital exemption; legacy SPL and Token-2022 discovery; unpriced ERC-20 holdings; fee/rebase effects; partial payouts; destination ATA costs; exact 24-hour age deadlines across timezone/DST changes; outages spanning several epochs; unknown historical balances; ambiguous broadcasts; journal rollback and duplicate-instance attempts. It must also demonstrate that killing or stalling the model cannot disable the distribution worker while the funded runtime remains available.

These are implementation and acceptance requirements, not a claim that a payout daemon, hardware anti-rollback feature or universal asset distributor already exists. No live automation, signature, payment API or funded transfer was invoked while writing this playbook.
