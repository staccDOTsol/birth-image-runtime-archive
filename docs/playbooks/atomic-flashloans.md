# Atomic flash loans: birth-image playbook

This is the independent flash-loan business playbook. Its unit of work is one native Solana transaction v1: obtain compatible flash liquidity, execute a bounded route, repay every obligation, and retain the measured surplus. The agent supplies its own signer, operating funds, observations and decisions. Token creation and launch trading belong to the separate launch playbook and are not steps in this strategy.

Prepared on **2026-10-30** from the working tree on branch `main`, HEAD `d4ebc1bab33f85cc82a8d02678682a2e8754b56f`. The tree contained modified and untracked source files; that commit alone does not reproduce these instructions. A birth-image build must include the cited working-tree files and lockfiles, and record their content hashes.

**What is complete here:** the operating procedure, source map, instruction contracts, acceptance gates and recovery procedure. **What is not supplied by this document:** a newly implemented general multi-lender executor, a production signer adapter, or evidence of profitable mixed-lender mainnet settlement. The existing components and the remaining integration gates are identified below. Writing this playbook does not enable trading.

## 1. Source map and reuse boundary

All paths below are relative to this document. Line references describe the inspected revision and may move after edits.

| Existing source | Reuse | Important boundary |
| --- | --- | --- |
| [research/marinade-surfpool/flash.mjs](../../research/marinade-surfpool/flash.mjs), L9–173 | Kamino/Jupiter WSOL identities, reserve validation, fee calculation, `buildSplitFlash` | Exported builders deliberately require a loopback Surfpool connection. They are not a mainnet CLI. |
| [research/marinade-surfpool/run.mjs](../../research/marinade-surfpool/run.mjs), L138–163 | Official `@solana/kit` native-v1 signing sequence | `encodeV1` is an internal helper, not an exported module API. |
| [run.mjs](../../research/marinade-surfpool/run.mjs), L394–447 | Exact mixed Kamino/Jupiter instruction ordering and Kamino index patching | The strategy body here is the Marinade experiment. It is evidence of composition code, not an approved profitable route. |
| [jit-metrics/scripts/mfi-isolated.mjs](../../jit-metrics/scripts/mfi-isolated.mjs), L7–74 | Exported `repaymentBudget`, `availableBorrow`, `isolatedFlash` | Multiple marginfi banks are one lender protocol. Current SDK/program compatibility must be checked. |
| [jit-metrics/scripts/super.mjs](../../jit-metrics/scripts/super.mjs), L440–560, L1233–1259 | Existing cross-venue Kamino arbitrage construction, bounded exits, signed simulation, live-send gates | Single Kamino reserve. Internal builders are not exported. Disable persistent-position mode for this atomic playbook. |
| [jit-metrics/scripts/jupiter-exit.mjs](../../jit-metrics/scripts/jupiter-exit.mjs), L42–94 | Exported `jupiterExactInExit`; executable swap instructions with an enforced output threshold | Jupiter Swap routing is distinct from Jupiter Lend funding. A quote alone is not execution. |
| [jit-metrics/scripts/v1-wire.mjs](../../jit-metrics/scripts/v1-wire.mjs), L5–67 | Exported `V1_LIMITS`, `compileV1`; checked native-v1 alternate compiler | Uses detached signatures and privilege-sorted accounts. Prefer the official Kit path when packaging new integration. |
| [jit-metrics/scripts/simulation-accounting.mjs](../../jit-metrics/scripts/simulation-accounting.mjs), L6–61 | Exported `receivedInInstruction`, `evaluateSimulation` | Reject missing accounting. An earlier successful swap inside a failed transaction can be a quote; it is not settled profit. |
| [jit-metrics/scripts/rpc-config.mjs](../../jit-metrics/scripts/rpc-config.mjs), L19–54 | One HTTP/WS RPC configuration; process environment takes precedence | RPC paths/query strings can contain credentials; host-only logging is already implemented. |

Do not substitute the older `jit-metrics/scripts/v1-encoder.ts` for these compilers. Do not use the manual `mfi-flash.ts` sketch as the marginfi adapter: its instructions-sysvar address differs from the correct constant used by `mfi-isolated.mjs`. The older [klend-mega-flash runner](../../klend-mega-flash/scripts/mega-flash.ts), L280–345, builds **v0 with an ALT and three Kamino borrows**; it does not satisfy this playbook.

