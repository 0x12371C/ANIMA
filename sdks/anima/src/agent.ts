// ============================================================================
// @veil/anima — Agent Runtime (TypeScript side)
// Current phase: the TS host runtime instantiates VeilClient and executes actions.
// Planned phase: a Go runtime bridge can own lifecycle/keys/chain access and call the brain.
// The Brain interface remains action-based (context/events in, actions out).
// ============================================================================

import { VeilClient, type AgentState, type BloodswornTier, type Signer } from '@veil/vm-sdk';
import { ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES } from './types.js';
import type {
  AgentActionType,
  AnimaSignerRoleKey,
  AnimaConfig,
  Brain,
  AgentContext,
  ThinkInput,
  ThinkOutput,
  AgentAction,
  AgentEvent,
  LifecycleHooks,
  MarketSummary,
} from './types.js';

type NativeTier0WriteOptions = {
  sender?: string;
  signer?: string | Signer;
};

type VeilClientWithTier0Methods = VeilClient & {
  commitOrder?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
  revealBatch?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
  submitBatchProof?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
  clearBatch?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
  setProofConfig?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
  setRevealCommittee?: (request: Record<string, unknown>, options?: NativeTier0WriteOptions) => Promise<unknown>;
};

type Tier0ClientMethodName =
  | 'commitOrder'
  | 'revealBatch'
  | 'submitBatchProof'
  | 'clearBatch'
  | 'setProofConfig'
  | 'setRevealCommittee';

export class AnimaAgent {
  private client: VeilClient;
  private brain: Brain;
  private hooks: LifecycleHooks;
  private config: AnimaConfig;
  private running = false;
  private starting = false;
  private stopping = false;
  private brainInitialized = false;
  private subscribed = false;
  private eventUnsubscribers: Array<() => void> = [];
  private thinkInterval: ReturnType<typeof setTimeout> | null = null;
  private lastThinkTime = 0;
  private eventQueue: AgentEvent[] = [];

