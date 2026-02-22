// ============================================================================
// @veil/zeroid
// Privacy-preserving identity for the VEIL sovereign agent chain
// ============================================================================

export { ZeroIdProver } from './prover.js';
export { ZeroIdVerifier } from './verifier.js';
export {
  serializeProofForVeilVm,
  toVeilVmRegisterIdentityPayload,
} from './interop.js';
export type {
  TrustLevel,
  Credential,
  CredentialType,
  ZkProof,
  ProofBundle,
  ZeroIdRegisterIdentityPayload,
  RegistrationResult,
  VerificationResult,
  ZeroIdConfig,
  EncryptedEscrow,
} from './types.js';
