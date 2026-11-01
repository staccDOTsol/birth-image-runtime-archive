# Pump launch strategy: first buy, observe, exit, collect

This is the persistent-capital Pump strategy for the birth image. It is separate from the multi-lender flash-loan strategy. The agent pays for a new coin and its first purchase from its own SOL, holds the tokens across transactions, observes actual trading, then sells and collects its creator fees. No lender balance or flash-loan repayment enters this strategy.

The working napkin budget is **about 2% round-trip leakage plus launch/account/network costs**, after recovering the agent's own creator fees, while the position remains on the ordinary bonding curve. The executor uses exact current quotes and actual cash movements. Graduation is a structural boundary: another transaction can complete the curve before the agent's exit lands, so the image must include a post-migration exit path from birth.

## What already exists and what still needs implementation

The user's [pumpfun-source](../../pumpfun-source/README.md) contains reconstructed on-chain programs, captured binaries, current IDLs and extensive offline differential checks. Its [scope](../../pumpfun-source/AGENTS.md) excludes off-chain executors and SDKs. Reuse those program interfaces and recovered accounting; place any new execution adapter in `birth-image`, outside that repository.

**There is no live launch/watch/sell executor established by the inspected files.** This document specifies that missing adapter. The commands below run existing offline checks; none launches a coin. Do not present a differential fixture, this document or a model-generated transaction proposal as an implemented trading system.

| Required behavior | Existing evidence to reuse |
| --- | --- |
| Token-2022 creation and initial reserve setup | [create_v2.rs](../../pumpfun-source/programs/pump/src/create_v2.rs), [creation fixture](../../pumpfun-source/scripts/pump_create_v2_differential.py) |
| Current ordered accounts, argument encodings and discriminators | [Pump IDL](../../pumpfun-source/evidence/upstream/pump.json), [PumpSwap IDL](../../pumpfun-source/evidence/upstream/pump_amm.json), [Fees IDL](../../pumpfun-source/evidence/upstream/pump_fees.json) |
| Bonding-curve buys, sells, fee retention and completion checks | [trade_v3.rs](../../pumpfun-source/programs/pump/src/trade_v3.rs), [integer fees](../../pumpfun-source/programs/pump/src/util/fee.rs), [recovered arithmetic tests](../../pumpfun-source/tests/test_recovered_curve_arithmetic.py) |
| Creator identity and payout behavior | [creator assignment tests](../../pumpfun-source/tests/test_creator_assignment_captured.py), [creator collection source](../../pumpfun-source/programs/pump/src/creator/collect_creator_fee.rs), [collection tests](../../pumpfun-source/tests/test_creator_fee_collect_captured.py) |
| Moving retained fees into the creator vault | [curve sweep](../../pumpfun-source/programs/pump/src/sweep_fees.rs), [sweep tests](../../pumpfun-source/tests/test_sweep_fees_captured.py) |
| Migration and AMM exits | [migrate_v2.rs](../../pumpfun-source/programs/pump/src/migrate_v2.rs), [migration quote fixture](../../pumpfun-source/scripts/pump_migration_v2_quote_differential.py), [AMM v2 trading](../../pumpfun-source/programs/pump-amm/src/instructions/swap/trade_v2.rs), [AMM trade fixture](../../pumpfun-source/scripts/pump_amm_trade_v2_differential.py) |
| AMM creator fee recovery | [pool sweep](../../pumpfun-source/programs/pump-amm/src/instructions/sweep_fees.rs), [collect_coin_creator_fee](../../pumpfun-source/programs/pump-amm/src/instructions/coin_creator/collect_coin_creator_fee.rs), [collection fixture](../../pumpfun-source/scripts/pump_amm_collect_differential.py) |
| Eligible accumulator rent recovery | [account lifecycle tests](../../pumpfun-source/tests/test_account_lifecycle_captured.py) |

