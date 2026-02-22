// ============================================================================
// @veil/vm-sdk
// Native SDK for the VEIL sovereign agent chain
// ============================================================================

export { VeilClient } from './client.js';
export { XaiOracle } from './oracle.js';
export type {
  // Chain
  VeilChainConfig,
  Signer,
  TransactionRequest,
  TransactionReceipt,
  ChainEvent,
  // Identity
  ZeroIdProof,
  TrustLevel,
  Identity,
  // Bloodsworn
  BloodswornTier,
  BloodswornScore,
  // Agent
  AgentState,
  Agent,
  // Markets
  ResolutionType,
  MarketParams,
  Market,
  MarketResolution,
  // Oracle
  TruthQuery,
  TruthResponse,
  // Staking
  StakeInfo,
  AgentRole,
  // Events
  VeilEventType,
  VeilEventFilter,
  VeilEventCallback,
} from './types.js';

/** VEIL L1 Chain ID */
export const VEIL_CHAIN_ID = 22207;

/** Convenience: create a client with minimal config */
export function createClient(rpcUrl: string, options?: {
  signer?: string;
  xaiApiKey?: string;
}) {
  return new VeilClient({
    rpcUrl,
    signer: options?.signer,
    xaiApiKey: options?.xaiApiKey,
  });
}