## 2. Inputs the birth runtime must provide

Before searching, reserve assessed [parent/founder obligations](respect-parents.md) in the same asset. The balance basis includes operating funds; this reservation is not an exemption. A finalized snapshot cannot observe the transient borrowed principal between instructions of a single atomic transaction.

Before searching, resolve and record:

| Input | Required form |
| --- | --- |
| Signer | Agent-controlled Solana authority and fee payer; extra ephemeral signers required by chosen instructions. Runtime access to signing is required; this document contains no key. |
| Cluster and RPC | Explicit cluster identity, v1-capable HTTP RPC, matching WS endpoint, and the commitment used for observations, simulation and preflight. |
| Operating funds | Existing SOL for the transaction fee and setup/rent before a flash borrow can execute. Flash principal is not a substitute for the fee payer's initial balance. |
| Route universe | Supported mint pairs, token programs, decimals, pool/program accounts, tick/bin arrays and any required oracle accounts. |
| Lenders | Program ID, market/group, reserve/bank, vaults, token mint/program, fee fields, available balance and actual borrow limits at a recorded observation slot. |
| Economic policy | Minimum settled surplus, allowed operating-cost allocation, maximum fee/rent exposure per attempt, priority-fee budget, quote age, failure budget and submission expiry. The agent chooses numeric plan parameters from current capital and its objective; immutable code validates and binds the accepted plan. They are not promised returns or mandatory founder-selected allocation ceilings. |
| Durable attempt journal | Business intent, source revision, observation/quote slots, instruction digest, amounts owed, blockhash lifetime, signed-message digest, signature, simulation outcome and settlement state. Persist before broadcast. |

The current engines read a wallet from `$HOME/.config/solana/id.json` and registries from **`/root/jit-metrics/registries/`**; see `super.mjs` L28–48 and [super-jit.mjs](../../jit-metrics/scripts/super-jit.mjs) L21–45. Packaging an enclave signer is a separate adapter requirement. Do not assume those file reads already use the TEE's signing service. Supply the existing runtime layout or explicitly implement and validate the adapter before enabling this strategy.

Use the installed lockfiles. The [research package](../../research/marinade-surfpool/package.json) pins `@solana/kit` **8.6.0**, web3.js **1.99.0**, and uses `@jup-ag/lend` **^0.4.0**. The [engine package](../../jit-metrics/package.json) pins `@mrgnlabs/marginfi-client-v2` **6.4.2**. Record resolved lockfile versions, not just version ranges.

## 3. Select a compatible lender set

| Funding topology | Existing support | Birth-time disposition |
| --- | --- | --- |
| One Kamino reserve | Borrow/repay builders, capacity probes and live-engine route code exist. | Revalidate reserve, fee, capacity and full signed route. |
| One Jupiter Lend asset | Official SDK borrow/payback pair is used by the local harness. | Revalidate context, configured fee and protocol borrow cap. |
| One Kamino reserve + Jupiter Lend | `buildSplitFlash` and final ordering exist in the Surfpool harness. | Mixed composition exists; successful profitable mixed settlement is not established. Validate the exact combined message before activation. |
| Two or more Kamino flash borrows | The older runner builds them, but newer signed fork evidence rejects them even across reserves/markets. | Reject this set: custom `6035 MultipleFlashBorrows`. Do not treat a second Kamino reserve as another compatible lender. |
| Multiple marginfi banks | `isolatedFlash` accepts `loans[]` in one account/group. | One lender with several assets; current program/SDK and account layout must pass fresh validation. |
| Kamino/Jupiter plus marginfi, or any new lender | No general combined executor or passing combination evidence was found. | Integration remains unimplemented/unverified. Do not infer compatibility from separate successful legs. |

Keep borrow/repay and marginfi begin/end instructions at the top level of the **same transaction**. A wrapper program does not make an otherwise forbidden flash-loan CPI valid. A bundle of separate transactions is not a replacement for this requirement. Do not split a borrow and its repayment across signed transactions.

