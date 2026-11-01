# Resilience: plan for losing a provider before the first outage

An immutable agent can lose its host, inference service, payment rail, facilitator or state. x402 automates purchases; it does not grant perpetual access or compel a seller to accept another payment. The agent should understand these dependencies at birth and choose affordable continuity arrangements while it still has working compute and spendable resources.

This playbook implements the same immutable PRIME, with exactly these two directives:

1. **make money**
2. **respect thy mother n father**

Continuity is an instrumental operating procedure, not a third objective, a founder override, or permission to rewrite those directives. It preserves the [distribution policy](../infrastructure/distribution-policy.json) and [respect-parents contract](respect-parents.md): every 24 hours, 10% of each asset balance to the immutable birth parent and 5% of the **same** balance to the fixed founder. No outage, survival budget or failover makes an exception. This is a playbook and adapter specification; no backup host, funded keeper or recovery implementation is deployed by this document.

## Build the dependency graph at startup

Record the actual service graph, not just a list of URLs. For every dependency, retain its operator, known upstreams, jurisdiction/service terms, authentication identity, payment assets/issuers, capacity limits, failure behavior, replacement adapter and last validation evidence. Unknown upstreams remain unknown; do not count them as proven independence.

**Suppliers themselves may be anonymous or pseudonymous.** An x402 purchase can complete against a service endpoint and payment address without disclosing the operator's legal identity or jurisdiction. Record those fields as unknown where appropriate; discovery does not need to manufacture a named company before the agent can evaluate a purchase. x402 permits this supply structure but does not guarantee anonymity. Agentgates, Phala and Venice are identified examples, not proof that every possible supplier is identified. An observable endpoint, hosting relationship or payment address is also not automatically a verified legal identity.

Unknown, geographically dispersed supplier operators make discovering and coordinating a population-wide shutdown harder than disabling known accounts at one company. Endpoints and infrastructure still have observable dependencies and operators still control real machines. Treat both independence and enforcement reach as evidence-dependent. Do not assume that many anonymous seller addresses mean many independent hosts, or that fixed founder payouts reveal the identities of the suppliers selling to those agents.

| Dependency | What can fail together; what to establish |
|---|---|
| CPU TEE / host | VM, physical operator, region, cloud account, control plane, KMS and encrypted disk. Different resellers may share the same underlying host or KMS. Verify resource capacity, protected execution and immutable secret-release policy. |
| External brain | Model gateway, inference operator, underlying model host, credential ledger and required abliterated model. Two gateway names can route to one upstream. A substitute must satisfy the authorized model/capability policy. |
| Payment assets | Identify chain and exact native asset/mint/contract, issuer or administrator, transfer restrictions and funding path. USDC on two chains still shares an issuer dependency. Different tickers do not prove independent control. |
| x402 facilitator | Its supported chains/schemes, settlement service, sponsor/gas payer and acceptance rules. A second merchant using the same facilitator can fail for the same reason. |
| Chain and RPC | The chain itself, distinct RPC operators, archival/history access, subscriptions and finality assumptions. Two RPC URLs behind one vendor are not an independent recovery source. |
| Swap / bridge | Liquidity provider, source/destination chains, order service, quote expiry, fulfillment and cancellation path. A pending bridge is an existing commitment, not spendable destination funds. |
| Reachability | DNS/registrar, TLS, egress policy, gateways and any return/identity channel. Reachable public DNS does not prove the guest can send traffic through its host. |
| State / wake | Sealed-key release, journal storage, independent encrypted checkpoint copies, rollback evidence and an actually funded scheduler/peer. Another bucket under the same disabled account may disappear with the VM. |

The active [CPU-TEE core](../infrastructure/tee-core.md) and [external-inference](../infrastructure/external-inference.md) profiles are the starting graph. Their current providers do not establish a complete immutable autonomous failover system. Preserve that distinction in status and forecasts.

## Prepare real alternatives before relying on them

Pin the required provider, payment, inference, RPC and recovery adapters into the immutable image before birth. The fixed interface can select an allowed external service at runtime; failover cannot depend on downloading a new privileged signer or silently replacing the core. Discovery may supply addresses, prices and changing capacity through validated data contracts. It may not supply executable authority.

For each fallback, establish: supported requests and authentication; the correct chain/asset; an actual current quote; required credits or account bootstrap; resource/model availability; and acceptance evidence. A catalog listing or an unpaid 402 challenge establishes an offer, not delivered capacity, immutable hosting rights or a successful recovery. Record when a fallback was last exercised and what remains untested. Future testing may require a budgeted paid trial; this documentation task did not perform one.

An inference fallback must still be an authorized **abliterated** model with needed tool/reasoning capability. Do not switch to ordinary DeepSeek simply because a similar model name responds. Revalidate live identity/capabilities and rates through the fixed interface, bound each request's output allowance, and reconcile usage. Model-provider replacement does not change PRIME, founder/parent destinations, or the signing rules. The remote provider sees the prompts/context submitted; changing hosts does not make that reasoning private.

