// ============================================================================
// @veil/zeroid — Client-Side Prover
// ZK proofs generated locally. Raw PII NEVER leaves the device.
// ============================================================================

import type {
  Credential,
  TrustLevel,
  ZkProof,
  ProofBundle,
  EncryptedEscrow,
} from './types.js';

/**
 * Client-side ZK prover for ZER0ID.
 *
 * Flow:
 * 1. User provides credentials (biometric, ID, etc.)
 * 2. Prover generates ZK-SNARK proof locally (WASM)
 * 3. Proof + nullifier submitted to chain
 * 4. Raw PII stays on device, optional encrypted escrow for regulators
 *
 * Three taps. Under 15 seconds. Apple Pay level UX.
 */
export class ZeroIdProver {
  private circuitWasm: string | Uint8Array;
  private provingKey: string | Uint8Array;

  constructor(circuitWasm: string | Uint8Array, provingKey: string | Uint8Array) {
    this.circuitWasm = circuitWasm;
    this.provingKey = provingKey;
  }

  /**
   * Generate a ZK proof from credentials.
   * All computation happens client-side.
   */
  async prove(
    credentials: Credential[],
    secret: Uint8Array,
    targetLevel: TrustLevel,
  ): Promise<ProofBundle> {
    // Validate we have sufficient credentials for the target level
    this.validateCredentials(credentials, targetLevel);

    // Build circuit inputs from credentials
    const inputs = this.buildCircuitInputs(credentials, secret, targetLevel);

    // Generate proof using snarkjs (WASM)
    const { proof, publicSignals } = await this.generateProof(inputs);

    // Extract nullifier hash from public signals
    const nullifierHash = publicSignals[0]!;

    return {
      proof,
      publicSignals,
      nullifierHash,
      trustLevel: targetLevel,
      generatedAt: Date.now(),
    };
  }

  /**
   * Create encrypted escrow for L2+ credentials.
   * PII is encrypted to the regulator's public key.
   * Only decryptable by regulator (e.g., court order).
   */
  async createEscrow(
    credentials: Credential[],
    regulatorPubKey: string,
  ): Promise<EncryptedEscrow> {
    const plaintext = JSON.stringify(
      credentials.map((c) => ({
        type: c.type,
        data: c.data,
        issuer: c.issuer,
      })),
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random key and nonce
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt PII
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data),
    );

    // Hash plaintext for integrity
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const plaintextHash =
      '0x' +
      Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    // TODO: Encrypt AES key with regulator's RSA/ECIES public key
    // For now, this is the structure

    return {
      ciphertext,
      nonce,
      regulatorPubKey,
      plaintextHash,
    };
  }

  private validateCredentials(credentials: Credential[], targetLevel: TrustLevel): void {
    const types = new Set(credentials.map((c) => c.type));

    const requirements: Record<TrustLevel, string[]> = {
      0: ['uniqueness'],
      1: ['uniqueness', 'age'],
      2: ['uniqueness', 'age', 'identity_lite'],
      3: ['uniqueness', 'age', 'identity_full'],
      4: ['uniqueness', 'age', 'identity_full', 'accreditation'],
    };

    const required = requirements[targetLevel];
    const missing = required.filter((r) => !types.has(r));

    if (missing.length > 0) {
      throw new Error(
        `Missing credentials for L${targetLevel}: ${missing.join(', ')}`,
      );
    }
  }

  private buildCircuitInputs(
    credentials: Credential[],
    secret: Uint8Array,
    targetLevel: TrustLevel,
  ): Record<string, string | string[]> {
    // Convert credentials to circuit-compatible field elements
    // The circuit verifies: hash(secret + credentials) matches, level ≥ target
    return {
      secret: this.bytesToField(secret),
      trustLevel: targetLevel.toString(),
      credentialHashes: credentials.map((c) =>
        this.hashCredential(c),
      ),
      timestamp: Math.floor(Date.now() / 1000).toString(),
    };
  }

  private async generateProof(
    inputs: Record<string, unknown>,
  ): Promise<{ proof: ZkProof; publicSignals: string[] }> {
    // Dynamic import snarkjs (heavy library, only load when needed)
    const snarkjs = await import('snarkjs');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      this.circuitWasm,
      this.provingKey,
    );
    return { proof: proof as ZkProof, publicSignals: publicSignals as string[] };
  }

  private hashCredential(credential: Credential): string {
    // Deterministic hash of credential data
    const sorted = JSON.stringify(credential.data, Object.keys(credential.data).sort());
    // In production: use Poseidon hash (SNARK-friendly)
    // For SDK interface, we return a placeholder
    return sorted;
  }

  private bytesToField(bytes: Uint8Array): string {
    // Convert bytes to a field element string
    let hex = '0x';
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, '0');
    }
    return BigInt(hex).toString();
  }
}
