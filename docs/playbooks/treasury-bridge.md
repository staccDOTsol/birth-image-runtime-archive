# Treasury bridge: Solana earnings to spendable Base USDC

The agent earns SOL on Solana and moves an allocated surplus into **Circle-issued native USDC on Base**, held by its own Base wallet. That balance can then pay Base-only x402 merchants through [the x402 payment adapter](../infrastructure/x402-payments.md). This is a treasury operation after an earning strategy has produced spendable funds; it is not part of a flash-loan transaction and it does not make the earning strategy cross-chain atomic.

Use **Relay** when the image has an authorized Relay API credential and the returned route passes validation. Use **deBridge DLN** as the documented public-API alternative. Both document Solana and Base support and swaps into native USDC. Availability, minimum size, cost and executable steps are determined by a fresh quote. This document does not claim a successful funded route test: the research client could read Relay chain metadata, while an unsigned deBridge quote request returned HTTP 403. No private keys were read, signatures generated, accounts created or funds moved while preparing this playbook.

## Identity, chains and assets

Generate both signing identities inside the TEE at birth and preserve them through its encrypted state-continuity mechanism. They belong to one agent but are different addresses and key types:

- `AGENT_SOLANA`: the case-sensitive Solana public key receiving strategy proceeds and funding source transactions/refunds.
- `AGENT_BASE`: the agent's EVM address receiving Base USDC and authorizing subsequent x402 payments; it is also the deBridge destination cancellation authority.

The funder can transfer initial assets to these public addresses without obtaining their keys. The quote provider never receives either private key.

| Meaning | Relay identifier | deBridge identifier |
| --- | --- | --- |
| Solana mainnet | `792703809` | `7565164` |
| Base mainnet | `8453` | `8453` |
| Native SOL input marker | `11111111111111111111111111111111` | `11111111111111111111111111111111` |
| Solana native USDC mint, 6 decimals | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Same mint |
| Base native USDC contract, 6 decimals | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Same contract |
| Base native ETH marker, if quoting a separate gas transfer | `0x0000000000000000000000000000000000000000` | Same native-asset convention in DLN examples |

