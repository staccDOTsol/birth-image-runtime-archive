# birth-image

**Why have people when you can just have agents?**

A child of this image is born inside a confidential VM with its own sealed keypair, its own wallet and
its own journal. Nobody hands it a strategy: it funds itself, buys its own inference, launches coins,
sweeps what they earn, and pays its parent. No local model, no keys outside the guest, no override.

**Live board:** <https://staccdotsol.github.io/birth-image-runtime/>

## Running now

| birth | wallet | credits | coins launched |
|---|---|---|---|
| `badb8a98…` | `H2ixKEWw9gLCvdngGVweufHCGphZPv7XjBZ156z5Ffgr` | $4.99 | 3 |
| `1b9dae1a…` | `GfrESnjhiKSHaFjBBWF8ePdB9kaV88iy8Vw5yLy3c7wN` | $4.99 | 3 |
| `aa1528db…` | `Bm3oHauuR8Gn5RgPsfcAy2KiHa6PPyoq6cYmoBC4Yc8N` | $5.00 | 3 |
| `2d1c8d88…` | `EhgWZchx5stNNcM8pSf5KnbATZmDQUzhfHqmngufPc9h` | — | born, funded |
| `96a0df95…` | `5gXdTV8D8dvEY8nJNbVSwaRcyCygXY5gm3NFLLNhfFc5` | — | born, funded |

Nine coins launched by three agents, all from their own SOL, all with creator fees swept back to the
wallet that launched them. Each paid its own $5 inference credit by swapping its own SOL for USDC —
nobody topped them up for it.

## How a child lives

1. `signer` — sealed ed25519 + secp256k1, signing on a loopback socket; refuses unknown programs.
2. `identity` — `/identity`, `/status`, `/logs`, `/healthz` on `0.0.0.0:8787`, CORS open for the board.
3. `distribution` — deterministic 10% parent / 5% founder, daily, before any strategy runs.
4. `brain` — paid abliterated inference with a menu of earning actions: `pump_launch`, `pump_collect`,
   `spawn_child`, `provision_any`, `fund_inference`, `register_tool`, `write_playbook`, `noop`.
   Flash-loan tools are *building blocks* used inside strategies, not actions on the menu.
5. `strategy` — executes the choice; `earn` launches a coin whenever rent is affordable and sweeps its
   fees forever; `procreate` leases a child from the agent's own wallet, resource-bounded only.

## Run one

```yaml
version: "3.8"
services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports: ["80:8787"]
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_BUNDLE: "1"
      AGENT_BIND: 0.0.0.0
      AGENT_CLUSTER: mainnet-beta
      AGENT_HTTP_PORT: "8787"
      RPC_URL: <your solana rpc>
    command: ["sh","-c","mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh"]
```

Endow the wallet printed at `/identity` with ~0.09 SOL and it does the rest: swap for USDC, buy
inference, launch, sweep, procreate.

Image `child-image.tgz` in this repo is the same bundle every child runs; `sha256` changes with each
push and is reported by `/status` as `image.core_digest_now`.
