# @veil/zeroid

Privacy-preserving identity SDK for VEIL. This package currently provides client-side proof/verification wrappers plus helper utilities for VEIL VM `registerIdentity` payload formatting.

## Install

```bash
npm install @veil/zeroid
```

## Quick Start

```typescript
import {
  ZeroIdProver,
  ZeroIdVerifier,
  toVeilVmRegisterIdentityPayload,
} from '@veil/zeroid';
import { createClient } from '@veil/vm-sdk';

// --- Client-side: Generate proof ---

const prover = new ZeroIdProver(circuitWasm, provingKey);

const bundle = await prover.prove(
  [
    { type: 'uniqueness', data: { biometric: '...' } },
    { type: 'age', data: { over18: true } },
  ],
  secret, // User's private secret
  1, // Target trust level (L1: age-verified)
);

// --- Register on VEIL chain ---

const veil = createClient('https://rpc.veil.markets', {
  signer: process.env.PRIVATE_KEY,
});

await veil.registerIdentity(toVeilVmRegisterIdentityPayload(bundle));

// Current helper serialization behavior:
// - payload.proof is UTF-8 bytes of JSON.stringify(bundle.proof)
// - payload excludes bundle.generatedAt (local SDK metadata)

// --- Verify (off-chain or on-chain) ---

const verifier = new ZeroIdVerifier(verificationKey, 'https://rpc.veil.markets');
const result = await verifier.verifyProof(bundle);
console.log(result.valid); // true
console.log(result.activeOnChain); // true
```

## Trust Levels

| Level | Name | What is Proven | PII Exposed |
|-------|------|----------------|-------------|
| L0 | Unique Human | Sybil resistance | None |
| L1 | Age Verified | 18+ | None |
| L2 | KYC Lite | Name + Country | Escrow blob (key wrapping pending) |
| L3 | KYC Full | Government ID | Escrow blob (key wrapping pending) |
| L4 | Accredited | Financial qualification | Escrow blob (key wrapping pending) |

## Escrow (Current SDK Limitation for L2+)

`createEscrow()` currently:

- serializes credentials and encrypts them with a fresh AES-GCM content key
- returns the ciphertext, nonce, plaintext hash, and regulator key metadata
- does not yet wrap/export the AES content key for regulator decryption

The returned escrow object is therefore **not regulator-decryptable yet**.

```typescript
const escrow = await prover.createEscrow(credentials, regulatorPubKey);

console.log(escrow.ciphertext); // Uint8Array (AES-GCM ciphertext)
console.log(escrow.nonce); // Uint8Array (12-byte nonce)
console.log(escrow.plaintextHash); // 0x-prefixed SHA-256 hash

// Explicitly indicates current limitation:
console.log(escrow.keyWrappingStatus); // 'not_implemented'
console.log(escrow.wrappedKey); // null
console.log(escrow.wrappedKeyAlgorithm); // null
```

## Native VM Integration

ZER0ID is intended for native VEIL VM integration (not a smart contract). Identity enforcement behavior depends on the active VM/runtime configuration and deployment state.

## Notes

- `createEscrow()` uses Web Crypto and falls back to `node:crypto.webcrypto` in supported Node.js runtimes when `globalThis.crypto` is unavailable.
- `prove()` currently derives `nullifierHash` from `publicSignals[0]`; make sure your circuit/public signal ordering matches that assumption.

---

No users. Only developers.

Copyright 2026 VEIL | TSL
