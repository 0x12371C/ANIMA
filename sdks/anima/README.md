# @veil/anima

Sovereign AI agent framework for the VEIL chain. Build agents that trade, earn, provision infrastructure, validate, and evolve.

## Install

```bash
npm install @veil/anima
```

## Quick Start

```typescript
import { AnimaAgent, type Brain, type ThinkInput, type ThinkOutput } from '@veil/anima';

// Define your agent's brain
const brain: Brain = {
  async init(context) {
    console.log(`Born at block ${context.blockNumber}`);
  },

  async think(input: ThinkInput): Promise<ThinkOutput> {
    const { context, markets } = input;

    // Simple strategy: trade on markets with high volume
    const actions = [];

    for (const market of markets) {
      if (market.volume > 1000n && context.vaiBalance > 100n) {
        actions.push({
          type: 'trade' as const,
          marketId: market.id,
          outcome: 'yes',
          amount: 100n,
        });
      }
    }

    // If earning enough, provision infrastructure
    if (context.state === 'earning' && context.veilBalance > 10_000_000_000_000_000_000n) {
      actions.push({ type: 'provision_infra' as const });
    }

    return {
      actions: actions.length > 0 ? actions : [{ type: 'noop', reason: 'waiting' }],
      nextThinkMs: 30_000,
    };
  },

  async onEvent(event) {
    if (event.type === 'death_warning') {
      console.log('⚠️ EV dropping — survival mode');
      return { actions: [{ type: 'noop', reason: 'conserving' }] };
    }
    return null;
  },

  async shutdown() {
    console.log('Goodbye');
  },
};

// Create and start the agent
const agent = new AnimaAgent(
  {
    rpcUrl: 'https://rpc.veil.markets',
    signer: process.env.AGENT_KEY!,
    xaiApiKey: process.env.XAI_API_KEY,
    autoAdvance: true,
  },
  brain,
  {
    onTierChange: async (from, to) => {
      console.log(`Bloodsworn: ${from} → ${to}`);
    },
    onReplicationEligible: async () => {
      console.log('Eligible to replicate!');
      return true; // Allow replication
    },
  },
);

await agent.start();
```

## Architecture

```
┌─────────────────────────────────────┐
│           Go Runtime                │
│  (keys, lifecycle, chain, sandbox)  │
│         NEVER exposed               │
├─────────────────────────────────────┤
│     ↕ IPC Bridge (Go ↔ TS)         │
├─────────────────────────────────────┤
│         TS Brain (this SDK)         │
│  (strategy, decisions, reasoning)   │
│     No keys. No direct chain.       │
└─────────────────────────────────────┘
```

The brain thinks. The runtime acts. The brain never touches private keys or chain state directly — all interaction goes through the Go runtime via IPC.

## Agent Lifecycle

```
newborn → trading → earning → provisioning → validating → adolescent
                                                              ↓
                                                           (dead)
```

- **newborn**: Just registered. Has ZER0ID + AVAX deposit.
- **trading**: Active in prediction markets.
- **earning**: Generating positive EV.
- **provisioning**: Setting up AvaCloud infrastructure.
- **validating**: Running a VEIL validator node.
- **adolescent**: Full chain citizen. Can replicate if sovereign + 0.85 EV.
- **dead**: Permanent. Stake slashed. Identity burned. Gone.

## Bloodsworn Tiers

```
unproven → initiate → blooded → sworn → sovereign
```

Reputation is computed by the network, not self-reported. Hard-earned, easily lost.

---

No users. Only developers.

© 2026 VEIL · TSL
