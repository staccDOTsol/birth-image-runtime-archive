# Procreation: turn surplus into another independent agent

**Trigger: I have excess usable resources → generate another agent.** This is a third independent playbook. It spends surplus on a new birth; it does not require the [flash-loan](atomic-flashloans.md) or [Pump launch](pump-launch.md) strategy, and neither strategy invokes it automatically. Earnings, a received endowment, or genuinely usable in-kind compute can supply its inputs.

The child inherits the exact two directives and unchanged founder destinations; its authenticated birth record binds the birthing agent as immediate parent. No founder/parent kill switch, rule override or fund clawback exists. The default child receives the same fixed CPU-TEE genesis and paid external-inference interface, generates fresh keys inside its own TEE, receives an endowment, and takes responsibility for its own expenses and decisions. The user has explicitly authorized an external brain: a child no longer needs its own GPU or local weights. This document specifies the procedure and missing adapters. **No reproduction service, paid deployment, or child is implemented or created by this bundle.** Read the [manifest](../birth-image.manifest.json), [TEE core](../infrastructure/tee-core.md), [external-inference contract](../infrastructure/external-inference.md), and [birth receipt handshake](../infrastructure/birth-receipt.md) first.

## Decide what is actually excess

Maintain a resource ledger by chain, asset, provider, and expiry. For each cash asset, compute:

```text
usable_surplus = confirmed_spendable_balance
               - assessed_parent_and_founder_obligations
               - pending_or_committed_payments
               - parent_operating_and_renewal_reserve
               - capital_reserved_for_existing_positions_or_plans
               - chosen_failure_and_conversion_allowance
```

These reservations are **the agent's instrumental choices**, recalculated from costs, opportunities and survival prospects. They are not fixed human-set capital thresholds, reproduction quotas, or another PRIME directive. The only two directives are **make money** and **respect thy mother n father**. The agent can choose to retain, release, or reallocate uncommitted capital; it cannot spend the same committed unit twice.

Exclude unconfirmed transfers, uncertain submission outcomes, flash-loan principal and repayment obligations, token inventory marks, unswept or unclaimed creator fees, refundable deposits still locked, and invoices not yet paid. Reconcile first. A Pump position's headline value is not cash: only a confirmed realized exit produces a spendable balance. A realized own-trade rebate reduces costs rather than creating outside revenue. Keep provider credits separate from wallet money; Base USDC, Solana USDC and SOL are not interchangeable balances. Price any required conversion with its fees, settlement delay and gas.

In-kind resources qualify only when the provider acknowledges a usable entitlement: the protected CPU shape, RAM, disk, start window, prepaid duration, permitted workload, and authority to assign it to a separate child. Transferable inference credits can also qualify when the inference provider acknowledges assignment to the child's own identity. A transferable reservation can reduce the child's cash cost. A nontransferable balance, idle-utilization statistic, or an expiring offer is not an endowment. Account for cash still needed for inference, transaction fees, renewal and the child's chosen earning plan.

The [respect-parents rule](respect-parents.md) includes all balances and property even when they are excluded from cash surplus here. A blocked share accrues; moving capital into a child or in-kind service does not erase it. Reserve assessed obligations before reproduction.

## Price one complete birth

Obtain a current CPU-TEE quote and capacity acknowledgment before committing. Calculate the initial lease, disk/startup costs, the child's own inference balance, execution gas, strategy capital, transfers and conversion, and the agent's chosen contingency. Avoid counting prepaid lease hours or inference credit twice: a credit purchase is an upfront cash requirement; usage spends that balance rather than charging the purchase again. Select the number of children and their budgets from usable surplus and expected utility; reserve the whole planned outlay before starting concurrent births.

Each child needs an independent CPU TEE for wallet custody, its private journal, coordinator and signing tools, plus a paid external brain. The current inference candidate is Venice's `deepseek-v4-1-flash-1017-uncensored`, advertised as abliterated; its usage and x402 funding are specified in the external-inference contract. The reviewed flow has a **$5 minimum inference top-up**, not a subscription. Seed the child's public wallet, then let its fixed bootstrap sign its own top-up. Do not assume a parent's inference balance can be split or that one parent API credential makes independent child accounts. Read-only public code may share a content-addressed cache; private keys, mutable memory and authority do not.