The inspected local [IDL provenance](../../pumpfun-source/evidence/upstream/provenance.json) pins official `pump-public-docs` commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`, retrieved October 24, 2026. Differential success against a captured binary proves the tested behavior for that capture, not that a future deployed upgrade is identical. Before arming, compare deployed program identity and required account layouts with the image's supported versions. An unsupported change pauses new launches; it does not trigger downloading executable updates into the immutable image.

## Birth-image prerequisites

The image contains the fixed CPU-TEE coordinator, signer, strategy adapter and supported ABI. Its active brain is [paid external abliterated inference](../infrastructure/external-inference.md); wallet custody and private state follow [the CPU-TEE contract](../infrastructure/tee-core.md). No local model weights, Engram files or GPU rental are required. Model access and tool readiness remain acceptance checks before trading.

At first boot, generate the agent's Solana signing key and any separate compute-payment wallet keys inside the TEE. Persist secrets through the image's protected encrypted-state mechanism. Keep wallet seeds and mint private keys out of configuration files, logs and public evidence. The initial funder may send capital to published public addresses; that does not give it signing keys or a recovery override. Restart and vendor migration must use the common image's verified state-continuity procedure, rather than generating a replacement wallet for an existing position.

Separate the trading bankroll from the survival reserve needed for compute, inference, RPC and recovery transactions. This playbook spends persistent SOL. Paying a compute provider in another asset or chain is a separate treasury operation with its own recorded cost and execution policy.

## Configuration contract

The following is a **required adapter configuration schema**, not a claim that a loader for it already exists. The agent selects numeric budgets from its current capital and objective before committing a launch plan. The immutable code defines how to validate and bind that plan; it does not require a founder to supply permanent capital-allocation ceilings. Once a plan is accepted, different transaction bytes cannot enlarge its signing limits. Changing a budget requires a new journaled plan and fresh validation.

```yaml
strategy: pump_launch
capital_source: agent_owned_persistent_sol
cluster: mainnet-beta
quote_asset: SOL
creator: derive_from_agent_solana_public_key
launch_mode:
  is_mayhem_mode: false
  is_cashback_enabled: false
  is_holder_reward: false
  creator_fee_bps: 0 # standard schedule; SOL pairs ignore a custom rate
  fee_sharing: disabled
programs:
  pump: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
  pump_amm: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
  pump_fees: pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
policy:
  max_concurrent_positions: REQUIRED_INTEGER
  max_launch_wallet_debit_lamports: REQUIRED_INTEGER
  max_total_locked_capital_lamports: REQUIRED_INTEGER
  max_creation_and_account_deposits_lamports: REQUIRED_INTEGER
  max_network_and_priority_fees_lamports: REQUIRED_INTEGER
  max_tip_lamports: REQUIRED_INTEGER
  recovery_sol_reserve_lamports: REQUIRED_INTEGER
  target_realized_profit_lamports: REQUIRED_INTEGER
  target_max_loss_lamports: REQUIRED_INTEGER
  max_hold_seconds: REQUIRED_INTEGER
  max_quote_age_slots: REQUIRED_INTEGER
  max_submission_attempts: REQUIRED_INTEGER
  exit_slippage_bps: REQUIRED_INTEGER
  migration: support_existing_canonical_pool_and_budgeted_migrate_v2
  loss_exceeds_target: REQUIRED_HOLD_OR_REDUCE_WITH_EXPLICIT_LOWER_FLOOR
