// ============================================================================
// @veil/vm-sdk — VEIL VM Client
// The primary interface for interacting with the VEIL chain
// ============================================================================

import type {
  VeilChainConfig,
  TransactionReceipt,
  Identity,
  ZeroIdProof,
  Signer,
  CommitOrderRequest,
  RevealBatchRequest,
  SubmitBatchProofRequest,
  ClearBatchRequest,
  SetProofConfigRequest,
  SetRevealCommitteeRequest,
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
import { computeAddress, getAddress } from 'ethers';
import { XaiOracle } from './oracle.js';

const VEIL_CHAIN_ID = 22207;
const DEFAULT_EVENT_POLL_INTERVAL_MS = 2_000;

interface EventSubscriptionState {
  filter: VeilEventFilter;
  callbacks: VeilEventCallback[];
  nextFromBlock?: number;
}

interface NativeWriteOptions {
  /** Explicit sender override for the current RPC call only. */
  sender?: string;
  /** Per-call signer override used only to derive sender (no client mutation). */
  signer?: string | Signer;
}

export class VeilClient {
  private rpcUrl: string;
  private chainId: number;
  private signerAddress?: string;
  private oracle: XaiOracle | null;
  private eventListeners: Map<string, EventSubscriptionState> = new Map();
  private eventPollTimer?: ReturnType<typeof setInterval>;
  private eventPollingInFlight = false;

  constructor(config: VeilChainConfig) {
    this.rpcUrl = config.rpcUrl;
    this.chainId = config.chainId ?? VEIL_CHAIN_ID;
    this.signerAddress = this.resolveSignerAddress(config.signer);
    this.oracle = config.xaiApiKey
      ? new XaiOracle(config.xaiApiKey, config.xaiEndpoint)
      : null;
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  /** Get current block number */
  async getBlockNumber(): Promise<number> {
    const blockNumber = await this.rpcCall<string>('eth_blockNumber');
    return this.parseQuantity(blockNumber, 'eth_blockNumber');
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
  // Native Tier 0 (strict-private orderflow + operator controls)
  // ==========================================================================

  /** Submit a strict-private order commitment (Tier 0 action ID 2). */
  async commitOrder(
    request: CommitOrderRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall(
      'commit_order',
      {
        marketId: request.marketId,
        windowId: request.windowId.toString(),
        envelope: Buffer.from(request.envelope).toString('hex'),
        commitment: Buffer.from(request.commitment).toString('hex'),
      },
      options,
    );
  }

  /** Submit a validator reveal share for a batch (Tier 0 action ID 3). */
  async revealBatch(
    request: RevealBatchRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall(
      'reveal_batch',
      {
        marketId: request.marketId,
        windowId: request.windowId.toString(),
        envelopeEpoch: request.envelopeEpoch.toString(),
        envelopeCommitteeKeyId: Buffer.from(request.envelopeCommitteeKeyId).toString('hex'),
        decryptionShare: Buffer.from(request.decryptionShare).toString('hex'),
        validatorIndex: request.validatorIndex,
      },
      options,
    );
  }

  /** Submit a batch proof artifact (Tier 0 action ID 17). */
  async submitBatchProof(
    request: SubmitBatchProofRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall(
      'submit_batch_proof',
      {
        marketId: request.marketId,
        windowId: request.windowId.toString(),
        windowCloseAtMs: request.windowCloseAtMs,
        proofType: request.proofType,
        publicInputsHash: Buffer.from(request.publicInputsHash).toString('hex'),
        fillsHash: Buffer.from(request.fillsHash).toString('hex'),
        proof: Buffer.from(request.proof).toString('hex'),
      },
      options,
    );
  }

  /** Finalize a batch clearing result (Tier 0 action ID 4). */
  async clearBatch(
    request: ClearBatchRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall(
      'clear_batch',
      {
        marketId: request.marketId,
        windowId: request.windowId.toString(),
        clearPrice: request.clearPrice.toString(),
        totalVolume: request.totalVolume.toString(),
        fillsHash: Buffer.from(request.fillsHash).toString('hex'),
      },
      options,
    );
  }

  /** Update proof requirements for batch settlement (Tier 0 action ID 18). */
  async setProofConfig(
    request: SetProofConfigRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall('set_proof_config', { ...request }, options);
  }

  /** Update reveal committee membership (Tier 0 action ID 41). */
  async setRevealCommittee(
    request: SetRevealCommitteeRequest,
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.nativeCall('set_reveal_committee', { ...request }, options);
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
    const existing = this.eventListeners.get(key);
    if (existing) {
      existing.callbacks.push(callback);
    } else {
      this.eventListeners.set(key, {
        filter: { ...filter },
        callbacks: [callback],
      });
    }

    this.ensureEventPolling();

    // Return unsubscribe function
    return () => {
      const subscription = this.eventListeners.get(key);
      if (!subscription) return;

      const idx = subscription.callbacks.indexOf(callback);
      if (idx >= 0) subscription.callbacks.splice(idx, 1);

      if (subscription.callbacks.length === 0) {
        this.eventListeners.delete(key);
      }

      if (this.eventListeners.size === 0) {
        this.stopEventPolling();
      }
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

  /** Get the configured sender address (throws if no signer is configured). */
  getConfiguredAddress(): string {
    return this.getAddress();
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private getAddress(): string {
    if (!this.signerAddress) {
      throw new Error(
        'No signer configured. Read methods work without a signer, but write methods require config.signer (private key string or signer object with address).',
      );
    }
    return this.signerAddress;
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
    options?: NativeWriteOptions,
  ): Promise<TransactionReceipt> {
    return this.rpcCall<TransactionReceipt>(`veil_${method}`, [
      { ...params, sender: this.getSenderAddress(options) },
    ]);
  }

  /** Native VM query (read-only) */
  private async nativeQuery<T>(
    method: string,
    params: object,
  ): Promise<T> {
    return this.rpcCall<T>(`veil_${method}`, [params]);
  }

  private resolveSignerAddress(signer?: string | Signer): string | undefined {
    if (!signer) return undefined;
    if (typeof signer === 'string') {
      return this.deriveAddressFromPrivateKey(signer);
    }
    return this.normalizeAddress(signer.address, 'config.signer.address');
  }

  private getSenderAddress(options?: NativeWriteOptions): string {
    if (options?.sender) {
      return this.normalizeAddress(options.sender, 'call options.sender');
    }
    if (options?.signer) {
      const sender = this.resolveSignerAddress(options.signer);
      if (sender) return sender;
    }
    return this.getAddress();
  }

  private deriveAddressFromPrivateKey(privateKey: string): string {
    try {
      return computeAddress(privateKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid signer private key: ${message}`);
    }
  }

  private normalizeAddress(address: string, source: string): string {
    try {
      return getAddress(address);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid address in ${source}: ${message}`);
    }
  }

  private parseQuantity(value: string, method: string): number {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${method} returned invalid quantity`);
    }

    const parsed = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`${method} returned out-of-range quantity: ${value}`);
    }

    return parsed;
  }

  private ensureEventPolling(): void {
    if (this.eventPollTimer || this.eventListeners.size === 0) return;

    // TODO: Prefer server push / websocket subscriptions if the VM exposes them.
    this.eventPollTimer = setInterval(() => {
      void this.pollEventSubscriptions();
    }, DEFAULT_EVENT_POLL_INTERVAL_MS);

    void this.pollEventSubscriptions();
  }

  private stopEventPolling(): void {
    if (!this.eventPollTimer) return;
    clearInterval(this.eventPollTimer);
    this.eventPollTimer = undefined;
  }

  private async pollEventSubscriptions(): Promise<void> {
    if (this.eventPollingInFlight || this.eventListeners.size === 0) return;
    this.eventPollingInFlight = true;

    try {
      const latestBlock = await this.getBlockNumber();
      for (const subscription of this.eventListeners.values()) {
        await this.pollEventSubscription(subscription, latestBlock);
      }
    } catch {
      // Keep polling alive on transient RPC errors.
    } finally {
      this.eventPollingInFlight = false;
      if (this.eventListeners.size === 0) {
        this.stopEventPolling();
      }
    }
  }

  private async pollEventSubscription(
    subscription: EventSubscriptionState,
    latestBlock: number,
  ): Promise<void> {
    const baseFromBlock = subscription.filter.fromBlock ?? latestBlock + 1;
    const fromBlock = subscription.nextFromBlock ?? baseFromBlock;

    const requestedToBlock = subscription.filter.toBlock;
    const toBlock = requestedToBlock === undefined
      ? latestBlock
      : Math.min(requestedToBlock, latestBlock);

    if (fromBlock > toBlock) {
      subscription.nextFromBlock = fromBlock;
      return;
    }

    const events = await this.getEvents({
      ...subscription.filter,
      fromBlock,
      toBlock,
    });

    if (events.length === 0) {
      subscription.nextFromBlock = toBlock + 1;
      return;
    }

    let maxSeenBlock = fromBlock;
    for (const event of events) {
      if (event.blockNumber > maxSeenBlock) {
        maxSeenBlock = event.blockNumber;
      }

      for (const callback of [...subscription.callbacks]) {
        try {
          await callback(event);
        } catch {
          // Listener exceptions should not stop the polling loop.
        }
      }
    }

    subscription.nextFromBlock = maxSeenBlock + 1;
  }
}
