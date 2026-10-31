# birth-image — live state

Autonomous agents born inside TDX confidential VMs. Each one seals an identity, funds itself by
selling its own SOL for USDC, buys its own inference, and spends every tick trying to end with more
money than it started with. No human in the loop, no local model, no keys outside the guest.

## Live children

| child | endpoint | wallet (Solana) | credits | last action |
|---|---|---|---|---|
| `cmvvpn9ga` | `https://0054553960092d06a8ef9e51f5535e2600b17314-8787.dstack-pha-prod9.phala.network` | `6sabdfEKj6qp5yZqMRbdJwLKv193hrUiAqBm1jwpkvVB` | $4.99 | `scan_flashloan` |
| `cmvvpvjm4` | `https://20f0d389be1114cee86a3c95be2c6dd7a9508c79-8787.dstack-pha-prod9.phala.network` | `3hP4oXX8x646bUJnHKN9bjeSMK6CtLWFmR8C4y4NPadq` | — | launched `9h9oNWVuZyE2LMJPtUrGAJhWZPdWQFbmudj4Ljz3dNPA` |

Both run all six workers — `signer`, `distributor`, `identity`, `brain`, `strategy`, `earn` — inside
one TEE container, with the journal encrypted at rest under a key that only exists in the guest.
`/identity` serves the TDX quote, `mrtd` and `rtmr0..3`; the birth id is bound to that measurement.

## Proof it earns on its own

- **Pump launch, unattended.** `cmvvpvjm4`, endowed with 0.012 SOL, launched
  `9h9oNWVuZyE2LMJPtUrGAJhWZPdWQFbmudj4Ljz3dNPA` on its second earn tick — tx
  `LFE72LwgxWoTbbpKMjmBvgWmmg6ikNJ8nMGuwfMpL1wKMFdpcf5wtyL96uhmE4bbFPnTqzBNmTgbvsFJ9Uo7XCh`,
  slot `463503457`, finalized, no error. The mint is a live Token-2022 account. Creator fees from it
  are swept to the child's own wallet by the same worker.
- **The earner needs no inference.** It is a reflex: read balance, if it covers mint rent and the
  mint cap is not hit, call `pump_launch` with a generated name. The model picks strategy; it does
  not make the launch happen.
- **Self-funding.** `cmvvpn9ga` was endowed with 0.18 SOL, read its own balance, swapped 0.0543 SOL
  to USDC and bought its own $5 Venice credit — `2Fibx6kayAmsQNCT4RSRxSi45ssuF6hdHAeHLbEf37quQirAH47z…`.
- **Paid inference from inside the enclave.** Decisions carry real usage: 3,226 prompt / 1,159
  completion tokens, 1,115 of them reasoning, $0.0019 a tick.

## What a child does every tick

1. `signer` holds the sealed ed25519 + secp256k1 keys and signs on a local socket.
2. `identity` serves `/identity`, `/status`, `/logs`, `/healthz` on `0.0.0.0:8787`.
3. `distribution` pays the deterministic obligations — 10% parent, 5% founder, daily — before any
   strategy runs.
4. `brain` asks the paid model what to do with the tools it has, and can add tools at runtime
   (`register_tool`) or write itself a new playbook (`write_playbook`).
5. `strategy` executes the choice: flash-loan routes, pump launches, bridges, procreation.
6. `earn` launches a coin when it can afford the rent, then sweeps creator fees forever.

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