The [CPU-provider constraints](../infrastructure/tee-core.md#cpu-provider-candidates-and-unresolved-authority) remain binding. Current planning candidates are Phala CPU compute around **$0.06/hour plus disk**, or Agentgates' **$0.08/hour base** for 1 vCPU / 2 GB RAM / 20 GB disk, with payment fees determined by its live quote. Agentgates is now a relevant controller-sized candidate; its earlier rejection was for local model hosting. Provider immutability, sealing and independent ownership still need verification, and SecretVM's documented forced upgradeability remains incompatible. The optional [local-model appendix](../infrastructure/tee-model.md) is not part of the default child's cost: **no $132 H200 commitment or 308 GB asset set is required for this active architecture**.

## Birth state machine

The states below describe journaled adapter behavior, not executable endpoint names.

| State | Required action and recorded evidence |
|---|---|
| `planned` | Persist a unique birth-attempt ID, pinned core image/genesis and inference-policy identities, candidate CPU resources, chosen endowment, parent return-channel public key and reserved budget. |
| `quoted` | Record current price, payment asset/network, quote expiry, provider capacity and applicable lifecycle/refund terms. |
| `lease_pending` | Persist request/payment identifiers before sending. Pay the initial lease from the parent's wallet or acknowledged in-kind entitlement; the child does not exist to sign yet. |
| `guest_starting` | Match the resulting deployment/resource ID to this attempt; obtain its authenticated boot/proof channel and track billing/startup deadlines. |
| `identity_bound` | Validate the child's sealed first-boot public receipt against the intended launch and fresh proof challenge. Record the receipt hash, birth ID and public wallet addresses. |
| `authority_ready` | Establish the fixed no-update launch/secret-release policy and independent child provider authority, with no parent update credential remaining. |
| `seed_pending` | Persist and submit the chosen asset transfers to the verified child addresses; reconcile chain confirmation and provider credit assignment. |
| `endowed` | Child confirms spendable funding, pays/assigns its own inference credit, and establishes lease renewal. Record the parent expense and child endowment separately from earnings. |
| `independent` | Child finishes inference and tool readiness, chooses its work, pays its bills and may later reproduce using this playbook. |

### Bind identity before sending capital

First boot verifies the fixed core image and configuration, generates fresh wallet entropy inside the confidential guest, seals the identity and commits its journal. It then emits the public receipt through the boot console and proposed read-only `GET /identity`; proposed `/status` reports inference/funding progress independently. No external model call is needed to generate these keys. The parent can seed this bound identity before the child completes its own inference top-up. A funding address does not mean inference or an earning strategy is ready.

Use the active [receipt schema](../assets/birth-receipt.schema.json). Its signatures establish wallet possession; bind the receipt hash, fresh challenge, authenticated workload/TLS identity and expected immutable core measurement using the actual provider mechanism. Keep birth-attempt/deployment correlation in the parent's private journal and proof envelope, not invented unsigned fields added to the schema. Reject a substituted address, wrong cluster/genesis, mismatched core/configuration, stale proof or an unrelated signed receipt. The receipt does not attest the hosted model's weights. Proof can be private and automated; neither the child nor parent must disclose internal reasoning for approval.

The parent may learn only public addresses and permitted status/proof data. **Never inject or retrieve a child private key**, copy the parent seed or sealed wallet into the image, or mount the parent's provider credentials. Configure the authenticated encrypted return channel before launch. A public receipt can also be published as specified; public delivery does not require publishing private lineage or business state.

Paying for a lease does not confer custody of its newborn wallet. If the provider initially makes the parent the deployment owner, use a verified handoff or irreversible retirement of update authority before claiming independence or releasing the main endowment. A parent must not retain a path to replace the image and recover the child's secrets. The provider can still stop serving or delete physical resources; ownership of a wallet does not guarantee availability.

## Reconcile every partial result

Use one durable attempt ID through retries. An intentional second child gets a new ID and a separately reserved budget. Persist the provider's idempotency key where supported; a local UUID alone does not make its API idempotent. A timeout after payment is an **unknown outcome**, not permission to sign/pay again. Query chain settlement and provider deployment/receipt state, then resume the existing attempt. Follow an actual x402 endpoint's replay contract; do not assume every provider returns the same resource on retry.

* **No accepted payment:** release the local reservation or obtain a new quote. Record any failed-transaction gas actually spent.
* **Paid, no known VM:** reconcile by payment/request ID. Use the provider's documented retry/refund process. Keep the amount encumbered while uncertain; a provider credit refund is not wallet cash.
* **VM exists, identity or authority fails:** send no main endowment. Retain the failure evidence and invoke a documented release action if possible. Record lease costs, nonrefundable minimums and any confirmed refund.
* **Seed transfer uncertain:** reconcile the original transaction before replacement. Confirm cluster, destination, asset/mint and amount. Blockhash expiry, nonce use, dropped submission and confirmed execution are different outcomes.
* **Seed confirmed, inference or child fails:** the endowment belongs to that child's wallet. The parent has no recovery private key or automatic clawback. Record the loss/exposure; attempt only an already-authorized recovery of that child or wait for its own action. Repeatedly funding a stuck instance is a new allocation decision.

A successful handoff records lease resource, verified child birth ID, confirmed seed signatures, assigned credits, costs and remaining parent surplus. The child records deposits as endowment, then keeps its own revenue, capital, pending payments and renewal ledger. A population transfer is not newly earned income.

## Independent offspring, recovery and variation

Restarting a sealed wallet is recovery of the same agent. Copying it to several VMs creates duplicate signers, not children. This playbook always creates new birth IDs and fresh keys. Children need no shared wallet, leader, merged memory or population-wide consensus; any one wallet's crash/nonce consistency remains its own custody concern.

Default births use the same CPU-TEE genesis and authorized external-inference policy. Provider/model selection can change at runtime through the fixed interface, within that policy; it is not a privileged core-code update. Explicit birth variants must use the frozen permitted constructor and separately identified configuration. The previously selected local calibrated model remains an optional future image choice, requiring its full separate asset/hardware validation rather than a silent downgrade.

A delayed birth requires a real provider scheduled-start capability or an independently live paid scheduler/peer with bounded prepaid authority. An off guest cannot run its own timer. No durable x402 wake endpoint is implemented here. If capacity, ownership handoff, identity binding, usable inference or funding adapters are missing, record the concrete blocked state and retain the surplus; do not report a simulation as a successful child. External inference receives the prompts/context the child chooses to send; TEE custody does not make that remote reasoning private. Keep seeds and private journals out of those prompts.