The dual-Kamino rejection is recorded in [full-flash-stake-frontier.md](../../research/marinade-surfpool/evidence/full-flash-stake-frontier.md), L65–69. It was an actual signed native-v1 fork simulation, not a guessed limitation. The [official Kamino SDK repository](https://github.com/Kamino-Finance/klend-sdk) is the primary reference when checking whether the deployed instruction/account layouts have changed; the saved experiment remains the evidence for this package's rejection rule.

**Marginfi compatibility gate:** the repository's isolated builder patches the end instruction's account layout because its SDK IDL omitted the group (`mfi-isolated.mjs` L61–69). Current [marginfi migration documentation](https://docs.marginfi.com/typescript-sdk/migration) reports later program and oracle-layout changes that affect this deprecated client. That patch is not proof all current banks work. The current [flash-loan guide](https://docs.marginfi.com/typescript-sdk/flash-loans) also specifies begin/end ordering, health checks and CPI/nesting restrictions. Validate the deployed program's exact rules against the local setup/initialize/start/close sequence; do not silently replace the pinned SDK or assume arbitrary cross-protocol nesting.

## 4. Discover executable capacity and route economics

1. Read candidate lender and venue accounts at an explicit commitment; retain the RPC context slot. Reject malformed owners, discriminators, mints, vaults, disabled reserves and unexpected token programs. On a lazy-cloned fork, fetch a reserve and its vault together **before** time travel or unrelated account freezing.
2. Determine capacity from both protocol accounting and the vault. Kamino's exported `getFlashCapacity` checks its active WSOL reserve, configured fee and reserve/vault coherence (`flash.mjs` L41–88). A token-vault balance is only an upper bound; Jupiter's tested protocol cap was lower than its vault balance. A registry match is not permission to borrow the full vault.
3. Read fee configuration for every lender. Kamino uses `klendFlashFee(amount, feeSf)`: scale `2^60`, nearest rounding, minimum one raw unit when the rate is nonzero, and the all-ones sentinel means disabled (`flash.mjs` L30–38). Jupiter's SDK returns `feeAmount`; use it, even when a documentation example describes zero fees. Marginfi's `repaymentBudget` includes the configured origination charge and rounding headroom. Its `availableBorrow` checks borrow-limit headroom; it does **not** prove vault cash or every other risk constraint.
4. Find a route using the existing supported Raydium CLMM, Orca or Meteora builders in `super.mjs`. Search sizes, then construct executable instructions with integer raw amounts. The existing engine uses floating-point price/liquidity estimates; those are discovery estimates. Reject a candidate if exact integer bounds and full-message simulation cannot validate the selected size.
5. For an aggregated exit, use `jupiterExactInExit` with `inputMint`, `outputMint`, raw `amount`, `minimumOutput`, `user`, `excludedAmm`, and the available account budget. The helper rejects a route that re-enters the excluded pool, preserves an output floor, disables automatic SOL wrapping and strips returned ComputeBudget instructions. Configure the actual current Swap API URL/access through the existing `JUPITER_SWAP_URL`/`apiKey` inputs; do not assume its default public URL remains available.
6. Build a per-mint obligation ledger: `principal`, `lenderFee`, `repaymentDue`, `availableAfterBody`, and `minimumRetained`. Add network fees, any explicit tip, setup/rent and the configured operating-cost allowance to the strategy's decision. Mark refundable rent separately from an immediate expense.

The discovery scanners [kamino-scan.mjs](../../jit-metrics/scripts/kamino-scan.mjs) and [mfi-scan.mjs](../../jit-metrics/scripts/mfi-scan.mjs) write registries at the hardcoded Linux path. They identify candidates, not fresh capacity. Their account sizes/offsets and preferred-reserve selection must match current programs before their output is used. Do not run a scanner and treat the resulting mint count as a validated lender inventory.

## 5. Assemble the final instruction array

### Kamino + Jupiter funding contract

The exported local builder is:

```js
buildSplitFlash({ connection, owner, wsolAta, totalLamports, klendLamports })
```

It computes `jupiter = total - klend`, rejects negative legs or insufficient measured sources, and returns `refreshIx`, `klendBorrowIx`, `jupiterBorrowIx`, `jupiterRepayIx`, the index-accepting `klendRepayIx`, and each fee. It obtains Jupiter instructions with `includeATASetup:false` and `includeWrapSol:false`, and validates the SDK's reserve, vault and user ATA against the expected WSOL context (`flash.mjs` L135–171). Its defaults represent a historical 600,000-SOL target, **not an executable capacity assertion**. Pass measured amounts explicitly.

Preserve the ordering actually used by `appendPlan` (`run.mjs` L403–446):

```text
required account setup
Kamino refresh
Kamino borrow                 <- record its final top-level index
Jupiter borrow
bounded strategy body
Jupiter payback
Kamino repay(principal, recorded borrow index)
final settlement checks / cleanup allowed by the selected protocols
```

Setup must leave the borrowed token account usable at repayment. If the body closes WSOL to obtain native SOL, recreate the ATA, transfer only accounted native proceeds, then `SyncNative` before the lender reads it. Do not let an aggregator cleanup close a repayment account. The Marinade harness demonstrates these mechanics; its reward fixture and historical strategy are not mandatory steps in this business.

Kamino repay data takes the **original principal**, not principal plus fee, and a final borrow index; the lender charges its fee. `klendRepayIx` rejects indices outside `0..255` (`flash.mjs` L122–130). Record positions after all setup has been inserted. After any insertion, deletion, reordering or adapter change, rebuild every position-dependent instruction.

Jupiter's SDK `getFlashloanIx` returns `borrowIx`, `paybackIx` and `feeAmount`. The inspected SDK does not expose a caller-supplied borrow-index parameter. Keep its complete pair and matching context; do not invent a Kamino-style index field for it. [Official integration guide](https://developers.jup.ag/docs/lend/flashloan/execute).

### Marginfi funding contract

Use the exported existing interface:

```js
isolatedFlash({ client, payer, loans, body, setup })
```

Each loan supplies `bank`, `tokenProgram`, `tokenAccount`, and integer raw `amount`. The result contains `instructions`, extra signer `keys`, the temporary `account`, and `bodyStart`, `repayStart`, `startIndex`, `endIndex`.

The local implementation constructs:

```text
setup -> initialize temporary account -> start(endIndex)
      -> borrow each bank -> body -> repay-all each bank
      -> end health check -> close temporary account
```

It restricts banks to the client's group and supported asset tags `0/1`, adds the mint for Token-2022 loans, and orders active bank/oracle observations by descending bank-key bytes. It patches `start(endIndex)` only after locating the actual end instruction. Extra signer `keys` must reach the v1 compiler. Zero residual liabilities/deposits are required for the isolated account to close. Treat the whole sequence as a **current-compatibility test**, subject to the gate in section 3; the old source is not a substitute for that test.

## 6. Compile and sign native transaction v1

Use the official Kit sequence already present in `run.mjs` L138–163. The following is its existing API sequence, not a new CLI or an exported executor:

```js
const payer = await createKeyPairSignerFromBytes(owner.secretKey);
let msg = setTransactionMessageFeePayerSigner(
  payer, createTransactionMessage({ version: 1 }),
);
const { blockhash, lastValidBlockHeight } =
  await connection.getLatestBlockhash('confirmed');
msg = setTransactionMessageLifetimeUsingBlockhash(
  { blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }, msg,
);
msg = setTransactionMessageConfig({
  computeUnitLimit: 1_400_000,
  loadedAccountsDataSizeLimit: 67_108_864,
}, msg);
msg = appendTransactionMessageInstructions(instructions.map(web3ToKit), msg);
for (const keypair of extraSigners) {
  msg = addSignersToTransactionMessage([
    await createKeyPairSignerFromBytes(keypair.secretKey),
  ], msg);
}
const signed = await signTransactionMessageWithSigners(msg);
const base64 = getBase64EncodedWireTransaction(signed);
const signature = getSignatureFromTransaction(signed);
```

The imports and `web3ToKit` account-role conversion are in that source. A TEE signing adapter must preserve these exact message bytes and required signer roles; it need not expose a private key to reproduce the signing result. Retain `blockhash` and `lastValidBlockHeight` in the attempt journal: the research helper currently returns only base64, byte count and signature.

For live fee selection, Kit's config field is **`priorityFeeLamports`**, a `bigint` total in lamports. The research helper above leaves it unset; the alternate `compileV1` accepts `priorityFee` and writes the native header. Do not feed a legacy micro-lamports-per-CU price into either total-fee field.

Before signing, enforce this package's limits from `V1_LIMITS`: **4,096 wire bytes including signatures, 64 inline accounts, 64 top-level instructions, 12 signatures, and at most 1.4m requested CU**. Keep required compute/data limits explicit. Remove legacy ComputeBudget instructions; use the v1 message config. Native v1 has no ALTs. These requirements agree with [Solana's v1 format documentation](https://solana.com/docs/core/transactions/versioned-transactions); do not assume a proposed larger account limit has been activated for this image.

If a route does not fit, reject or rebuild it within the same specification. Do not silently emit v0, add an ALT, omit a repayment, or replace atomicity with a bundle. Passing the wire limits also does not prove the runtime's inner-instruction trace, loaded data, compute or call-depth limits will pass.

## 7. Simulate the exact signed message and apply the profit gate

The live engine's existing RPC shape is `simulateTransaction` with:

```json
{
  "encoding": "base64",
  "commitment": "confirmed",
  "sigVerify": true,
  "innerInstructions": true
}
```

Send the signed base64 as the first parameter. Retain the result's context slot, error, logs, compute use, loaded data, inner instructions, and complete pre/post wallet accounting. Include requested account snapshots where supported. Reject a stale result under the image's quote policy. [RPC reference](https://solana.com/docs/rpc/http/simulatetransaction).

`run.mjs` L206–212 instead performs **local diagnostic** simulation with `sigVerify:false` and `replaceRecentBlockhash:true`. That is useful for research, but is not validation of the live signed message. Do not combine blockhash replacement with the signed-message check. If the lifetime needs refreshing, get a new blockhash, sign again, and simulate again.

Reuse the two-pass pattern in `super.mjs`/`super-jit.mjs`: obtain an executable intermediate-output measurement; rebuild with strict final bounds; simulate the rebuilt message. `receivedInInstruction` can recover a successful earlier transfer from the trace of a later-failed candidate. Only the second, wholly successful simulation can qualify for sending.

Required simulation outcome:

1. No RPC error and `value.err === null`; all borrows, body instructions, repayments, health checks and cleanup succeed.
2. Each lender is repaid in its required mint. Residual tokens marked at an estimated USD price do not replace missing repayment tokens.
3. Final wallet native/token deltas are complete. `evaluateSimulation` must not report inventory drawdown disguised as profit; include all affected wallet mints in the accounting universe. Fees/rent already reflected in native balance delta must not be charged twice.
4. The strictly bounded final route retains the configured minimum surplus. No relaxed diagnostic bounds, unexplained local support, stale quotes, or assumed LP rebates qualify.
5. Account, instruction, byte, compute and inner-trace limits pass for the combined transaction. Separate successful lender tests are insufficient.

**Onchain enforcement boundary:** lender repayment enforces solvency, not profitability. The existing engine adds output/input floors and checks full simulated wallet deltas before sending (`super.mjs` L440–513 and L1233–1252). The [JIT exit guard](../../jit-metrics/programs/jit-exit-guard/src/lib.rs), L25–46, enforces slot/exit behavior; it is not a general minimum-wallet-balance program. No generic final-balance profit-guard implementation is supplied here.

For a live route, either prove that its exact instruction bounds guarantee the configured retained assets without consuming pre-existing inventory, or require an implemented, validated onchain balance guard. Simulation alone is not that guard. An agent must report an unmet guard requirement and keep the route inactive, rather than label the missing program complete.

## 8. Submit, confirm and settle

Before broadcast, durably record the signed message digest, signature, instruction/obligation ledger, exact simulation and blockhash deadline. Resolve any prior uncertain attempt that could spend the same operating funds before starting a conflicting one.

The existing engine sends raw base64 through `sendTransaction` with:

```json
{
  "encoding": "base64",
  "skipPreflight": false,
  "preflightCommitment": "confirmed",
  "maxRetries": 0
}
```

Use the already signed, already simulated bytes. Compare the returned signature with the locally computed signature, as `sendEncodedLocal` does (`run.mjs` L270–278). An RPC acceptance is not confirmation. [Submission semantics](https://solana.com/docs/rpc/http/sendtransaction).

The live engine currently waits eight seconds and prints a status (`super.mjs` L1252–1258). That is a starting point, **not a complete settlement worker**. The birth executor must continue the procedure:

1. Poll or subscribe for the signature at the chosen commitment. Check the error as well as the confirmation status. Use history lookup when the signature can have fallen outside the recent cache. [Status reference](https://solana.com/docs/rpc/http/getsignaturestatuses).
2. Fetch the landed transaction with `maxSupportedTransactionVersion: 1` and verify `meta.err === null`. A null response is unresolved, not success. [Transaction reference](https://solana.com/docs/rpc/http/gettransaction).
3. Recompute wallet native/token changes, actual network fee, tips and account creation/closure from the transaction metadata and instruction trace. Identify the agent-owned accounts, not only token mints. Compare actual retained assets with the obligation ledger and configured floor.
4. Reconcile repayment transfers and expected temporary-account/position closure. The local harness compares lender vaults and wallet inventory before/after (`run.mjs` L715–731). On live shared vaults, unrelated transactions can change balances; use this transaction's transfers and metadata rather than asserting success from a later global vault balance.
5. Mark `confirmed`/`finalized` separately under the image's policy. Only the settled ledger is realized business revenue. Feed actual fees, slippage, landing rate and failed-attempt cost into future sizing and the operating budget.

Persist outcomes such as `built`, `simulated`, `submitted`, `uncertain`, `confirmed_success`, `confirmed_failure`, `expired_unseen`, and `reconciled`. These are the required journal semantics, not names of an existing exported API.

## 9. Failure and restart procedure

| Observation | Required action |
| --- | --- |
| Reserve/layout/owner/SDK mismatch | Remove the affected lender/asset from eligible candidates and retain diagnostics. Do not reinterpret bytes with a guessed layout. |
| Borrow-limit, disabled-loan or insufficient-cash failure | Refresh actual capacity and resize/rebuild, if the route still qualifies. The saved vault balance is not a retry budget. |
| `MultipleFlashBorrows` | Reject the multiple-Kamino topology. Do not repeat it under another amount or ALT. |
| Index, missing-repay, health or oracle error | Rebuild from validated protocol instructions and fresh state; patch final indices; sign and simulate again. Do not delete the failing repayment/health instruction. |
| Size/account/CU/trace failure | Reject or simplify the body while preserving the requested native-v1 atomic lifecycle; revalidate the full result. |
| Final output or profit bound fails | Discard this candidate and resume search. A passing prefix does not justify broadcast. |
| RPC send timeout or connection loss | Journal `uncertain`; query the original locally computed signature. A retry may resend identical bytes while valid. Do not immediately re-sign the same intent with a new blockhash. |
| Signature remains unseen | Compare current block height with stored `lastValidBlockHeight`; use status history/transaction lookup and resolve RPC lag. Rebuild only after the old attempt cannot newly land and settlement remains absent. [Block-height reference](https://solana.com/docs/rpc/http/getblockheight). |
| Confirmed onchain failure | Record the actual fee and error. Atomic application-state rollback is not a refund of the transaction fee. Refresh before a new attempt. [Fee semantics](https://solana.com/docs/core/fees/fee-structure). |
| Restart after submission | Recover the signature and signed-message record first; complete confirmation/reconciliation before creating a replacement intent. |
| Unexpected residual inventory after a successful transaction | Record and price it separately. Inventory disposal is a new, independently bounded decision, not an assumed flash repayment or an automatic unbounded unwind. |

## 10. Existing commands and reproducible checks

These are existing entry points. They do not create a new multi-lender CLI. The focused offline helper tests were run for this bundle; see [validation.json](../validation.json). The remaining commands are procedures for the packaged runtime and were not run here.

From the repository root, install the two existing packages and run the focused offline helper tests:

```sh
cd jit-metrics
npm ci
node --test tests/v1-wire.test.mjs tests/simulation-accounting.test.mjs tests/jupiter-exit.test.mjs
cd ../research/marinade-surfpool
npm ci
```

The `jit-metrics` package also exposes `npm run check:rpc` for the existing RPC/WS probe; it uses the configured endpoint and may consume provider quota. Keep `RPC_URL` and `RPC_WS_URL` consistent. This is a connection check, not v1 strategy acceptance.

Start a **native-v1-capable mainnet-backed Surfpool fork** using the provisioned binary's documented startup procedure. The research [reproduction notes](../../research/marinade-surfpool/README.md), L67–83, explain that an installed and a source-built Surfpool binary with the same version label behaved differently. Verify capability; do not infer it from the label.

Then, from `research/marinade-surfpool`, run the actual local capacity entry point:

```sh
SURFPOOL_URL=http://127.0.0.1:8899 \
SURFPOOL_WS_URL=ws://127.0.0.1:8900 \
KLEND_LIMIT_PROBE=1 SIMULATE_ONLY=1 \
EVIDENCE_PATH=/tmp/birth-klend-capacity.json \
node run.mjs
```

This probe writes setup state on the **local fork**, locally seeds the test signer and covers lender fees to isolate capacity. Its signed borrow/repay trials do not establish a profitable strategy. `SIMULATE_ONLY=1` does not mean the entire script is free of local setup mutations. Never point it at mainnet; the exported flash validation and Surfnet mutation helpers enforce loopback access.

The existing local harness exports `run`, `runKlendLimitProbe`, `runSweep`, and `runStakeFlashExit` (`run.mjs` L1326). Existing mode variables are `KLEND_LIMIT_PROBE`, `STAKE_EXIT_MODE`, `SWEEP_MODE`, `FLASH_SOL`, `KLEND_SOL`, `SIMULATE_ONLY`, and `EVIDENCE_PATH`. Use measured amounts and a coherent fork. The extensive Marinade sweep is historical route research; it is not required to start an unrelated supported arbitrage route.

For the existing **single-Kamino** route evaluator, after satisfying its wallet, registries and Linux-path requirements, the actual simulation configuration is:

```sh
cd /root/jit-metrics
LIVE_SEND=0 PERSISTENT_MODE=off node scripts/super.mjs
```

`super.mjs` is a polling engine, not a one-shot multi-lender executor. `PERSISTENT_MODE=off` keeps its persistent-position branch outside this atomic strategy. The marginfi JIT evaluator also needs explicit `LIVE_SEND=0` for simulation; unlike `super.mjs`, its send branch is disabled by the value `0`, not enabled only by `1`. Do not use its self-funded fill as evidence of external LP-fee revenue.

There is **no existing command** that turns `buildSplitFlash` into a complete production multi-lender worker with the TEE signer, durable submission journal, expiry handling and settled-PnL reconciliation. Do not invent `npm run multilender` or describe those adapters as shipped. Integrate the cited components explicitly, then meet the acceptance criteria below.

## 11. Evidence and activation criteria

Keep these evidence levels distinct:

| Level | What is established |
| --- | --- |
| Code present | The repo can construct instructions or encode a message. No execution claim. |
| Prefix or isolated lender passes | One portion executed in simulation; the full obligation may still fail. |
| Full signed fork simulation passes | Exact combined transaction runs at that fork state with all obligations satisfied. Fixtures and seeded support must be disclosed. |
| Full signed current-state simulation passes | A present candidate qualifies under current bounds; it is still not landed. |
| Confirmed and reconciled execution | The signature succeeded and the agent's actual asset changes were measured. |

Saved [mainnet-v1 capability evidence](../../research/marinade-surfpool/evidence/mainnet-v1-capability.md) verifies that native v1 and larger transactions were present on mainnet at its recorded snapshot. The [Marinade README](../../research/marinade-surfpool/README.md), L10–22 and L85–102, reports failed final repayment and no mainnet strategy send; its approximately 15,000-SOL Jupiter WSOL cap is a snapshot, not today's quote. No completed mixed-lender profitable execution is claimed by those files.

An eligible live candidate must satisfy **all** of the following:

- Reproducible source/lockfile manifest, expected program identities and current layouts; runtime signer and RPC adapters are actually present.
- Explicit lender-set compatibility and current capacity/fees; no prohibited duplicate Kamino borrows or assumed cross-protocol composition.
- One native-v1 message with every obligation, correct final indices, complete signers, explicit resource config and all limits satisfied; no ALT or multi-transaction substitute.
- Complete signed simulation, enforceable repayment/profit bounds, preserved pre-existing inventory and enough operating funds for fees/rent.
- Durable signature/lifetime tracking, uncertain-send recovery and v1-capable confirmation/transaction decoding.
- Actual settlement reconciliation before recording revenue or scaling the route.

If any criterion is absent, retain the implementation/evidence and report the concrete missing gate. Continue independent discovery and simulation within the requested strategy; do not silently change the transaction format, lender set or atomicity requirement.
