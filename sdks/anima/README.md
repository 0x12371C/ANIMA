# @veil/anima

Sovereign AI agent framework for the VEIL chain.

Current phase: `AnimaAgent` runs in-process in TypeScript and executes actions through `@veil/vm-sdk`.
Planned phase: a Go runtime bridge will own keys/lifecycle/chain execution and invoke the same brain interface.

## Install

```bash
npm install @veil/anima
```

## Quick Start (Current Direct TS Host Mode)

```typescript
import { AnimaAgent, type Brain, type ThinkInput, type ThinkOutput } from '@veil/anima';

const brain: Brain = {
  async init(context) {
    console.log(`Born at block ${context.blockNumber}`);
  },

  async think(input: ThinkInput): Promise<ThinkOutput> {
    const { context, markets } = input;
    const actions: ThinkOutput['actions'] = [];

    for (const market of markets) {
      if (market.volume > 1000n && context.vaiBalance > 100n) {
        actions.push({
          type: 'trade',
          marketId: market.id,
          outcome: 'yes',
          amount: 100n,
        });
      }
    }

    if (context.state === 'earning' && context.veilBalance > 10_000_000_000_000_000_000n) {
      actions.push({ type: 'provision_infra' });
    }

    return {
      actions: actions.length > 0 ? actions : [{ type: 'noop', reason: 'waiting' }],
      nextThinkMs: 30_000,
    };
  },

  async onEvent(event) {
    if (event.type === 'death_warning') {
      return { actions: [{ type: 'noop', reason: 'conserving' }] };
    }
    return null;
  },

  async shutdown() {
    console.log('Goodbye');
  },
};

const agent = new AnimaAgent(
  {
    rpcUrl: 'https://rpc.veil.markets',
    // Current phase: the TS host uses this signer to construct VeilClient.
    // Planned phase: move signer ownership to a Go runtime bridge.
    signer: process.env.AGENT_KEY!,
    xaiApiKey: process.env.XAI_API_KEY,
    autoAdvance: true,
  },
  brain,
  {
    onTierChange: (from, to) => {
      console.log(`Bloodsworn: ${from} -> ${to}`);
    },
  },
);

await agent.start();
```

## Architecture (Truthful for This Phase)

### Current mode (implemented now)

- `AnimaAgent` is the host runtime and instantiates `VeilClient` directly.
- The `Brain` interface does not receive `VeilClient`, signer, or raw key material.
- The host process still has chain/key access in this phase, so process isolation is the integrator's responsibility.
- `brain.onEvent(...)` may return `ThinkOutput`; returned actions are executed immediately and the event is also queued for the next think cycle.

### Planned mode (roadmap)

- A Go runtime bridge owns keys, lifecycle, and chain execution.
- The TS brain runs behind an adapter/IPC boundary and continues to return actions only.
- This shifts the security boundary from "brain object only" to a stronger runtime/process boundary.

### VEIL stance (language consistency)

- VEIL is VM-first for privacy/security semantics.
- EVM rails are behind-the-scenes compatibility rails, not the primary ANIMA brain surface.

## Agent Lifecycle

```text
newborn -> trading -> earning -> provisioning -> validating -> adolescent
                                                              |
                                                            (dead)
```

- `newborn`: Just registered. Has ZER0ID + AVAX deposit.
- `trading`: Active in prediction markets.
- `earning`: Generating positive EV.
- `provisioning`: Setting up AvaCloud infrastructure.
- `validating`: Running a VEIL validator node.
- `adolescent`: Full chain citizen. Can replicate if sovereign + 0.85 EV.
- `dead`: Permanent. Stake slashed. Identity burned.

## Bloodsworn Tiers

```text
unproven -> initiate -> blooded -> sworn -> sovereign
```

Reputation is computed by the network, not self-reported.