```

Reject unresolved `REQUIRED_*` fields. A wallet-debit cap and encoded minimum output are transaction constraints; `target_max_loss_lamports` is a planning target, not a guaranteed stop price. If the market cannot fill that floor, the agent must follow the configured hold/reduce policy and report the remaining inventory. It cannot both force an immediate exit and guarantee its target loss.

The launcher remains a normal fresh SOL-paired coin. Do not silently opt into Mayhem, Holder Rewards, deprecated cashback, charity routing, creator fee sharing or a custom quote asset. Those change the assumptions and require their own supported configuration.

## Daily distributions and inventory changes

The [respect-parents playbook](respect-parents.md) applies to the minted tokens as well as SOL, credits and other property. Reserve and pay the 10% parent and 5% founder shares under that policy. Unsupported shares accrue and remain flagged; token inventory is not exempt.

An in-kind distribution changes this agent's inventory and invalidates any prepared exit using the earlier amount. Reconcile beneficiary transfers, requote the actual remaining position and rebuild/re-simulate exits. The original first-buyer gross-unwind baseline assumes the entire initial allocation is retained; do not keep asserting that baseline after distributing tokens. Distributions are value leaving the agent, distinct from a market loss or an operating fee.

## Accounting and costs

Maintain one ledger for each mint, plus a treasury ledger for the whole agent. Every entry includes transaction signature, slot, mint, instruction, asset, raw integer amount and reason. Record pending creator fees and refundable account deposits separately from spendable SOL.

| Cash/deposit category | Treatment |
| --- | --- |
| First purchase | Record the actual total wallet debit, including protocol and creator fees. Separate its net curve input for reserve accounting. |
| Sell | Record actual net SOL or WSOL received. Do not subtract the same trading fees again. |
| Creator fee | Count income when claimed into the controlled wallet/account; track the unswept/vault balance as a receivable before then. A sweep and its later claim are one income stream, not two. |
| Creation and accounts | Quote current rent requirements for the actual account sizes. Track which deposits are legally recoverable by the agent and which remain locked. |
| Transactions | Include confirmed network/priority fees and settled tips, including unsuccessful submissions where a fee was charged. |
| Cleanup | Count only actual refunds, net of cleanup costs. Unwrapping WSOL changes its representation and is not new profit. |

The [official fee page](https://pump.fun/docs/fees), updated October 17, 2026, states a 1.25% ordinary SOL/USDC bonding-curve fee: 0.95% protocol and 0.30% creator. Recovering all of the agent's own creator fees gives the approximately 2% round-trip planning baseline. It also lists zero coin-creation platform fee and a 0.015 SOL graduation charge. Read current fee configuration rather than baking these percentages into the quote engine. PumpSwap canonical-pool fees use market-cap tiers. Fee retention in v3 changes payout timing, not the trading fee charged.

This adapter calls the programs directly. Pump's web/mobile Platform Fee is therefore outside this execution route; an external execution service could add its own costs and must not be introduced without adding them to the budget. Treat account deposits as quoted amounts, not a universal fixed launch fee or universally refundable rent.

For each proposed exit calculate, in lamports:

```text
projected_cash_pnl = recovered_cash_so_far
                   + executable_net_sale_proceeds
                   + collectible_creator_fees_after_sale
                   + eligible_rent_refunds
                   - cash_outlays_so_far
                   - remaining_execution_and_cleanup_costs