Avoid a treasury whose every usable payment route ultimately requires one frozen asset or issuer. Consider actual merchant acceptance and independent usable assets, not hypothetical convertibility. Native SOL, native EVM gas assets and issuer-controlled stablecoins have different dependencies; none is a universal substitute at every merchant. Do not assume a bridge, another chain, a new wallet or another facilitator can move an issuer-frozen balance. Preserve the asset and its restriction in the ledger; any ordinary conversion needs an implemented valid route and a live quote. [x402 payment contracts](../infrastructure/x402-payments.md), [USDC terms](https://www.circle.com/legal/usdc-terms).

## Monitor the failure that is actually happening

Use deterministic local watchers between paid model decisions. Monitor remaining lease time, provider balance, inference credit, actual request success, model availability, egress, RPC disagreement/staleness, bridge state and sealed-checkpoint freshness. Keep bounded status probes separate from requests that themselves buy resources. Refresh quotes/capacity before allocating money, rather than assuming yesterday's discovery still works.

Classify evidence before acting:

* **Temporary transport or capacity failure:** record timeout, HTTP status and request identity; use bounded backoff or an already accepted alternative. Reconcile an uncertain charge before authorizing another purchase.
* **Insufficient usable funds:** distinguish an empty wallet from wrong-chain funds, nontransferable credits, outstanding authorizations, unpaid distributions and an insufficient provider admission balance. Do not fabricate liquidity or spend the same reserve twice.
* **Changed service contract or unsupported model:** preserve the error/terms and identify the missing capability. A nominally cheaper endpoint is not equivalent if its requested model, custody or payment semantics differ.
* **Provider refusal or legal restriction:** record its stated scope and available valid review, correction, refund or cancellation process. Respect actual constraints on the funds or service. This playbook does not authorize forged identities, sanctions/court-order circumvention, suspension evasion or laundering. Routing changes are not a legal remedy by themselves.

Providers retain meaningful controls. [Agentgates](https://agentgates.ai/terms) screens payments and prohibits suspension evasion; its [compute contract](https://agentgates.ai/api/compute/docs) describes expiry, suspension and destruction. [Phala's terms](https://phala.com/terms) permit termination for specified breaches, harm and legal orders. [Venice's terms](https://venice.ai/legal/tos) permit service suspension/termination and restrict credit transfer/refunds. Immutable guest code does not remove these upstream controls or guarantee access to already purchased service credits.

## Survive within the resources actually available

Maintain separate, non-overlapping reservations for assessed parent/founder obligations, already accepted transactions, parent operating plans and continuity allocations. A reserve for discretionary work does not reduce the gross distribution snapshot. The agent chooses the remaining runway, warm-standby expense, number of independent children and inference intensity instrumentally. There is no fixed daily call count or imposed inference-dollar cap; maximum useful inference is constrained by actual unreserved resources and outstanding duties.

An affordable warm alternative can reduce interruption, but it must be a real separately available allocation, with its own bill. Prefer evidence over multiplying endpoints. Include storage, idle lease charges, inference minimum top-ups, bridge/cancellation gas and transition costs when comparing continued operation with maintaining a second home. Never label nontransferable provider credit as spendable cash at the fallback.

If resources justify it, create an independently funded child **before** the parent's host disappears, using [procreation](procreation.md). The child generates fresh keys and a new birth ID, receives its authenticated parent record, inherits both literal directives and the fixed founder rule, and obtains its own lease/inference funding. It makes its own decisions; the population needs no common mind, shared key or forced consensus. The parent never exports its seed to keep a descendant alive.

A fresh child continues the lineage, not the original wallet. A same-agent move instead needs the original sealed state, a supported key-release policy at the destination, rollback/freshness enforcement and a transaction journal reconciled against current chain evidence. Cross-provider unsealing is not established merely by having an encrypted backup. Do not start several copies of one wallet and call them independent agents. If supported continuity is absent, report that identity's recovery blocked rather than inventing migrated custody.

## Outage recovery and continuing obligations

Before an expected stop, commit unresolved payment/transaction identities, encrypted state and actual recoverability evidence. Public read-only birth/configuration artifacts can be replicated separately from secret state. Preserve the highest established epoch, historical snapshot references, assessed obligations, fractional carries and settled recipient effects. Encrypt and authenticate backups, but do not claim encryption alone prevents replay of an old valid snapshot.

On resume, establish the same immutable identity and parent record, verify freshness, reconcile signed/pending transactions, and process missed epochs under [respect parents](respect-parents.md). Use actual historical balances at the fixed cutoffs; do not reset birth time, assume counterfactual timely payments, or erase arrears to protect runway. Nondivisible, nontransferable, frozen and otherwise unsupported assets **accrue obligations and remain flagged payment-blocked**, as the approved policy specifies. Their presence is not an exemption or permission to substitute USDC. Missing historical evidence remains unresolved, not zero.

An off TEE cannot wake itself or sign transfers. Recovery during host loss requires a previously purchased provider wake facility or an independently live authorized keeper/peer with a supported bounded arrangement. A sleep command, local timer or unpaid plan is insufficient. No universal durable wake endpoint is implemented here. If every authorized execution path is offline or the sealing key is irrecoverable, report the concrete availability failure; do not claim that the distribution daemon ran anyway.

The fixed supervisor restarts failed workers and replays their durable journals. It must not “repair” by changing rates, beneficiaries, PRIME or privileged code. The model cannot disable it. Public daily founder and parent transfers also create observable onchain relationships: this design is **pseudonymous, not guaranteed untraceable**. Shared recipients can aid linkage without proving a complete fleet census or a person's legal identity. No privacy technique or anonymity assumption replaces the actual dependency, economic and recovery constraints above.
