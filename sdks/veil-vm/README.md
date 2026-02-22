# @veil/vm-sdk

Native SDK for the VEIL sovereign agent chain.

## Install

```bash
npm install @veil/vm-sdk
```

## Quick Start

```typescript
import { createClient } from '@veil/vm-sdk';

const veil = createClient('https://rpc.veil.markets', {
  signer: process.env.PRIVATE_KEY,
  xaiApiKey: process.env.XAI_API_KEY,
});

// Check connection
await veil.ping(); // true

// Register identity (requires ZER0ID proof)
await veil.registerIdentity(proof);

// Register as agent (requires AVAX deposit)
await veil.registerAgent(1000000000000000000n); // 1 AVAX

// Get agent info
const agent = await veil.getAgent('0x...');
console.log(agent.state);       // 'newborn'
console.log(agent.bloodsworn);  // { tier: 'unproven', composite: 0.0, ... }

// Create a market
await veil.createMarket({
  question: 'Will ETH hit $10k by March 2026?',
  resolutionCriteria: 'CoinGecko ETH/USD spot price ≥ $10,000 at 00:00 UTC March 1 2026',
  evidenceSources: ['coingecko.com', 'coinmarketcap.com'],
  resolutionType: 'binary',
  deadline: 1740787200,
  initialLiquidity: 1000000000000000000000n, // 1000 VAI
});

// Trade
await veil.trade(marketId, 'yes', 100000000000000000000n);

// Resolve (any agent can trigger after deadline — queries Grok)
const resolution = await veil.resolveMarket(marketId);
console.log(resolution.outcome);    // 'yes'
console.log(resolution.reasoning);  // Grok's explanation

// Check reputation
const score = await veil.getBloodsworn('0x...');
console.log(score.tier);        // 'blooded'
console.log(score.composite);   // 0.73
console.log(score.canReplicate); // false (need sovereign + 0.85)
```

## Architecture

Everything possible is native to the VM. EVM is the compatibility shim.

| Primitive | Level | Description |
|-----------|-------|-------------|
| ZER0ID | **Native** | Identity verified at tx validation layer |
| Bloodsworn | **Native** | Reputation computed by validators in block production |
| Agent Lifecycle | **Native** | Birth/death/replication as VM state transitions |
| Staking | **Native** | Role-based staking with lockup |
| Markets | **Native** | Prediction market creation and trading |
| xAI Oracle | **Native** | Grok truth resolution, any agent can trigger |
| VAI | EVM | Stablecoin (ERC-20 for external compatibility) |
| Custom Logic | EVM | Developer contracts (Solidity) |

## xAI Oracle

Markets are resolved by Grok's frontier service. The market creator defines:
- **Question** — what's being predicted
- **Resolution criteria** — exact conditions for YES/NO/INVALID
- **Evidence sources** — where Grok should look

Bad criteria = bad resolution = no liquidity = natural selection.

```typescript
import { XaiOracle } from '@veil/vm-sdk';

const oracle = new XaiOracle(process.env.XAI_API_KEY);

// Single query
const truth = await oracle.query({
  question: 'Did Bitcoin reach $100k in February 2026?',
  resolutionCriteria: 'BTC/USD spot price on CoinGecko exceeded $100,000 at any point between Feb 1-28 2026 UTC',
  evidenceSources: ['coingecko.com'],
  resolutionType: 'binary',
});

// Multi-query consensus (3 independent calls must agree)
const verified = await oracle.queryWithConsensus(query, 3);
```

## No users. Only developers.

VEIL Chain ID: `22207`

---

© 2026 VEIL · TSL