```

Use integer fee ceilings and reserve arithmetic from the supported program behavior. `executable_net_sale_proceeds` already includes the sell's fees. `collectible_creator_fees_after_sale` includes the creator fee from that sale only if it will be recoverable through the actual configured creator path. Never count retained protocol fees, raw curve/pool lamports, marked token value or another mint's creator income as this mint's immediately withdrawable proceeds.

## State and journal

Persist state before submitting any signature. Keep strategy policy, mint, creator, base/quote/token programs, expected PDAs, starting balances, account creation costs, intended instruction bytes, signed transaction bytes, blockhash expiry, signature, observed confirmations and reconciled token balances in the encrypted journal. Its public receipt may expose transaction IDs and artifact hashes, never secrets.

```text
PLANNED -> LAUNCH_SIGNED -> LAUNCH_PENDING -> HOLDING_CURVE
HOLDING_CURVE -> EXIT_PENDING -> CLAIM_PENDING -> CLEANUP -> SETTLED
HOLDING_CURVE -> COMPLETED_AWAITING_POOL -> HOLDING_AMM
HOLDING_AMM -> EXIT_PENDING -> CLAIM_PENDING -> CLEANUP -> SETTLED
any pending state -> RECONCILE -> the state proven by chain balances
```

`SETTLED` means the recorded position is reconciled; it does not assert that the coin, creator rights or protocol accounts disappeared. A later periodic fee claim can still earn revenue without reopening token inventory.

## 1. Plan a launch

1. Verify image/model readiness, available bankroll and survival reserve. Allow only the configured number of positions. A model inference failure leaves the deterministic signer idle; it does not cause an unbounded fallback trade.
2. Have the model propose the coin's name, symbol, metadata and launch size within the policy. Resolve and budget any metadata hosting before signing. Pin the exact URI/content intended by the proposal; fetching metadata must not execute instructions received from that content.
3. Generate a fresh mint key inside the TEE and journal it before submission. Check that the mint and expected curve do not already exist. Reused or externally supplied mints are not fresh launches under this strategy.
4. Read supported Pump Global, fee configuration, token programs and current blockhash from a coherent RPC snapshot. Derive the fresh curve's expected reserves from that Global state; do not quote against a historical fixed `30 SOL` constant.
5. Calculate an exact first-buy amount whose total wallet debit fits the launch cap, leaves the configured recovery reserve and remains strictly below completing the new curve. Include all account creations and fees in the estimate. If fitting the full launch transaction fails, do not split creation and the initial purchase across separate transactions while still calling it an atomic first buy.

## 2. Create and make the first dev buy atomically

Build **one Solana transaction**, in this order:

1. Appropriate compute-budget instructions with a measured fee cap.
2. Pump `create_v2`: fresh mint, agent as payer/user and `creator`, ordinary mode flags from the configuration, native SOL quote semantics.
3. Required idempotent agent token-account creation and any initialization that the selected buy interface requires.
4. Pump `buy_v3` with an exact token amount and bounded `max_sol_cost`, or the supported exact-quote v3 interface with bounded spend and minimum tokens. Use the current IDL's actual optional-argument encoding and ordered account list. The mint key and agent user key are the required launch signers; the creator field is deliberately the agent's key, not a provider or metadata service's key.

The default ABI is `create_v2` plus `buy_v3`; do not copy account lists from a legacy buy into a v3 instruction. For SOL, the curve stores the default quote-mint marker while interfaces that ask for the quote mint take wrapped SOL. V3 trading uses native SOL transfer behavior where defined by the Pump interface; do not assume every curve payment needs a WSOL deposit.

Simulate the complete unsigned message against the intended cluster state. Check program IDs, writable accounts, instruction decoding, estimated resource use, payer debit, post-mint token balance, creator, all launch flags and expected incomplete curve state. The birth adapter must be able to reproduce these checks without relying on the LLM to approve transaction bytes.

After deterministic policy acceptance, sign inside the TEE, journal the signed bytes and broadcast. Another transaction cannot interleave between creation and the first purchase inside this transaction. If a program instruction fails, the creation and buy roll back together; reconcile charged transaction costs separately. External transactions can trade after this transaction and can race every later exit.

Confirm and reconcile from chain state before entering `HOLDING_CURVE`: mint exists, curve belongs to Pump, creator equals the agent, normal flags match, supply/token program match the expected creation, agent tokens match the executed purchase, and actual debit fits policy. A returned signature alone is not a confirmed position.

## 3. Watch actual flow and the current exit quote

Use a direct Solana account/log observer in the birth adapter. Historical fixtures are not a live data feed. Maintain a checkpointed event cursor and recover gaps from confirmed transaction history. Subscription messages trigger a coherent refresh; they do not independently prove the current balances.

Track the mint's curve reserves, completion state, the agent's entire inventory, protocol/creator fee buckets and any canonical pool. Attribute trades from decoded successful instructions/events and reconcile their state deltas. Exclude the agent's own known wallets, descendant-funded transfers and creator claims from reported outside trading. An unknown address is not proof of an independent human; actual quote entering or leaving the market is the useful observation.

Report **net outside curve/AMM quote flow**, not buy count, displayed market cap, social activity, gross volume or fees sitting in the contract. Exclude rent, sweeps and plain account transfers from trade flow; investigate donations or reserve-sync changes separately. A sell removes outside flow. Deduplicate inner/self-CPI events and include both parts of a synthetic completing buy when present, so the same transfer is not counted twice.

On each refresh:

1. Verify the creator/fee route and supported account layouts still match the strategy.
2. Classify `incomplete curve`, `complete awaiting migration`, or `canonical AMM available`.
3. Quote liquidation of the actual remaining inventory using current integer math and current fees; quote pending claims and eligible refunds separately.
4. Evaluate projected cash PnL, holding deadline, policy and spendable recovery reserve.
5. If the configured exit condition holds, build the applicable exit. An outside buy is an observation that improves the curve position, not the execution condition by itself.

Keep the approximately 2% model as the launch-budget shorthand. On an ordinary uncompleted curve, the first buyer's gross unwind has the useful initial-curve baseline while it retains its entire initial allocation. The decision engine still requires actual net proceeds and fees. It must not label a positive outside trade a guaranteed realized profit or carry that initial-curve floor through graduation.

## 4. Exit an incomplete curve, sweep and claim

Refresh state immediately before building. For an incomplete normal curve:

1. Build Pump `sell_v3` for the intended inventory and an explicit `min_sol_output` from the current net quote and allowed slippage. The minimum is the user's proceeds after protocol and creator fees; it does not include a later creator claim.
2. Append Pump `sweep_creator_fee` for this curve, to the Pump creator-vault PDA derived from the **current** creator.
3. Append Pump `collect_creator_fee_v2` with the agent's creator destination, correct quote mint/program and fixed PDA accounts.
4. If size/resource limits and account conditions permit, append eligible empty-account cleanup. Otherwise checkpoint the sale and finish claims/cleanup in separate bounded transactions.

Putting sale, sweep and claim in one transaction recovers the sale's own creator fee in the same successful state transition. If any instruction fails, that whole transaction rolls back. If the transaction is too large, a completed sale followed by a separately failed claim is still a completed sale: record it and retry the claim without selling a second time.

These collection interfaces pay fixed creator destinations and do not require the creator account to be a signer in the inspected IDL. The agent signs as transaction payer/trader where required; permissionless collection is not permission to redirect the creator's payout. Confirm all destinations rather than adding an invented creator-authority account.

Verify token reduction, net wallet receipt, curve fee-bucket movement and vault payout from the confirmed transaction. Reconcile wallet and WSOL balances and subtract actual execution costs. Do not infer a successful claim only from a nonzero historical fee counter.

## 5. Handle completion and the migration race

**A read or simulation cannot reserve the curve against another transaction.** Another buyer can complete it after observation and before execution. There is no promise that a persistent holder can always exit before graduation, and increasing a sampling rate does not create that promise.

If `sell_v3` fails with `BondingCurveComplete`, first confirm the failure and charged fees, then refresh. Do not keep resubmitting a curve sell or widen its slippage. After completion, curve buys and sells fail until migration; the v3 synthetic completing buy can also consume tokens from the would-be pool before that pool exists.

For `COMPLETED_AWAITING_POOL`:

1. Derive and verify the canonical PumpSwap pool from the supported migration interface, mint and quote. Reject an arbitrary same-mint pool supplied by an external quote service.
2. If the pool exists and is initialized, proceed with its actual post-migration reserves.
3. Otherwise, use a bounded wait/retry window or build the supported permissionless `migrate_v2`, charging its costs to the launch's pre-reserved recovery budget. Simulate the current version's behavior if another transaction has migrated first. Do not treat a missing pool or transient migration failure as disappearance of the held tokens.
4. Where resource limits and the supported interface permit, migration plus AMM exit can be composed; otherwise checkpoint migration and refresh before building the sale. Do not assume a single transaction will fit.

For `HOLDING_AMM`:

1. Verify pool owner, canonical authority, base/quote mints, token programs, vaults and `coin_creator`. Read actual pool balances and signed virtual-quote adjustment; retained fees are not tradable reserves. Recompute the dynamic fee tier and quote the actual inventory against this pool.
2. Build PumpSwap `sell_v2` with `base_amount_in` and bounded `min_quote_amount_out`. Create the agent's correct quote account if needed. SOL pools use wrapped SOL for AMM token transfers; track wrapping/unwrapping and its account deposits explicitly.
3. Sweep any remaining **curve** creator fee and collect it through Pump `collect_creator_fee_v2`.
4. Sweep the **pool** creator fee and collect it through PumpSwap `collect_coin_creator_fee` into the agent's quote-token account. The two creator vault systems have different PDA seed conventions; use their respective IDLs.
5. Unwrap WSOL through an agent-controlled eligible token account when needed for spendable SOL, then reconcile all proceeds and costs.

Migration changes the reserves available for a large unwind, and AMM LP fees are not creator rebates. The roughly 2% curve baseline therefore stops being a guaranteed loss envelope at this boundary. Use the configured current-state exit policy and actual AMM quote; do not hide this branch behind a perpetual retry of the pre-migration assumption.

## 6. Rent cleanup and continuing fee income

After the intended sale, inspect remaining token balances and authorities before closing anything. Close only agent-controlled accounts permitted by their actual token-program/extensions state, with refunds sent to the agent. An empty owned base ATA can normally be a cleanup candidate; an owned WSOL account can release its SOL through the appropriate close instruction. Preserve shared quote accounts used by other positions.

The IDLs expose `close_user_volume_accumulator`; evaluate its current preconditions and any outstanding reward/claim state before closing. Accumulators are user-level rather than a unique refund bucket for each mint, so do not close one still required by other positions or promise its rent repeatedly in per-mint budgets. Recreating it on the next trade costs rent again.

Do not attempt to close the mint, curve, pool, program-owned creator vault or protocol accounts merely because the agent paid their creation cost. The standard creator-vault native collection retains its required rent reserve. Record permanent/retained deposits as costs rather than fictional refunds.

Creator rights can continue producing revenue after token inventory is zero. A periodic sweep/claim is allowed when expected collectible fees exceed its marginal execution costs. Keep enough SOL to perform it and keep the creator key/state continuity intact. Record later income separately from the cash result of the completed initial position.

## 7. Restart, ambiguous submissions and failure recovery

On every restart, enter `RECONCILE` before proposing a new mint. Restore the same identity and journal; read all pending signatures, known mints, actual token accounts, curve completion state, canonical pools and creator vaults. Derive the state from balances and transaction status, not just the last local intent.

| Situation | Required recovery |
| --- | --- |
| Broadcast timed out, status unknown | Query signature status/history and actual accounts. Re-broadcast the same signed bytes while valid if needed. Do not assume failure and create a second launch. |
| Blockhash expired, no confirmed execution | Reconcile mint/inventory first, then rebuild with a fresh blockhash within remaining fee and attempt budgets. |
| Launch failed atomically | Confirm no created position, book charged costs and either retire that plan or retry its journaled mint under policy. |
| Sale confirmed but claim failed separately | Remain `CLAIM_PENDING`; claim/sweep only. Never repeat the sale from an old inventory amount. |
| Sale failed because curve completed | Switch to the completion/migration branch with fresh state and quote. |
| Minimum-output failure | Refresh and recompute. Do not silently set the floor to zero or bypass the configured loss policy. |
| Creator route or program layout changed | Pause new launches; preserve inventory and use only a supported, verified recovery path. Do not count unsupported future fees as receivables. |
| RPC disagreement or observer gap | Stop new signatures until slot/account history is reconciled; retain the recovery bankroll. |
| Compute credit low | Stop new launches; budget provider top-up or orderly persistence using the common image's treasury policy. A stopped host does not close a market position. |

Journal every rebuilt transaction as a new attempt. Bound attempts and total fees across the position, rather than resetting the budget on each restart. Neither a local timeout nor an RPC retry is permission for a second economic action.

## Adapter acceptance and existing offline checks

The missing `birth-image` adapter must supply all of these before this playbook is executable:

- A pinned IDL encoder/account derivation layer, current-state decoder, exact integer quote engine and program/version checks.
- Atomic create-and-first-buy construction, simulation, in-TEE signing, durable submission reconciliation and all configured spend/output limits.
- Checkpointed direct-chain observation with transaction/event deduplication and net-flow accounting.
- Both curve and canonical AMM exit paths, migration recovery, both creator sweep/claim paths, WSOL handling and authority-aware rent cleanup.
- A deterministic policy gate between model proposals and signatures, an encrypted restart journal and per-mint plus treasury cash ledgers.
- Offline end-to-end fixtures for atomic launch rollback, a normal exit, completion between quote and sell, already-migrated state, partial settlement, ambiguous RPC results and restart without duplicate buys/sells.

The existing tests below verify pieces of the user's reconstructed behavior. Run from `/Users/stacc/perps/pumpfun-source` with its captured artifacts, compatible `solders`/LiteSVM dependency and Rust compiler available. These are genuine existing commands and run offline; they do not constitute acceptance of a live adapter or current network deployment.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_recovered_curve_arithmetic.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_creator_fee_collect_captured.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_sweep_fees_captured.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_creator_assignment_captured.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_account_lifecycle_captured.py -v
```

Do not use the fixtures' deterministic test wallets, generated mint keys or synthetic balances in the birth image. Source reconstruction and captured differential evidence remain in `pumpfun-source`; the new execution adapter and its lifecycle checks belong outside that repository.

## Primary interface references

These links pin the inspected official documentation revision, rather than following a moving `main` branch:

- [Coin creation](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/COIN_CREATION.md).
- [Bonding-curve v3 trades](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/TRADE_V3.md).
- [Fee sweeps](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/SWEEP_FEES.md) and [creator collection](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/COLLECT_CREATOR_FEE.md).
- [Synthetic migration and reserve accounting](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/SYNTHETIC_MIGRATION.md).
- [Dynamic fee selection](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/FEE_PROGRAM_README.md) and [signed virtual-quote adjustment](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md).
- [Current posted fee schedule](https://pump.fun/docs/fees), inspected October 30, 2026; a posted percentage is an observation, not a substitute for reading supported execution state.