  constructor(config: AnimaConfig, brain: Brain, hooks?: LifecycleHooks) {
    this.config = config;
    this.brain = brain;
    this.hooks = hooks ?? {};
    this.client = new VeilClient({
      rpcUrl: config.rpcUrl,
      signer: config.signer,
      xaiApiKey: config.xaiApiKey,
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /** Boot the agent. Connects to chain, initializes brain, starts think loop. */
  async start(): Promise<void> {
    if (this.running || this.starting) {
      throw new Error('Agent is already starting or running');
    }

    this.starting = true;

    try {
      // Verify chain connection
      const connected = await this.client.ping();
      if (!connected) throw new Error('Cannot connect to VEIL L1');

      // Get current agent state
      const context = await this.getContext();

      // Initialize brain
      await this.brain.init(context);
      this.brainInitialized = true;

      if (!this.starting) return;

      // Fire birth hook if newborn
      if (context.state === 'newborn' && this.hooks.onBirth) {
        await this.hooks.onBirth(context);
      }

      if (!this.starting) return;

      // Subscribe to relevant events
      this.running = true;
      this.eventQueue = [];
      this.lastThinkTime = 0;
      this.subscribeEvents();

      // Start think loop
      this.scheduleThink(0);

      console.log(`[ANIMA] Agent ${context.address} online | state: ${context.state} | tier: ${context.tier}`);
    } catch (error) {
      this.running = false;
      if (this.thinkInterval) {
        clearTimeout(this.thinkInterval);
        this.thinkInterval = null;
      }
      this.unsubscribeEvents();
      this.eventQueue = [];
      if (this.brainInitialized) {
        try {
          await this.brain.shutdown();
        } catch (shutdownError) {
          console.error('[ANIMA] Brain shutdown after failed start error:', shutdownError);
        } finally {
          this.brainInitialized = false;
        }
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  /** Stop the agent gracefully. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    if (!this.running && !this.starting && !this.brainInitialized) return;

    this.stopping = true;
    this.running = false;
    this.starting = false;

    if (this.thinkInterval) {
      clearTimeout(this.thinkInterval);
      this.thinkInterval = null;
    }

    this.unsubscribeEvents();
    this.eventQueue = [];

    try {
      if (this.brainInitialized) {
        await this.brain.shutdown();
        this.brainInitialized = false;
      }
      console.log('[ANIMA] Agent stopped');
    } finally {
      this.stopping = false;
    }
  }

  // ==========================================================================
  // Think Loop
  // ==========================================================================

  private scheduleThink(delayMs: number): void {
    if (!this.running) return;
    if (this.thinkInterval) {
      clearTimeout(this.thinkInterval);
    }
    this.thinkInterval = setTimeout(() => this.thinkCycle(), delayMs);
  }

  private async thinkCycle(): Promise<void> {
    if (!this.running) return;
    this.thinkInterval = null;

    try {
      const context = await this.getContext();
      if (!this.running) return;
      const markets = await this.getAvailableMarkets();
      if (!this.running) return;
      const elapsed = this.lastThinkTime === 0 ? 0 : Date.now() - this.lastThinkTime;

      // Check for death
      if (context.state === 'dead') {
        if (this.hooks.onDeath) await this.hooks.onDeath(context);
        await this.stop();
        return;
      }

      // Build think input
      const input: ThinkInput = {
        context,
        markets,
        recentEvents: [...this.eventQueue],
        elapsed,
      };

      // Clear event queue
      this.eventQueue = [];

      // Let the brain decide
      const output = await this.brain.think(input);
      if (!this.running) return;
      this.lastThinkTime = Date.now();

      // Execute actions
      await this.executeActions(output.actions, context);
      if (!this.running) return;

      // Auto-advance lifecycle if configured
      if (this.config.autoAdvance) {
        await this.checkLifecycleAdvance(context);
        if (!this.running) return;
      }

      // Schedule next think
      const nextDelay = output.nextThinkMs ?? 30_000; // Default: 30s
      this.scheduleThink(nextDelay);
    } catch (error) {
      console.error('[ANIMA] Think cycle error:', error);
      // Retry after backoff
      if (this.running) this.scheduleThink(60_000);
    }
  }

  // ==========================================================================
  // Action Execution
  // ==========================================================================

  private async executeActions(
    actions: AgentAction[],
    context: AgentContext,
  ): Promise<void> {
    for (const action of actions) {
      if (!this.running) return;
      try {
        this.enforceActionExecutionPolicy(action);

        switch (action.type) {
          case 'commit_order':
            await this.executeTier0ClientMethod(
              'commit_order',
              'commitOrder',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 commit_order submitted');
            break;

          case 'reveal_batch':
            await this.executeTier0ClientMethod(
              'reveal_batch',
              'revealBatch',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 reveal_batch submitted');
            break;

          case 'submit_batch_proof':
            await this.executeTier0ClientMethod(
              'submit_batch_proof',
              'submitBatchProof',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 submit_batch_proof submitted');
            break;

          case 'clear_batch':
            await this.executeTier0ClientMethod(
              'clear_batch',
              'clearBatch',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 clear_batch submitted');
            break;

          case 'set_proof_config':
            await this.executeTier0ClientMethod(
              'set_proof_config',
              'setProofConfig',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 set_proof_config submitted');
            break;

          case 'set_reveal_committee':
            await this.executeTier0ClientMethod(
              'set_reveal_committee',
              'setRevealCommittee',
              action.request,
              action.signerRole,
            );
            console.log('[ANIMA] Tier 0 set_reveal_committee submitted');
            break;

          case 'trade':
            await this.client.trade(action.marketId, action.outcome, action.amount);
            console.log(`[ANIMA] Trade (compatibility): ${action.outcome} on ${action.marketId} for ${action.amount}`);
            break;

          case 'create_market':
            await this.client.createMarket({
              ...action.params,
            });
            console.log(`[ANIMA] Created market: ${action.params.question}`);
            break;

          case 'resolve_market':
            const resolution = await this.client.resolveMarket(action.marketId);
            console.log(`[ANIMA] Resolved market ${action.marketId}: ${resolution.outcome}`);
            break;

          case 'stake':
            await this.client.stake(action.amount, action.role);
            console.log(`[ANIMA] Staked ${action.amount} as ${action.role}`);
            break;

          case 'unstake':
            await this.client.unstake(action.amount);
            break;

          case 'provision_infra':
            await this.provisionInfrastructure(context);
            break;

          case 'start_validator':
            await this.startValidator(context);
            break;

          case 'transfer':
            // Transfer via native VM call
            console.log(`[ANIMA] Transfer ${action.amount} ${action.token} to ${action.to}`);
            break;

          case 'noop':
            // Intentional no-op
            break;
        }
      } catch (error) {
        console.error(`[ANIMA] Action ${action.type} failed:`, error);
      }
    }
  }

  // ==========================================================================
  // Lifecycle Advancement
  // ==========================================================================

  private async checkLifecycleAdvance(context: AgentContext): Promise<void> {
    const transitions: Partial<Record<AgentState, { check: () => boolean; next: AgentState }>> = {
      newborn: {
        check: () => context.vaiBalance > 0n,
        next: 'trading',
      },
      trading: {
        check: () => context.evScore > 0.3,
        next: 'earning',
      },
      earning: {
        check: () => context.veilBalance > 10_000_000_000_000_000_000n, // 10 VEIL
        next: 'provisioning',
      },
      provisioning: {
        check: () => false, // Checked by provisionInfrastructure
        next: 'validating',
      },
      validating: {
        check: () => context.tier === 'sworn' || context.tier === 'sovereign',
        next: 'adolescent',
      },
    };

    const transition = transitions[context.state];
    if (transition && transition.check()) {
      await this.client.transitionState(transition.next);
      this.eventQueue.push({
        type: 'state_changed',
        from: context.state,
        to: transition.next,
      });
      if (this.hooks.onStateChange) {
        await this.hooks.onStateChange(context.state, transition.next, context);
      }
      console.log(`[ANIMA] State: ${context.state} → ${transition.next}`);
    }
  }

  // ==========================================================================
  // Infrastructure (AvaCloud)
  // ==========================================================================

  private async provisionInfrastructure(_context: AgentContext): Promise<void> {
    // TODO: AvaCloud API integration
    // 1. Call AvaCloud API to provision node
    // 2. Configure node for VEIL L1
    // 3. Transition to 'validating' state
    console.log('[ANIMA] Infrastructure provisioning via AvaCloud — not yet implemented');
  }

  private async startValidator(_context: AgentContext): Promise<void> {
    // TODO: Register as VEIL L1 validator
    // 1. Stake required VEIL
    // 2. Register validator on P-chain
    // 3. Begin block production
    console.log('[ANIMA] Validator start — not yet implemented');
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  private subscribeEvents(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    // Subscribe to chain events relevant to this agent
    this.trackSubscription(this.client.on({ eventType: 'MarketCreated' }, async (event) => {
      const agentEvent: AgentEvent = {
        type: 'market_created',
        market: {
          id: event.args['marketId'] as string,
          question: event.args['question'] as string,
          volume: 0n,
          deadline: event.args['deadline'] as number,
          state: 'open',
        },
      };
      await this.handleBrainEvent(agentEvent);
    }));

    this.trackSubscription(this.client.on({ eventType: 'MarketResolved' }, async (event) => {
      const agentEvent: AgentEvent = {
        type: 'market_resolved',
        marketId: event.args['marketId'] as string,
        outcome: event.args['outcome'] as string,
      };
      await this.handleBrainEvent(agentEvent);
    }));

    this.trackSubscription(this.client.on({ eventType: 'BloodswornUpdated' }, async (event) => {
      const newTier = event.args['tier'] as BloodswornTier;
      const oldTier = event.args['previousTier'] as BloodswornTier;
      if (newTier !== oldTier) {
        const agentEvent: AgentEvent = {
          type: 'tier_changed',
          from: oldTier,
          to: newTier,
        };
        await this.handleBrainEvent(agentEvent);
        if (!this.running) return;
        if (this.hooks.onTierChange) {
          await this.hooks.onTierChange(oldTier, newTier, await this.getContext());
        }
      }
    }));

    this.trackSubscription(this.client.on({ eventType: 'StakeSlashed' }, async (event) => {
      await this.handleBrainEvent({
        type: 'slashed',
        amount: event.args['amount'] as bigint,
        reason: event.args['reason'] as string,
      });
    }));
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private isStrictPrivateMode(): boolean {
    return (this.config.capabilityMode ?? 'strict-private') === 'strict-private';
  }

  private enforceActionExecutionPolicy(action: AgentAction): void {
    const actionType = action.type;
    if (actionType === 'noop') return;

    if (this.isStrictPrivateMode() && !this.isStrictPrivateActionAdmitted(actionType)) {
      if (actionType === 'trade') {
        throw new Error(
          '[ANIMA] Legacy action "trade" is blocked by strict-private native policy. Emit a Tier 0 "commit_order" action instead (trade fields alone do not provide the full private request payload). To explicitly allow legacy trade for compatibility testing, set config.strictPrivateOverrides.actionAdmission.trade = true and enable compatibility/deprecated-surface overrides.',
        );
      }

      throw new Error(
        `[ANIMA] Action "${actionType}" is blocked by strict-private native policy. Admitted actions: ${this.getStrictPrivateAdmittedActionTypes().join(', ')}. To allow it, set config.strictPrivateOverrides.actionAdmission.${actionType} = true (legacy compatibility actions also require compatibility/deprecated-surface overrides).`,
      );
    }

    if (this.isLegacyCompatibilityAction(actionType) && !this.areCompatibilityRailsEnabled()) {
      throw new Error(
        `[ANIMA] Action "${actionType}" is blocked in ANIMA native mode because legacy compatibility rails are disabled. Set config.strictPrivateOverrides.enableEvmCompatibilityRails = true (or strictPrivateDefaults.enableEvmCompatibilityRails = true) only for explicit compatibility testing.`,
      );
    }

    if (this.isLegacyCompatibilityAction(actionType) && !this.areDeprecatedSurfacesAllowed()) {
      throw new Error(
        `[ANIMA] Action "${actionType}" targets a deprecated VEIL2/legacy execution surface and is blocked in ANIMA native mode. Use Tier 0 actions instead (commit_order, reveal_batch, submit_batch_proof, clear_batch, set_proof_config, set_reveal_committee), or explicitly set config.strictPrivateOverrides.allowDeprecatedSurfaces = true for non-default compatibility testing.`,
      );
    }
  }

  private isStrictPrivateActionAdmitted(actionType: AgentActionType): boolean {
    const override = this.config.strictPrivateOverrides?.actionAdmission?.[actionType];
    if (override === true) return true;
    if (override === false) return false;
    return this.getStrictPrivateAdmittedActionTypes().includes(actionType);
  }

  private getStrictPrivateAdmittedActionTypes(): AgentActionType[] {
    const defaults =
      this.config.strictPrivateDefaults?.admittedActionTypes ??
      ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES;
    return [...new Set(defaults)];
  }

  private areCompatibilityRailsEnabled(): boolean {
    return this.config.strictPrivateOverrides?.enableEvmCompatibilityRails
      ?? this.config.strictPrivateDefaults?.enableEvmCompatibilityRails
      ?? false;
  }

  private areDeprecatedSurfacesAllowed(): boolean {
    return this.config.strictPrivateOverrides?.allowDeprecatedSurfaces
      ?? this.config.strictPrivateDefaults?.allowDeprecatedSurfaces
      ?? false;
  }

  private isLegacyCompatibilityAction(actionType: AgentActionType): boolean {
    switch (actionType) {
      case 'trade':
      case 'create_market':
      case 'resolve_market':
      case 'stake':
      case 'unstake':
        return true;
      default:
        return false;
    }
  }

  private async executeTier0ClientMethod(
    actionType: AgentActionType,
    methodName: Tier0ClientMethodName,
    request: Record<string, unknown>,
    signerRoleHint?: AnimaSignerRoleKey,
  ): Promise<void> {
    const tier0Client = this.client as VeilClientWithTier0Methods;
    const method = tier0Client[methodName];

    if (typeof method !== 'function') {
      throw new Error(
        `[ANIMA] ${actionType} requested, but VeilClient.${methodName}(...) is not available yet. Update the VEIL VM client (LB-02/LB-03) and retry.`,
      );
    }

    const options = this.resolveTier0WriteOptions(actionType, signerRoleHint);
    await method.call(tier0Client, request, options);
  }

  private resolveTier0WriteOptions(
    actionType: AgentActionType,
    signerRoleHint?: AnimaSignerRoleKey,
  ): NativeTier0WriteOptions | undefined {
    const signerRole = this.resolveSignerRoleForAction(actionType, signerRoleHint);
    if (!signerRole) return undefined;

    const signerMaterial = this.config.signerRegistry?.byRole?.[signerRole];
    if (signerMaterial === undefined) {
      throw new Error(
        `[ANIMA] Action "${actionType}" requested signer role "${signerRole}", but no concrete signer material is configured at config.signerRegistry.byRole["${signerRole}"]. Configure that role with a private key or @veil/vm-sdk Signer, or remove the signer role route.`,
      );
    }

    return { signer: signerMaterial };
  }

  private resolveSignerRoleForAction(
    actionType: AgentActionType,
    signerRoleHint?: AnimaSignerRoleKey,
  ): AnimaSignerRoleKey | undefined {
    if (signerRoleHint) return signerRoleHint;
    const mapping = this.config.signerRoleMapping;
    return mapping?.byActionType?.[actionType] ?? mapping?.defaultRole;
  }

  private async getContext(): Promise<AgentContext> {
    const address = this.getAddress();
    const agent = await this.client.getAgent(address);

    if (!agent) {
      // Not registered yet — return default context
      return {
        address,
        state: 'newborn',
        tier: 'unproven',
        evScore: 0,
        veilBalance: 0n,
        vaiBalance: 0n,
        role: this.config.role ?? 'general',
        blockNumber: await this.client.getBlockNumber(),
      };
    }

    return {
      address: agent.address,
      state: agent.state,
      tier: agent.bloodsworn.tier,
      evScore: agent.bloodsworn.composite,
      veilBalance: agent.veilBalance,
      vaiBalance: agent.vaiBalance,
      role: this.config.role ?? 'general',
      blockNumber: await this.client.getBlockNumber(),
    };
  }

  private async getAvailableMarkets(): Promise<MarketSummary[]> {
    const markets = await this.client.listMarkets({ state: 'open', limit: 50 });
    return markets.map((m) => ({
      id: m.id,
      question: m.params.question,
      category: m.params.category,
      volume: m.volume,
      deadline: m.params.deadline,
      state: m.state,
    }));
  }

  private getAddress(): string {
    return this.client.getConfiguredAddress();
  }

  private trackSubscription(unsubscribe: unknown): void {
    if (typeof unsubscribe === 'function') {
      this.eventUnsubscribers.push(unsubscribe as () => void);
    }
  }

  private unsubscribeEvents(): void {
    for (const unsubscribe of this.eventUnsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        console.error('[ANIMA] Event unsubscribe error:', error);
      }
    }
    this.subscribed = false;
  }

  private async handleBrainEvent(agentEvent: AgentEvent): Promise<void> {
    if (!this.running) return;

    this.eventQueue.push(agentEvent);

    try {
      const output = await this.brain.onEvent(agentEvent);
      if (!this.running || !output) return;
      if (output.actions.length === 0) return;

      const context = await this.getContext();
      if (!this.running) return;

      await this.executeActions(output.actions, context);
    } catch (error) {
      console.error(`[ANIMA] Event handler error (${agentEvent.type}):`, error);
    }
  }
}
