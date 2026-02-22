// ============================================================================
// @veil/anima — Agent Runtime (TypeScript side)
// This is the SDK developers use to build agent brains.
// The Go runtime manages lifecycle, keys, and chain state.
// This manages intelligence, strategy, and decision-making.
// ============================================================================

import { VeilClient, type AgentState, type BloodswornTier } from '@veil/vm-sdk';
import type {
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

export class AnimaAgent {
  private client: VeilClient;
  private brain: Brain;
  private hooks: LifecycleHooks;
  private config: AnimaConfig;
  private running = false;
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
    // Verify chain connection
    const connected = await this.client.ping();
    if (!connected) throw new Error('Cannot connect to VEIL L1');

    // Get current agent state
    const context = await this.getContext();

    // Initialize brain
    await this.brain.init(context);

    // Fire birth hook if newborn
    if (context.state === 'newborn' && this.hooks.onBirth) {
      await this.hooks.onBirth(context);
    }

    // Subscribe to relevant events
    this.subscribeEvents();

    // Start think loop
    this.running = true;
    this.scheduleThink(0);

    console.log(`[ANIMA] Agent ${context.address} online | state: ${context.state} | tier: ${context.tier}`);
  }

  /** Stop the agent gracefully. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.thinkInterval) {
      clearTimeout(this.thinkInterval);
      this.thinkInterval = null;
    }
    await this.brain.shutdown();
    console.log('[ANIMA] Agent stopped');
  }

  // ==========================================================================
  // Think Loop
  // ==========================================================================

  private scheduleThink(delayMs: number): void {
    if (!this.running) return;
    this.thinkInterval = setTimeout(() => this.thinkCycle(), delayMs);
  }

  private async thinkCycle(): Promise<void> {
    if (!this.running) return;

    try {
      const context = await this.getContext();
      const markets = await this.getAvailableMarkets();
      const elapsed = Date.now() - this.lastThinkTime;

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
      this.lastThinkTime = Date.now();

      // Execute actions
      await this.executeActions(output.actions, context);

      // Auto-advance lifecycle if configured
      if (this.config.autoAdvance) {
        await this.checkLifecycleAdvance(context);
      }

      // Schedule next think
      const nextDelay = output.nextThinkMs ?? 30_000; // Default: 30s
      this.scheduleThink(nextDelay);
    } catch (error) {
      console.error('[ANIMA] Think cycle error:', error);
      // Retry after backoff
      this.scheduleThink(60_000);
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
      try {
        switch (action.type) {
          case 'trade':
            await this.client.trade(action.marketId, action.outcome, action.amount);
            console.log(`[ANIMA] Trade: ${action.outcome} on ${action.marketId} for ${action.amount}`);
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
    // Subscribe to chain events relevant to this agent
    this.client.on({ eventType: 'MarketCreated' }, async (event) => {
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
      this.eventQueue.push(agentEvent);
      await this.brain.onEvent(agentEvent);
    });

    this.client.on({ eventType: 'MarketResolved' }, async (event) => {
      const agentEvent: AgentEvent = {
        type: 'market_resolved',
        marketId: event.args['marketId'] as string,
        outcome: event.args['outcome'] as string,
      };
      this.eventQueue.push(agentEvent);
      await this.brain.onEvent(agentEvent);
    });

    this.client.on({ eventType: 'BloodswornUpdated' }, async (event) => {
      const newTier = event.args['tier'] as BloodswornTier;
      const oldTier = event.args['previousTier'] as BloodswornTier;
      if (newTier !== oldTier) {
        const agentEvent: AgentEvent = {
          type: 'tier_changed',
          from: oldTier,
          to: newTier,
        };
        this.eventQueue.push(agentEvent);
        if (this.hooks.onTierChange) {
          await this.hooks.onTierChange(oldTier, newTier, await this.getContext());
        }
      }
    });

    this.client.on({ eventType: 'StakeSlashed' }, async (event) => {
      this.eventQueue.push({
        type: 'slashed',
        amount: event.args['amount'] as bigint,
        reason: event.args['reason'] as string,
      });
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

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
    // Derive from signer
    return '0x' + '0'.repeat(40); // Placeholder
  }
}
