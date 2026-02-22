// ============================================================================
// @veil/zeroid - VEIL VM interop helpers
// ============================================================================

import type {
  ProofBundle,
  ZeroIdRegisterIdentityPayload,
  ZkProof,
} from './types.js';

/**
 * Serialize a Groth16 proof into the current VEIL SDK transport shape:
 * UTF-8 bytes of JSON.stringify(proof).
 */
export function serializeProofForVeilVm(proof: ZkProof): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(proof));
}

/**
 * Build the payload shape used by current VEIL VM registerIdentity SDK flows.
 *
 * Note: generatedAt is SDK-local metadata and is not included.
 */
export function toVeilVmRegisterIdentityPayload(
  bundle: ProofBundle,
): ZeroIdRegisterIdentityPayload {
  return {
    proof: serializeProofForVeilVm(bundle.proof),
    publicSignals: [...bundle.publicSignals],
    trustLevel: bundle.trustLevel,
    nullifierHash: bundle.nullifierHash,
  };
}
