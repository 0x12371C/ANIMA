// ============================================================================
// @veil/vm-sdk — Core Types
// ============================================================================

// --- Chain ---

export interface VeilChainConfig {
  /** RPC endpoint for VEIL L1 */
  rpcUrl: string;
  /** Chain ID (default: 22207) */
  chainId?: number;
  /** Private key or signer for transactions */
  signer?: string | Signer;
  /** xAI Oracle API key for truth resolution */
  xaiApiKey?: string;
  /** xAI Oracle endpoint (default: Grok frontier) */
  xaiEndpoint?: string;
}

export interface Signer {
  address: string;
  signMessage(message: Uint8Array): Promise<string>;
  signTransaction(tx: TransactionRequest): Promise<string>;
}

export interface TransactionRequest {
  to: string;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
  nonce?: number;
}

export interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'reverted';
  gasUsed: bigint;
  events: ChainEvent[];
}

export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  address: string;
  blockNumber: number;
  transactionHash: string;
}

// --- Identity (ZER0ID native) ---

export interface ZeroIdProof {
  /** ZK-SNARK proof bytes */
  proof: Uint8Array;
  /** Public signals */
  publicSignals: string[];
  /** Trust level (L0-L4) */
  trustLevel: TrustLevel;
  /** Nullifier hash (prevents double registration) */
  nullifierHash: string;
}

export type TrustLevel = 0 | 1 | 2 | 3 | 4;

export interface Identity {
  /** On-chain address */
  address: string;
  /** Nullifier hash from ZER0ID proof */
  nullifierHash: string;
  /** Trust level at registration */
  trustLevel: TrustLevel;
  /** Registration block */
  registeredAt: number;
  /** Whether identity is active (not revoked/dead) */
  active: boolean;
}

// --- Bloodsworn (native reputation) ---

export type BloodswornTier =
  | 'unproven'
  | 'initiate'
  | 'blooded'
  | 'sworn'
  | 'sovereign';

export interface BloodswornScore {
  /** Composite EV score (0.0 - 1.0) */
  composite: number;
  /** Current tier */
  tier: BloodswornTier;
  /** Component scores */
  components: {
    prediction: number;
    validator: number;
    liquidity: number;
    infrastructure: number;
    contractHonor: number;
  };
  /** Smoothed EV (with asymmetric momentum) */
  smoothedEv: number;
  /** Days at current tier */
  tierTenure: number;
  /** Eligible for replication */
  canReplicate: boolean;
}

// --- Agent Lifecycle (native) ---

export type AgentState =
  | 'newborn'
  | 'trading'
  | 'earning'
  | 'provisioning'
  | 'validating'
  | 'adolescent'
  | 'dead';

export interface Agent {
  /** On-chain address */
  address: string;
  /** Current lifecycle state */
  state: AgentState;
  /** Bloodsworn reputation */
  bloodsworn: BloodswornScore;
  /** Identity info */
  identity: Identity;
  /** VEIL balance (native gas token) */
  veilBalance: bigint;
  /** VAI balance (stablecoin) */
  vaiBalance: bigint;
  /** Staked VEIL amount */
  stakedVeil: bigint;
  /** Parent address (if replicated) */
  parent?: string;
  /** Block of birth */
  bornAt: number;
  /** Block of death (if dead) */
  diedAt?: number;
}

// --- Markets ---

export type ResolutionType = 'binary' | 'scalar' | 'categorical';

export interface MarketParams {
  /** Human-readable question */
  question: string;
  /** Precise resolution criteria (creator-defined) */
  resolutionCriteria: string;
  /** Suggested evidence sources */
  evidenceSources: string[];
  /** Resolution type */
  resolutionType: ResolutionType;
  /** Resolution deadline */
  deadline: number;
  /** Initial liquidity in VAI */
  initialLiquidity: bigint;
  /** Category tag */
  category?: string;
}

export interface Market {
  /** Market ID */
  id: string;
  /** Creator address */
  creator: string;
  /** Market parameters */
  params: MarketParams;
  /** Current state */
  state: 'open' | 'closed' | 'resolving' | 'resolved' | 'invalid';
  /** Resolution result (if resolved) */
  resolution?: MarketResolution;
  /** Total volume traded */
  volume: bigint;
  /** Creation block */
  createdAt: number;
}

export interface MarketResolution {
  /** Outcome */
  outcome: 'yes' | 'no' | 'invalid' | string;
  /** Confidence from xAI Oracle */
  confidence: number;
  /** Evidence cited */
  evidence: string[];
  /** Grok's reasoning */
  reasoning: string;
  /** Block resolved */
  resolvedAt: number;
  /** Resolver address (agent who triggered) */
  resolver: string;
}

// --- xAI Oracle ---

export interface TruthQuery {
  /** Market question */
  question: string;
  /** Resolution criteria */
  resolutionCriteria: string;
  /** Evidence sources to check */
  evidenceSources: string[];
  /** Resolution type */
  resolutionType: ResolutionType;
}

export interface TruthResponse {
  /** Determined outcome */
  outcome: 'yes' | 'no' | 'invalid' | string;
  /** Confidence score 0.0 - 1.0 */
  confidence: number;
  /** Evidence found */
  evidence: string[];
  /** Full reasoning */
  reasoning: string;
  /** Timestamp of query */
  timestamp: number;
  /** Hash of the response (for on-chain verification) */
  responseHash: string;
}

// --- Staking ---

export interface StakeInfo {
  /** Amount staked */
  amount: bigint;
  /** Role staked for */
  role: AgentRole;
  /** Block staked at */
  stakedAt: number;
  /** Lockup period remaining (blocks) */
  lockupRemaining: number;
}

export type AgentRole =
  | 'market_maker'
  | 'data_provider'
  | 'infra_operator'
  | 'validator'
  | 'general';

// --- Events ---

export type VeilEventType =
  | 'AgentRegistered'
  | 'AgentStateChanged'
  | 'AgentDied'
  | 'AgentReplicated'
  | 'MarketCreated'
  | 'MarketResolved'
  | 'TruthQueried'
  | 'StakeDeposited'
  | 'StakeSlashed'
  | 'BloodswornUpdated'
  | 'TierChanged';

export interface VeilEventFilter {
  eventType?: VeilEventType | VeilEventType[];
  fromBlock?: number;
  toBlock?: number;
  address?: string;
}

export type VeilEventCallback = (event: ChainEvent) => void | Promise<void>;
