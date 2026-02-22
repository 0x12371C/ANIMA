declare module '@veil/vm-sdk' {
  export interface Signer {
    address: string;
    signMessage(message: Uint8Array): Promise<string>;
    signTransaction(tx: unknown): Promise<string>;
  }

  export interface VeilChainConfig {
    rpcUrl: string;
    chainId?: number;
    signer?: string | Signer;
    xaiApiKey?: string;
    xaiEndpoint?: string;
  }

  export type BloodswornTier =
    | 'unproven'
    | 'initiate'
    | 'blooded'
    | 'sworn'
    | 'sovereign';

  export interface BloodswornScore {
    composite: number;
    tier: BloodswornTier;
  }

  export type AgentState =
    | 'newborn'
    | 'trading'
    | 'earning'
    | 'provisioning'
    | 'validating'
    | 'adolescent'
    | 'dead';

  export type AgentRole =
    | 'market_maker'
    | 'data_provider'
    | 'infra_operator'
    | 'validator'
    | 'general';

  export interface Agent {
    address: string;
    state: AgentState;
    bloodsworn: BloodswornScore;
    veilBalance: bigint;
    vaiBalance: bigint;
  }

  export type ResolutionType = 'binary' | 'scalar' | 'categorical';

  export interface MarketParams {
    question: string;
    resolutionCriteria: string;
    evidenceSources: string[];
    resolutionType: ResolutionType;
    deadline: number;
    initialLiquidity: bigint;
    category?: string;
  }

  export interface Market {
    id: string;
    params: MarketParams;
    state: 'open' | 'closed' | 'resolving' | 'resolved' | 'invalid';
    volume: bigint;
  }

  export interface MarketResolution {
    outcome: string;
    confidence: number;
    evidence: string[];
    reasoning: string;
    resolvedAt: number;
    resolver: string;
  }

  export interface ChainEvent {
    name: string;
    args: Record<string, unknown>;
    address: string;
    blockNumber: number;
    transactionHash: string;
  }

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

  export interface TransactionReceipt {
    hash: string;
    blockNumber: number;
    blockHash: string;
    status: 'success' | 'reverted';
    gasUsed: bigint;
    events: ChainEvent[];
  }

  export class VeilClient {
    constructor(config: VeilChainConfig);
    ping(): Promise<boolean>;
    getBlockNumber(): Promise<number>;
    getAgent(address: string): Promise<Agent | null>;
    transitionState(targetState: AgentState): Promise<TransactionReceipt>;
    createMarket(params: MarketParams): Promise<TransactionReceipt>;
    listMarkets(opts?: {
      state?: string;
      category?: string;
      limit?: number;
      offset?: number;
    }): Promise<Market[]>;
    trade(marketId: string, outcome: string, amount: bigint): Promise<TransactionReceipt>;
    resolveMarket(marketId: string): Promise<MarketResolution>;
    stake(amount: bigint, role: AgentRole): Promise<TransactionReceipt>;
    unstake(amount: bigint): Promise<TransactionReceipt>;
    on(filter: VeilEventFilter, callback: (event: ChainEvent) => void | Promise<void>): () => void;
    getConfiguredAddress(): string;
  }
}
