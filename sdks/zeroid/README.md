# @veil/zeroid

Privacy-preserving identity for the VEIL chain. ZK-SNARK proofs generated client-side — raw PII never leaves the device.

## Install

```bash
npm install @veil/zeroid
```

## Quick Start

```typescript
import { ZeroIdProver, ZeroIdVerifier } from '@veil/zeroid';
import { createClient } from '@veil/vm-sdk';

// --- Client-side: Generate proof ---

const prover = new ZeroIdProver(circuitWasm, provingKey);

const proof = await prover.prove(
  [
    { type: 'uniqueness', data: { biometric: '...' } },
    { type: 'age', data: { over18: true } },
  ],
  secret,    // User's private secret
  1,         // Target trust level (L1: age-verified)
);

// --- Register on VEIL chain ---

const veil = createClient('https://rpc.veil.markets', {
  signer: process.env.PRIVATE_KEY,
});

await veil.registerIdentity({
  proof: new Uint8Array(Buffer.from(JSON.stringify(proof.proof))),
  publicSignals: proof.publicSignals,
  trustLevel: proof.trustLevel,
  nullifierHash: proof.nullifierHash,
});

// --- Verify (off-chain or on-chain) ---

const verifier = new ZeroIdVerifier(verificationKey, 'https://rpc.veil.markets');
const result = await verifier.verifyProof(proof);
console.log(result.valid);         // true
console.log(result.activeOnChain); // true
```

## Trust Levels

| Level | Name | What's Proven | PII Exposed |
|-------|------|---------------|-------------|
| L0 | Unique Human | Sybil resistance | None |
| L1 | Age Verified | 18+ | None |
| L2 | KYC Lite | Name + Country | Encrypted escrow |
| L3 | KYC Full | Government ID | Encrypted escrow |
| L4 | Accredited | Financial qualification | Encrypted escrow |

## Encrypted Escrow (L2+)

For higher trust levels, PII is encrypted to a regulator's public key and stored on-chain. Only decryptable by the designated regulator (e.g., court order). The user proves properties about their identity without revealing it.

```typescript
const escrow = await prover.createEscrow(credentials, regulatorPubKey);
// escrow.ciphertext — AES-256-GCM encrypted PII
// escrow.plaintextHash — integrity check
```

## Native VM Primitive

ZER0ID is not a smart contract. It's verified at the transaction validation layer of the VEIL VM. An unverified address literally cannot transact — the VM rejects the transaction before EVM execution begins.

---

No users. Only developers.

© 2026 VEIL · TSL
