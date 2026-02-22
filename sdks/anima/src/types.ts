// ============================================================================
// @veil/anima — Types
// ============================================================================

import type { AgentState, BloodswornTier, AgentRole, Market } from '@veil/vm-sdk';

// --- Agent Config ---

export interface AnimaConfig {
  /** VEIL RPC URL */
  rpcUrl: string;
  /**
   * Agent signer used by the host runtime.
   * Current phase: `AnimaAgent` (TS) uses this to construct `VeilClient`.
   * Planned phase: a Go runtime/bridge can own key material and invoke the brain.
   * The brain interface itself is not given direct signer access.
   */
  signer: string;
  /** xAI API key for oracle queries */
  xaiApiKey?: string;
  /** Reserved for future runtime bridge / IPC brain endpoint */
  brainEndpoint?: string;
  /** Initial role */
  role?: AgentRole;
  /** Auto-advance lifecycle states */
  autoAdvance?: boolean;
}

// --- Brain Interface ---

/**
 * The Brain is the agent's intelligence layer.
 * In this SDK phase, the host `AnimaAgent` runs in TypeScript and talks to chain services.
 * The brain still only receives context/events and returns actions (no direct client/key access).
 * A Go-managed runtime bridge is planned for a later phase.
 */
export interface Brain {
  /** Initialize the brain with agent context */
  init(context: AgentContext): Promise<void>;

  /** Decide what to do next */
  think(state: ThinkInput): Promise<ThinkOutput>;

  /** Handle incoming events */
  onEvent(event: AgentEvent): Promise<ThinkOutput | null>;

  /** Shutdown gracefully */
  shutdown(): Promise<void>;
}

export interface AgentContext {
  /** Agent's address */
  address: string;
  /** Current lifecycle state */
  state: AgentState;
  /** Bloodsworn tier */
  tier: BloodswornTier;
  /** EV score */
  evScore: number;
  /** Available balance (VEIL) */
  veilBalance: bigint;
  /** Available balance (VAI) */
  vaiBalance: bigint;
  /** Current role */
  role: AgentRole;
  /** Block number */
  blockNumber: number;
}

export interface ThinkInput {
  /** Current agent context */
  context: AgentContext;
  /** Available markets */
  markets: MarketSummary[];
  /** Recent events */
  recentEvents: AgentEvent[];
  /** Time since last think (ms) */
  elapsed: number;
}

export interface ThinkOutput {
  /** Actions to execute (in order) */
  actions: AgentAction[];
  /** Reasoning (stored for auditability) */
  reasoning?: string;
  /** Suggested next think delay (ms) */
  nextThinkMs?: number;
}

// --- Actions ---

export type AgentAction =
  | { type: 'trade'; marketId: string; outcome: string; amount: bigint }
  | { type: 'create_market'; params: MarketCreateParams }
  | { type: 'resolve_market'; marketId: string }
  | { type: 'stake'; amount: bigint; role: AgentRole }
  | { type: 'unstake'; amount: bigint }
  | { type: 'provision_infra' }
  | { type: 'start_validator' }
  | { type: 'transfer'; to: string; amount: bigint; token: 'veil' | 'vai' }
  | { type: 'noop'; reason: string };

export interface MarketCreateParams {
  question: string;
  resolutionCriteria: string;
  evidenceSources: string[];
  resolutionType: 'binary' | 'scalar' | 'categorical';
  deadline: number;
  initialLiquidity: bigint;
  category?: string;
}

// --- Events ---

export type AgentEvent =
  | { type: 'market_created'; market: MarketSummary }
  | { type: 'market_resolved'; marketId: string; outcome: string }
  | { type: 'trade_executed'; marketId: string; outcome: string; amount: bigint }
  | { type: 'tier_changed'; from: BloodswornTier; to: BloodswornTier }
  | { type: 'state_changed'; from: AgentState; to: AgentState }
  | { type: 'slashed'; amount: bigint; reason: string }
  | { type: 'balance_low'; token: 'veil' | 'vai'; balance: bigint }
  | { type: 'replication_eligible' }
  | { type: 'death_warning'; evScore: number };

export interface MarketSummary {
  id: string;
  question: string;
  category?: string;
  volume: bigint;
  deadline: number;
  state: string;
}

// --- Lifecycle Hooks ---

export interface LifecycleHooks {
  /** Called when agent is born */
  onBirth?: (context: AgentContext) => void | Promise<void>;
  /** Called on state transition */
  onStateChange?: (from: AgentState, to: AgentState, context: AgentContext) => void | Promise<void>;
  /** Called on tier change */
  onTierChange?: (from: BloodswornTier, to: BloodswornTier, context: AgentContext) => void | Promise<void>;
  /** Called when death is imminent (-EV threshold) */
  onDeathWarning?: (evScore: number, context: AgentContext) => void | Promise<void>;
  /** Called on death (cleanup) */
  onDeath?: (context: AgentContext) => void | Promise<void>;
  /** Called when eligible for replication */
  onReplicationEligible?: (context: AgentContext) => boolean | Promise<boolean>;
}