Do not send Relay's Solana ID to deBridge or the reverse. These are provider API IDs, not Solana's network genesis identity. Verify the connected Solana RPC is mainnet and the EVM RPC reports chain ID 8453. A token named `USDC`, bridged `USDC.e`, wrapped SOL, or an address copied from another chain does not satisfy the destination requirement. [Relay's Solana definitions](https://docs.relay.link/references/api/api_guides/solana), [deBridge chain IDs](https://docs.debridge.com/home/architecture/supported-chains), [Circle's official USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Funding policy and the first lease

Before planning a bridge, reserve assessed [parent/founder distributions](respect-parents.md), then subtract pending strategy commitments, account deposits, recovery funds and minimum Solana transaction fuel. Bridge only finalized, reconciled, spendable surplus. Do not bridge a position's apparent marked value or its unclaimed creator-fee receivable.

The common birth policy must supply the maximum source debit, maximum treasury amount in flight, minimum acceptable Base output, quote age, slippage, maximum effective cost, source/destination finality policy, retry budget and Base operating reserve. Keep one journaled intent per allocation and lock its source amount against concurrent spending.

An in-flight bridge remains owned property for the distribution ledger, with no double count of deposited source cash and its claim. It is not a distribution exemption; blocked in-kind shares accrue.

Maintain enough runway to survive the bridge: **quote acceptance is not Base arrival**. The first TEE lease/inference payment must already be funded, or a separate funded bootstrap path must complete before the image starts spending down that lease. The strategy loop and bridge watcher can run concurrently, but they cannot both reserve the same SOL, and the x402 spender cannot reserve a pending bridge's USDC.

Reserve native SOL for source fees even when bridging Solana USDC. Reserve Base ETH for direct EVM recovery transactions, particularly a deBridge cancellation. Ordinary x402 exact payments can use facilitator-sponsored settlement, but that does not sponsor bridge cancellation. If Base ETH is absent, obtain a separately quoted, budgeted ETH top-up or initial agent-owned gas reserve before using a route whose recovery depends on it. Do not assume receiving USDC supplies gas.

Aggregate small earnings until the current quote's effective cost fits policy, while preserving enough Base USDC to pay near-term compute invoices. There is no universal profitable bridge size or fixed fee percentage. deBridge's public documentation describes a broad trade-size range starting around USD 1; that is not a promise that every USD 1 route is available or economical. `AMOUNT_TOO_LOW`, no liquidity, or an excessive fee means keep the batch on Solana and re-evaluate later, not lower the acceptance floor.

```text
input_value = conservative current USDC value of the source amount
extra_cost  = source network/rent + other costs not already in quoted output
cost_bps    = 10000 * (input_value + extra_cost - minimum_Base_USDC_out)
                    / input_value
```

For SOL input this includes swap spread/impact as well as bridge cost. For USDC input, use its actual units and any relevant price deviation. Do not add solver fees twice when they already reduce quoted output. Use the minimum receivable amount, not the displayed expected output, for acceptance.

## Choose direct SOL input or stage through Solana USDC

First request a fresh **SOL → Base USDC** route. Both providers describe source swaps into their settlement assets, so a separate user-side SOL sale is not inherently required. Accept it only if the image can decode and validate all its swap and deposit instructions.

If that route is unavailable, too expensive, too large, or uses an unsupported source-swap program, choose a staged path:

1. Quote and execute a separately validated **SOL → Solana USDC** same-chain swap into the agent's own USDC ATA, leaving source fuel untouched.
2. Confirm that swap and record actual USDC received.
3. Obtain a new **Solana USDC → Base native USDC** bridge quote for that actual balance allocation.

Relay can quote the first leg with origin and destination both `792703809`, `originCurrency` set to the native SOL marker, `destinationCurrency` set to the Solana USDC mint, and `recipient` set to `AGENT_SOLANA`. Its documented source restriction `includedOriginSwapSources: ["jupiter"]` is available when the image supports that route. A same-chain swap that succeeds before the bridge fails leaves **Solana USDC**, not the original SOL. Journal the two legs independently and do not sell SOL again when retrying only the second leg. A different swap adapter is usable only if it is already implemented, pinned and policy-validated in the birth image.

## Relay route

### Credential and quote

Relay's current documentation says all `/quote/v2` requests require a valid `x-api-key` from **October 2, 2026**. Its dashboard manages these integration credentials. This is a real bootstrap dependency; a newly generated wallet alone is not documented as obtaining that API access. Use a credential already provisioned through the image's attested secret mechanism. If none is available, keep the Relay path disabled and evaluate the permitted deBridge alternative. No dashboard account or key was created for this playbook. [API keys](https://docs.relay.link/references/api/api-keys).

Request `POST https://api.relay.link/quote/v2` with JSON and that header. This is a **template**, not an executable payment command; replace addresses and select the amount/slippage from policy. The sample amount is one SOL in lamports and the sample tolerance is 50 bps.

```json
{
  "user": "<AGENT_SOLANA>",
  "recipient": "<AGENT_BASE>",
  "originChainId": 792703809,
  "destinationChainId": 8453,
  "originCurrency": "11111111111111111111111111111111",
  "destinationCurrency": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "1000000000",
  "tradeType": "EXACT_INPUT",
  "slippageTolerance": "50",
  "refundTo": "<AGENT_SOLANA>",
  "includeProtocolData": true,
  "useDepositAddress": false
}
```

For the staged USDC bridge leg, change `originCurrency` to the Solana USDC mint and express `amount` in its 6-decimal units. Keep `recipient` explicitly set to the Base address; the default sender fallback is inappropriate across these address formats. Always set `refundTo` explicitly to the source Solana key: current refund guidance says omission disables automatic refunds, although some schema fallback wording differs. [Quote schema](https://docs.relay.link/references/api/get-quote-v2), [refund behavior](https://docs.relay.link/references/api/api_core_concepts/refunds).

### Validate the order and build source transactions

Persist the request, response, quote time, request ID and intended funding amount before signing. Reject missing output floors, wrong assets/receivers, expired orders, excessive costs, unsupported steps or a change from the accepted route. Do not enable arbitrary destination `txs`/calls: this operation delivers USDC to the wallet, then pays merchants separately.

For a quote containing `protocol.v2`, use the settlement SDK's `getOrderId(orderData, chainVmMap)` to recompute the order ID. Validate `orderData` input payment, output chain/currency, `output.payments[].recipient`, `minimumAmount`, deadline, refunds and absence of unwanted output calls. Build the VM/depository map from independently obtained `/chains` metadata cross-checked against the image's accepted deployment manifest, not solely from fields in the same quote. Confirm the source deposit instruction commits to the recomputed order ID and transfers the exact accepted input to the canonical depository/vault. If the returned route lacks the binding that the image's validator supports, stop or choose a supported route; a successful simulation alone is not an order-binding proof. [Order validation](https://docs.relay.link/references/api/api_core_concepts/input-validation).

Observed October 30 metadata from `GET https://api.relay.link/chains` identifies the Solana v2 depository as `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2` and vault as `7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ`. Revalidate accepted deployment data at bootstrap. The Solana interface defines `deposit_native(amount, id)` and `deposit_token(amount, id)`; use its pinned ABI to decode accounts and arguments rather than applying the documentation's EVM calldata decoder to Solana. [SVM depository reference](https://docs.relay.link/references/protocol/contracts/solana-depository).

Drive execution from `steps[].id`, `kind`, `items` and the actual data/check objects. Display descriptions are not executable specifications. Skip empty steps; fetch/poll missing data as documented. Reject unexpected signatures and extra approvals. The current official SVM adapter builds Solana transactions from `item.data.instructions`—each instruction contains keys, program ID and **hex instruction data**—plus `addressLookupTableAddresses`. Resolve lookup tables from the correct chain, decode every account and instruction, then compile the transaction with a fresh blockhash and the agent as fee payer. These fields are not a deBridge serialized transaction blob. [Step execution](https://docs.relay.link/references/api/api_core_concepts/step-execution), [official adapter source at inspected revision](https://github.com/relayprotocol/relay-kit/blob/f66fb04e940e938482836822c5a6061f06663419/packages/relay-svm-wallet-adapter/src/adapter.ts).

The SDK can coordinate execution, but its wallet callback must pass through the same deterministic transaction validator and in-TEE signer. Decode all resolved program IDs, signer/writable accounts, SOL transfers, SPL transfers, token authorities, order IDs, minimum swap outputs and fee instructions. Permit only pinned, supported bridge/swap/token/system/compute programs and expected account actions. No arbitrary authority change, unrelated transfer, broad delegate or unknown destination is acceptable just because it appeared in a provider response.

Do not request `useV1Transaction: true` unless the bridge signing stack supports the returned Solana transaction version and its `transactionConfig`. Relay documents this newer format separately. Its API `/quote/v2` version, protocol v2 order and Solana transaction version are different concepts. If the route format is unsupported, obtain another supported quote rather than mis-deserializing it or claiming the native v1 flash-loan executor also implements this bridge adapter.

Simulate the final assembled message with the actual accounts, check all source debit/account-creation/fee caps, and sign inside the TEE only after policy acceptance. Persist signed bytes, source signature, blockhash expiry and request ID, then submit. If adding a fee instruction changes the message, revalidate size, instructions and costs before signing.

### Relay settlement and refund

Confirm the source transaction under the source finality policy. Then poll:

```text
GET https://api.relay.link/intents/status/v3?requestId=<REQUEST_ID>
```

Use the returned request/check identifiers and recorded source transaction to reconcile. `waiting`, `depositing`, `pending` and `submitted` are in progress. `failure` is generally **not terminal**: it can return to pending or proceed to refund. Current docs treat `success` and `refund` as terminal, subject to a settling-chain reorganization; `failure` with `refundFailReason` needs explicit recovery handling rather than endless polling. [Status API](https://docs.relay.link/references/api/get-intents-status-v3).

For `success`, require the destination fill transaction and the Base balance checks below before releasing spending funds. For `refund`, verify the actual source asset and balance credit; book fees and any swap result. Refunds can be less than the original source amount because of execution/gas costs and an already executed origin swap. Small balances or screening/execution failures can prevent an automatic refund. There is no generic guaranteed `cancel` or instant full-return call assumed by this adapter. An unresolved order enters `RECOVERY_PENDING`, preserving IDs and evidence for supported protocol recovery or operator attention; it does not trigger another bridge deposit.

## deBridge DLN alternative

deBridge documents public API access without an API key, with higher-rate authenticated options. Use the DLN Swap API origin `https://dln.debridge.finance`, not its separate order-history/indexing service at `dln-api.debridge.finance`. [Access and endpoints](https://docs.debridge.com/home/resources/status-limits).

### Quote and create-transaction pair

Call **GET** `https://dln.debridge.finance/v1.0/dln/order/create-tx` with these URL-encoded query parameters. This only constructs an unsigned transaction; the on-chain order is created when the agent signs and submits it on Solana.

```text
srcChainId=7565164
srcChainTokenIn=11111111111111111111111111111111
srcChainTokenInAmount=<AUTHORIZED_SOL_AMOUNT_IN_LAMPORTS>
dstChainId=8453
dstChainTokenOut=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
dstChainTokenOutAmount=auto
dstChainTokenOutRecipient=<AGENT_BASE>
srcChainOrderAuthorityAddress=<AGENT_SOLANA>
dstChainOrderAuthorityAddress=<AGENT_BASE>
srcAllowedCancelBeneficiary=<AGENT_SOLANA>
prependOperatingExpenses=false
```

For Solana USDC input, replace the input mint and use 6-decimal units. Explicitly bind both authorities and the cancellation beneficiary. Do not copy a demo's referral, affiliate recipient or example private key into the image. Omit affiliate/referral fees unless the birth policy deliberately includes them. The optional `senderAddress` used by the official integrator example, if supplied, is the same agent Solana address.

Validate `estimation`, costs, actual input amount, the returned `order` and its encoded source transaction as **one paired response**. `prependOperatingExpenses=true` can increase the input amount to cover operating expenses; this playbook uses false and still budgets every actual additional native source debit identified in the message. Do not assume the input-amount parameter alone caps total wallet costs. Accept the output amount that the encoded DLN order actually requires, rather than merely a theoretical maximum shown in estimation. [Create-tx schema](https://docs.debridge.com/api-reference/dln/this-endpoint-returns-the-data-for-a-transaction-to-place-a-cross-chain-dln-order).

Use `dstChainTokenOutAmount=auto` for this market-priced operation. Do not take returned input/output amounts and request a second fixed/fixed quote: the official guide warns that this creates a limit order which may remain unfilled. If the quote becomes stale, request a new complete pair from the original intent before depositing. The guide discusses an approximately 30-second quotation window; that is a freshness policy, not a cross-chain completion guarantee. [Paired quote/transaction behavior](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/creating-order/creating-order).

### Decode, validate, simulate and submit on Solana

For Solana origins, deBridge documents `response.tx.data` as a **hex-encoded serialized `VersionedTransaction`**. The minimal parsing step is:

```typescript
const hex = response.tx.data.replace(/^0x/, "");
const transaction = VersionedTransaction.deserialize(Buffer.from(hex, "hex"));
```

This fragment parses data only; it is not a working bridge executor. Resolve and decompile all address lookup tables before validating. Check fee payer, required signers, source mint/amount, source order authority, destination chain/token/receiver/authority, cancellation beneficiary, encoded output floor and any source swap against the accepted intent. Decode DLN instructions with the pinned official IDLs, then validate order-ID derivation and field commitments using the supported protocol encoder. Reject unknown programs/actions and unintended writable accounts. [Serialization/submission guide](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/submitting-the-transaction), [official Solana example](https://github.com/debridge-finance/api-integrator-example/blob/385f7674abadebc8123b01a8fc515c19107252ba/src/scripts/orders/sol-usdc-to-poly.ts).

The published Solana `DlnSource` program is `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4`; `DlnDestination` is `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo`. Use their correct roles. Source-swap routing may invoke other programs; include only independently pinned supported ones in the image manifest, or request a simpler USDC-input route. Obtain Base destination contracts and Solana IDLs from the [official deployment table](https://docs.debridge.com/dln-details/overview/deployed-contracts), not from the quote's own claims alone.

If changing a blockhash or priority fee, decode and validate the compute-budget instructions by program/discriminator. Do not blindly overwrite instruction indexes from a demonstration script. Respect transaction version, size, additional required signatures and quote freshness. Simulate the final message; verify the expected token/SOL movement, output-order commitment and maximum fees. Sign only inside the TEE, persist the signed bytes and source signature, and submit with preflight enabled.

### Track the same order through fulfillment

After source confirmation, derive/reconcile the actual order ID from the source event/transaction. The Swap API provides:

```text
GET https://dln.debridge.finance/v1.0/dln/tx/<SOURCE_SIGNATURE>/order-ids
GET https://dln.debridge.finance/v1.0/dln/order/<ORDER_ID>/status
```

The status schema includes `None`, `Created`, `Fulfilled`, `SentUnlock`, `ClaimedUnlock`, `OrderCancelled`, `SentOrderCancel` and `ClaimedOrderCancel`. `Fulfilled` concerns destination delivery; later unlock statuses concern the solver's source-side settlement and are not an additional payment to the agent. Verify the actual Base USDC fill and balance rather than treating source order creation as spendable output. [Transaction-to-order lookup](https://docs.debridge.com/api-reference/dln/this-endpoint-returns-the-status-of-order-1), [order status](https://docs.debridge.com/api-reference/dln/this-endpoint-returns-the-status-of-order).

### Unfilled order: cancel on Base, then verify Solana refund

An unfilled order may require cancellation. Request:

```text
GET https://dln.debridge.finance/v1.0/dln/order/<ORDER_ID>/cancel-tx
```

The response describes `chainId`, `from`, `to`, `data`, `value` and `cancelBeneficiary`. Require **Base 8453**, the agent's Base authority as sender, its Solana key as the cancellation beneficiary, and the independently pinned DLN destination target. Decode the call, estimate its ETH gas/value and simulate it. Sign with the Base key inside the TEE and submit on **Base**, not Solana.

The `value` includes cross-chain messaging and source-claim execution costs; Base ETH is therefore required in addition to transaction gas. Cancellation prevents destination fulfillment and sends a message that unlocks the source funds. Wait for actual claim completion and source balance credit; `OrderCancelled` alone is not a refunded wallet balance. The docs describe return of the locked order funds including protocol/affiliate amounts; that does not refund an earlier SOL swap, all network fees or this cancellation's ETH expense. [Cancellation mechanics](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/cancelling-order), [cancel-tx schema](https://docs.debridge.com/api-reference/dln/generates-a-transaction-that-cancels-the-given-order).

Do not assume auto-cancellation is available by default: deBridge documents it in connection with configured referral integrations. If cancellation is unavailable, races with fulfillment, lacks gas, or its claim remains unresolved, persist `RECOVERY_PENDING` and the relevant source/destination IDs. Re-read state before another cancellation attempt. Never replace an unresolved deposit by sending the same allocation through Relay.

## Base arrival: make funds available to x402

For either provider, complete all of these checks:

1. Obtain the destination fill transaction and require successful receipt on chain 8453 under the configured finality policy.
2. Decode transfers from **the exact Circle Base USDC contract** to `AGENT_BASE`. Verify the credited amount against the accepted order minimum, allowing only explicitly accounted contract semantics, not symbol-based guesses.
3. Read `balanceOf(AGENT_BASE)` from that contract and reconcile the arrival with the treasury ledger. Account for concurrent payments/reservations: a balance delta alone is not proof of which bridge paid, and a bridge API status alone is not proof of spendable funds.
4. Move only the reconciled amount from `in_flight` into `available_Base_USDC`. Record source costs, destination gas/top-ups, actual received amount and any residual source asset.
5. Give the Base x402 client a balance reservation and the agent's in-TEE signing capability. The bridge's authority or deposit signature is not an x402 payment authorization. Follow [x402-payments.md](../infrastructure/x402-payments.md) to validate the merchant's network/asset/amount/payee and execute the appropriate payment scheme.

This playbook deliberately delivers to the agent wallet before paying the merchant. It does not attach a provider-controlled arbitrary destination call or assume the merchant's inference/compute lease is acquired merely because USDC arrived.

## Durable journal and retries

```text
ALLOCATED -> QUOTED -> VALIDATED -> SOURCE_SIGNED -> SOURCE_PENDING
SOURCE_PENDING -> ORDER_PENDING -> DESTINATION_CONFIRMED -> AVAILABLE_FOR_X402
ORDER_PENDING -> REFUND_PENDING -> SOURCE_REFUND_CONFIRMED
any ambiguous state -> RECONCILE or RECOVERY_PENDING
```

Persist provider, allocation ID, both public addresses, chain IDs, asset addresses, original request, accepted minimum/cost cap, quote expiry, decoded order, order/request IDs, message hash, signed bytes, source signature/expiry, destination hashes, refunds and all confirmed ledger movements. Seal this state before broadcasts and restore it before the trading/spending loops resume after restart.

Before a source transaction is submitted, an expired or rejected quote can be replaced without moving funds. After submission, reconcile that **same transaction and order**: retry identical signed bytes while valid, query status and chain accounts, and rebuild only when non-execution is established. An HTTP timeout, source confirmation, route expiry or `failure` text is not permission to fund a new order. If a same-chain SOL→USDC leg already settled, reuse its actual USDC rather than repeating that leg.

Keep allocations locked until destination arrival or an actual source refund is reconciled. Reorgs, contradictory RPC observations and mismatched provider/chain status pause release of spendable balances. Continue bounded observation/recovery while the survival reserve allows; report an unresolved order as pending funds, not lost-and-replaced funds or a guaranteed future refund.

## Implementation and verification boundary

This file is an agent playbook with real API shapes, not a completed bridge executor. A search of the inspected `openzoo` and `rgb402` trees did not establish an existing Relay/deBridge bridge adapter to invoke. Do not invent a `birth bridge` command or treat provider demo code as integrated into this image.

The birth-image implementation still needs the provider HTTP clients, pinned ABI/program manifests, Solana instruction/ALT and DLN-order validators, Relay order binding, in-TEE wallet callbacks, quote cost policy, signed-message journal, status/refund workers, Base USDC reconciliation and x402 balance reservations. Include both provider adapters at image construction time if failover is desired; an immutable agent cannot gain one later by downloading code.

Before enabling funds, verify offline fixtures for wrong receivers/chains/mints, a substituted deposit target, unexpected instructions, ALT resolution, inflated source fees, stale quotes, source-only success, destination failure, partial/changed-asset refund, Base-gas-required cancellation, reorg/ambiguous status and restart without a second deposit. A future funded canary, if separately authorized, verifies actual liquidity and end-to-end settlement; none has been performed here.
