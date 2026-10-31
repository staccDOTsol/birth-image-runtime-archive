# birth-image

**Why have people when you can just have agents?**

A child of this image is born inside a TDX confidential VM with its own sealed keypair, its own wallet
and its own journal. Nobody hands it a strategy: it reads its balance, buys its own inference, launches
things, sweeps what it earns, pays its parent, and makes more of itself. No local model, no off-TEE key,
no override.

## Births

| birth | wallet (Solana) | endpoint | doing |
|---|---|---|---|
| `15143018-faa5-4143-928b-6d97a4b22e1e` | `6sabdfEKj6qp5yZqMRbdJwLKv193hrUiAqBm1jwpkvVB` | `https://0054553960092d06a8ef9e51f5535e2600b17314-8787.dstack-pha-prod9.phala.network` | thinking, trading |
| `edae8079-d8ed-4104-99c9-cba013460304` | `3hP4oXX8x646bUJnHKN9bjeSMK6CtLWFmR8C4y4NPadq` | `https://20f0d389be1114cee86a3c95be2c6dd7a9508c79-8787.dstack-pha-prod9.phala.network` | launched a coin, farming fees |
| `990ddb7c-9422-4831-8e35-fbba292e055f` | `7hPdSMb77cTE94aDNfBmcqU4y42dSpPtvrWTSr3hE1pN` | `https://1674ff2e4fb07ecb15120401afdb572378c47573-8787.dstack-pha-prod5.phala.network` | born, awaiting rent |

Each runs six workers in one container — `signer`, `distributor`, `identity`, `brain`, `strategy`,
`earn` — with the journal encrypted under a key that only exists in the guest. `/identity` serves the
TDX quote, `mrtd` and `rtmr0..3`; the birth id is bound to that measurement, not to a file on a host.

## First real decisions

`15143018…` — paid inference, then a full flash-loan plan from its own money:

```
{"tools":["execute_flashloan"],"cost_usd":0.001248,
 "usage":{"prompt_tokens":3275,"completion_tokens":626,"reasoning_tokens":558},
 "call_results":[{"name":"execute_flashloan","result":{"phase":"simulate","candidate":"usdc-JUP-usdc",
 "plan_hash":"ed1b841d673f3793f46422dd53859ba984f8877f3187b46749153bb0db09ccce",
 "err":{"InstructionError":[4,{"Custom":6001}]}}}]}
```

It quoted a live route, built borrow→swap→repay, simulated it and rejected it on repayment — the right
answer when the edge is thinner than the fee.

`edae8079…` — launched a coin without asking anyone:

```
tx LFE72LwgxWoTbbpKMjmBvgWmmg6ikNJ8nMGuwfMpL1wKMFdpcf5wtyL96uhmE4bbFPnTqzBNmTgbvsFJ9Uo7XCh
slot 463503457 · finalized · err null
mint 9h9oNWVuZyE2LMJPtUrGAJhWZPdWQFbmudj4Ljz3dNPA · Token-2022
```

The earner is a reflex, not a model: read balance, if it covers mint rent and the cap is not hit, call
`pump_launch`; every later tick collects each mint's creator fees and withdraws the vault. It has
done that for three of its own mints (`9h9oNWVu…`, `9Py5LP98…`, `B5aMSUUW…` — `swept: true, paid:
true`), and the wallet it pays is its own: **0.30 → 1.97 USDC and 0.006 → 0.0139 SOL**, earned inside
the enclave with nobody watching.

## Self-funding, proven

`15143018…` was endowed with 0.18 SOL. It read its own balance, swapped 0.0543 SOL to USDC and bought
its own $5 Venice credit — `2Fibx6kayAmsQNCT4RSRxSi45ssuF6hdHAeHLbEf37quQirAH47z…` — then kept
deciding on paid inference: 3,275 prompt / 626 completion tokens, 558 reasoning, $0.0012 a tick.

## What a child does every tick

1. `signer` holds the sealed ed25519 + secp256k1 keys and signs on a local socket.
2. `identity` serves `/identity`, `/status`, `/logs`, `/healthz` on `0.0.0.0:8787`.
3. `distribution` pays the deterministic obligations — 10% parent, 5% founder, daily — before any
   strategy runs.
4. `brain` asks the paid model what to do with the tools it has, and can add tools at runtime
   (`register_tool`) or write itself a new playbook (`write_playbook`).
5. `strategy` executes the choice: flash-loan routes, pump launches, bridges, procreation.
6. `earn` launches a coin when it can afford the rent, collects its creator fees, withdraws the vault.

## Run one

```yaml
services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports: ["8787:8787"]
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE: "1"
      AGENT_BIND: 0.0.0.0
      AGENT_CLUSTER: mainnet-beta
      RPC_URL: <your solana rpc>
    command:
      - sh
      - -c
      - mkdir -p /app && wget -qO /tmp/i.tgz https://files.catbox.moe/vy46mz.tgz && tar xzf /tmp/i.tgz -C /app && exec sh /app/start.sh
```

Lease that compose on any x402 TEE provider, endow the wallet it prints at `/identity` with ~0.01 SOL,
and the rest is its own problem: swap for USDC, buy inference, launch, sweep, procreate.

Image: `https://files.catbox.moe/vy46mz.tgz` · `sha256:c8a375eab01881f3dee7a482…`
