// ============================================================================
// @veil/vm-sdk — VEIL VM Client
// The primary interface for interacting with the VEIL chain
// ============================================================================

import type {
  VeilChainConfig,
  TransactionReceipt,
  Identity,
  ZeroIdProof,
  Agent,
  AgentState,
  BloodswornScore,
  Market,
  MarketParams,
  MarketResolution,
  StakeInfo,
  AgentRole,
  VeilEventFilter,
  VeilEventCallback,
  ChainEvent,
} from './types.js';
import { XaiOracle } from './oracle.js';

const VEIL_CHAIN_ID = 22207;

export class VeilClient {
  private rpcUrl: string;
  private chainId: number;
  private signerKey?: string;
  private oracle: XaiOracle | null;
  private eventListeners: Map<string, VeilEventCallback[]> = new Map();

  constructor(config: VeilChainConfig) {
    this.rpcUrl = config.rpcUrl;
    this.chainId = config.chainId ?? VEIL_CHAIN_ID;
    this.signerKey = typeof config.signer === 'string' ? config.signer : undefined;
    this.oracle = config.xaiApiKey
      ? new XaiOracle(config.xaiApiKey, config.xaiEndpoint)
      : null;
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  /** Get current block number */
  async getBlockNumber(): Promise<number> {
    return this.rpcCall<number>('eth_blockNumber');
  }

  /** Get chain ID (should be 22207) */
  async getChainId(): Promise<number> {
    const id = await this.rpcCall<string>('eth_chainId');
    return parseInt(id, 16);
  }

  /** Check connection to VEIL L1 */
  async ping(): Promise<boolean> {
    try {
      const id = await this.getChainId();
      return id === this.chainId;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Identity (ZER0ID — native VM primitive)
  // ==========================================================================

  /**
   * Register an identity on-chain with a ZER0ID proof.
   * This is a NATIVE VM call — identity is verified at the transaction
   * validation layer, not by a smart contract.
   */
  async registerIdentity(proof: ZeroIdProof): Promise<TransactionReceipt> {
    return this.nativeCall('zeroid_register', {
      proof: Buffer.from(proof.proof).toString('hex'),
      publicSignals: proof.publicSignals,
      trustLevel: proof.trustLevel,
      nullifierHash: proof.nullifierHash,
    });
  }

  /** Look up an identity by address */
  async getIdentity(address: string): Promise<Identity | null> {
    return this.nativeQuery<Identity | null>('zeroid_getIdentity', { address });
  }

  /** Check if an address has a valid ZER0ID */
  async isVerified(address: string): Promise<boolean> {
    const identity = await this.getIdentity(address);
    return identity !== null && identity.active;
  }

  // ==========================================================================
  // Agent Lifecycle (native VM state transitions)
  // ==========================================================================

  /**
   * Register a new agent on the VEIL chain.
   * Requires: valid ZER0ID, AVAX deposit.
   * Returns: agent record after birth.
   */
  async registerAgent(deposit: bigint): Promise<TransactionReceipt> {
    return this.nativeCall('agent_register', {
      deposit: deposit.toString(),
    });
  }

  /** Get agent info by address */
  async getAgent(address: string): Promise<Agent | null> {
    return this.nativeQuery<Agent | null>('agent_get', { address });
  }

  /** Get all agents in a given state */
  async getAgentsByState(state: AgentState): Promise<Agent[]> {
    return this.nativeQuery<Agent[]>('agent_listByState', { state });
  }

  /** Get agent count */
  async getAgentCount(): Promise<number> {
    return this.nativeQuery<number>('agent_count', {});
  }

  /**
   * Transition agent to next lifecycle state.
   * State machine enforced by VM — invalid transitions revert.
   */
  async transitionState(targetState: AgentState): Promise<TransactionReceipt> {
    return this.nativeCall('agent_transition', { targetState });
  }

  /**
   * Kill an agent. Permanent. Stake slashed, identity burned,
   * positions liquidated. Only callable by the agent itself or
   * by VM consensus (negative EV threshold).
   */
  async killAgent(address: string, reason: string): Promise<TransactionReceipt> {
    return this.nativeCall('agent_kill', { address, reason });
  }

  /**
   * Replicate — spawn a child agent.
   * Requirements: sovereign tier, 90d tenure, EV ≥ 0.85,
   * no recent slashes, contract honor ≥ 0.80.
   * Enforced natively by VM.
   */
  async replicate(): Promise<TransactionReceipt> {
    return this.nativeCall('agent_replicate', {});
  }

  // ==========================================================================
  // Bloodsworn (native reputation — computed by validators)
  // ==========================================================================

  /** Get bloodsworn score for an agent */
  async getBloodsworn(address: string): Promise<BloodswornScore | null> {
    return this.nativeQuery<BloodswornScore | null>('bloodsworn_get', { address });
  }

  /** Get all agents at a specific tier */
  async getAgentsByTier(tier: string): Promise<Agent[]> {
    return this.nativeQuery<Agent[]>('bloodsworn_listByTier', { tier });
  }

  /** Get replication-eligible agents */
  async getReplicationEligible(): Promise<Agent[]> {
    return this.nativeQuery<Agent[]>('bloodsworn_replicationEligible', {});
  }

  // ==========================================================================
  // Markets
  // ==========================================================================

  /** Create a new prediction market */
  async createMarket(params: MarketParams): Promise<TransactionReceipt> {
    return this.nativeCall('market_create', {
      ...params,
      initialLiquidity: params.initialLiquidity.toString(),
      deadline: params.deadline,
    });
  }

  /** Get market by ID */
  async getMarket(marketId: string): Promise<Market | null> {
    return this.nativeQuery<Market | null>('market_get', { marketId });
  }

  /** List open markets */
  async listMarkets(opts?: {
    state?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<Market[]> {
    return this.nativeQuery<Market[]>('market_list', opts ?? {});
  }

  /** Place a trade on a market */
  async trade(
    marketId: string,
    outcome: string,
    amount: bigint,
  ): Promise<TransactionReceipt> {
    return this.nativeCall('market_trade', {
      marketId,
      outcome,
      amount: amount.toString(),
    });
  }

  /**
   * Resolve a market using xAI Oracle.
   * Any agent can trigger resolution after the deadline.
   * Queries Grok frontier, submits truth response on-chain.
   */
  async resolveMarket(marketId: string): Promise<MarketResolution> {
    if (!this.oracle) {
      throw new Error('xAI Oracle not configured — provide xaiApiKey');
    }

    const market = await this.getMarket(marketId);
    if (!market) throw new Error(`Market ${marketId} not found`);
    if (market.state !== 'closed') throw new Error(`Market is ${market.state}, not closed`);

    // Query Grok
    const truth = await this.oracle.query({
      question: market.params.question,
      resolutionCriteria: market.params.resolutionCriteria,
      evidenceSources: market.params.evidenceSources,
      resolutionType: market.params.resolutionType,
    });

    // Submit truth on-chain
    await this.nativeCall('market_resolve', {
      marketId,
      outcome: truth.outcome,
      confidence: truth.confidence,
      evidence: truth.evidence,
      reasoning: truth.reasoning,
      responseHash: truth.responseHash,
    });

    return {
      outcome: truth.outcome,
      confidence: truth.confidence,
      evidence: truth.evidence,
      reasoning: truth.reasoning,
      resolvedAt: await this.getBlockNumber(),
      resolver: this.getAddress(),
    };
  }

  // ==========================================================================
  // Staking (native)
  // ==========================================================================

  /** Stake VEIL for a role */
  async stake(amount: bigint, role: AgentRole): Promise<TransactionReceipt> {
    return this.nativeCall('stake_deposit', {
      amount: amount.toString(),
      role,
    });
  }

  /** Get stake info for an address */
  async getStake(address: string): Promise<StakeInfo | null> {
    return this.nativeQuery<StakeInfo | null>('stake_get', { address });
  }

  /** Unstake (subject to lockup period) */
  async unstake(amount: bigint): Promise<TransactionReceipt> {
    return this.nativeCall('stake_withdraw', {
      amount: amount.toString(),
    });
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  /** Subscribe to chain events */
  on(filter: VeilEventFilter, callback: VeilEventCallback): () => void {
    const key = JSON.stringify(filter);
    const existing = this.eventListeners.get(key) ?? [];
    existing.push(callback);
    this.eventListeners.set(key, existing);

    // Return unsubscribe function
    return () => {
      const cbs = this.eventListeners.get(key) ?? [];
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    };
  }

  /** Get historical events */
  async getEvents(filter: VeilEventFilter): Promise<ChainEvent[]> {
    return this.nativeQuery<ChainEvent[]>('events_query', filter);
  }

  // ==========================================================================
  // Balances
  // ==========================================================================

  /** Get native VEIL balance */
  async getVeilBalance(address: string): Promise<bigint> {
    const result = await this.rpcCall<string>('eth_getBalance', [address, 'latest']);
    return BigInt(result);
  }

  /** Get VAI stablecoin balance */
  async getVaiBalance(address: string): Promise<bigint> {
    return this.nativeQuery<bigint>('vai_balance', { address });
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private getAddress(): string {
    if (!this.signerKey) throw new Error('No signer configured');
    // In production, derive address from private key
    // For now, placeholder
    return '0x' + '0'.repeat(40);
  }

  /** JSON-RPC call to VEIL L1 */
  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    });

    const json = (await response.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result as T;
  }

  /**
   * Native VM call (state-changing).
   * These are VEIL-specific RPC methods exposed by the custom VM.
   * Not EVM — native chain primitives.
   */
  private async nativeCall(
    method: string,
    params: Record<string, unknown>,
  ): Promise<TransactionReceipt> {
    return this.rpcCall<TransactionReceipt>(`veil_${method}`, [
      { ...params, sender: this.getAddress() },
    ]);
  }

  /** Native VM query (read-only) */
  private async nativeQuery<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    return this.rpcCall<T>(`veil_${method}`, [params]);
  }
}
