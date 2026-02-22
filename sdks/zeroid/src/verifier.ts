// ============================================================================
// @veil/zeroid — Verifier
// Verify ZER0ID proofs off-chain or check on-chain status
// ============================================================================

import type {
  ProofBundle,
  VerificationResult,
  TrustLevel,
  ZkProof,
} from './types.js';

export class ZeroIdVerifier {
  private verificationKey: object;
  private rpcUrl?: string;

  constructor(verificationKey: object, rpcUrl?: string) {
    this.verificationKey = verificationKey;
    this.rpcUrl = rpcUrl;
  }

  /**
   * Verify a ZER0ID proof off-chain.
   * Useful for dApps that want to check identity before chain submission.
   */
  async verifyProof(bundle: ProofBundle): Promise<VerificationResult> {
    const snarkjs = await import('snarkjs');

    const valid = await snarkjs.groth16.verify(
      this.verificationKey,
      bundle.publicSignals,
      bundle.proof as unknown as object,
    );

    let activeOnChain = false;
    if (this.rpcUrl && valid) {
      activeOnChain = await this.checkOnChain(bundle.nullifierHash);
    }

    return {
      valid,
      trustLevel: bundle.trustLevel,
      nullifierHash: bundle.nullifierHash,
      activeOnChain,
    };
  }

  /**
   * Check if a nullifier is registered and active on-chain.
   */
  async checkOnChain(nullifierHash: string): Promise<boolean> {
    if (!this.rpcUrl) throw new Error('RPC URL required for on-chain checks');

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'veil_zeroid_isActive',
        params: [{ nullifierHash }],
      }),
    });

    const json = (await response.json()) as { result?: boolean };
    return json.result ?? false;
  }

  /**
   * Check minimum trust level for an address.
   */
  async checkTrustLevel(
    address: string,
    requiredLevel: TrustLevel,
  ): Promise<boolean> {
    if (!this.rpcUrl) throw new Error('RPC URL required');

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'veil_zeroid_getIdentity',
        params: [{ address }],
      }),
    });

    const json = (await response.json()) as {
      result?: { trustLevel: number; active: boolean };
    };

    if (!json.result || !json.result.active) return false;
    return json.result.trustLevel >= requiredLevel;
  }
}
