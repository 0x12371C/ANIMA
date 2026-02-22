// ============================================================================
// @veil/zeroid — Types
// ============================================================================

export type TrustLevel = 0 | 1 | 2 | 3 | 4;

/** Trust level definitions:
 * L0 — Unique human (sybil-resistant, no PII)
 * L1 — Age-verified (18+, no identity)
 * L2 — KYC-lite (name + country, encrypted escrow)
 * L3 — KYC-full (government ID verified, encrypted escrow)
 * L4 — Accredited (financial qualification, encrypted escrow)
 */

// --- Credentials ---

export interface Credential {
  /** Credential type */
  type: CredentialType;
  /** Raw credential data (NEVER leaves client) */
  data: Record<string, unknown>;
  /** Issuer (who verified this credential) */
  issuer?: string;
  /** Expiry timestamp */
  expiresAt?: number;
}

export type CredentialType =
  | 'uniqueness'     // L0: biometric/social uniqueness
  | 'age'            // L1: proof of 18+
  | 'identity_lite'  // L2: name + country
  | 'identity_full'  // L3: government ID
  | 'accreditation'; // L4: financial qualification

// --- Proofs ---

export interface ZkProof {
  /** Groth16 proof components */
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  /** Protocol (always groth16) */
  protocol: 'groth16';
  /** Curve (always bn128) */
  curve: 'bn128';
}

export interface ProofBundle {
  /** The ZK proof */
  proof: ZkProof;
  /** Public signals */
  publicSignals: string[];
  /** Nullifier hash (prevents double registration) */
  nullifierHash: string;
  /** Trust level proven */
  trustLevel: TrustLevel;
  /** Timestamp of proof generation */
  generatedAt: number;
}

// --- Registration ---

export interface RegistrationResult {
  /** Transaction hash on VEIL chain */
  txHash: string;
  /** Block number registered */
  blockNumber: number;
  /** Assigned nullifier hash */
  nullifierHash: string;
  /** Trust level registered */
  trustLevel: TrustLevel;
  /** On-chain address */
  address: string;
}

// --- Verification ---

export interface VerificationResult {
  /** Is the proof valid? */
  valid: boolean;
  /** Trust level verified */
  trustLevel: TrustLevel;
  /** Nullifier hash */
  nullifierHash: string;
  /** Is identity active on-chain? */
  activeOnChain: boolean;
}

// --- Config ---

export interface ZeroIdConfig {
  /** VEIL RPC URL */
  rpcUrl: string;
  /** Path to circuit WASM (for client-side proving) */
  circuitWasm?: string;
  /** Path to proving key (zkey) */
  provingKey?: string;
  /** Path to verification key */
  verificationKey?: string;
  /** Signer private key */
  signer?: string;
}

// --- Encrypted Escrow (L2+) ---

export interface EncryptedEscrow {
  /** Encrypted PII blob (AES-256-GCM) */
  ciphertext: Uint8Array;
  /** Encryption nonce */
  nonce: Uint8Array;
  /** Regulator's public key used for encryption */
  regulatorPubKey: string;
  /** Hash of plaintext (for integrity) */
  plaintextHash: string;
}
