// ============================================================================
// @veil/anima — Types
// ============================================================================

import type { AgentState, BloodswornTier, AgentRole, Market, Signer } from '@veil/vm-sdk';

// --- Native Runtime Capability / Routing (Type Scaffolding) ---

export const ANIMA_TIER0_ACTION_TYPES = [
  'commit_order',
  'reveal_batch',
  'submit_batch_proof',
  'clear_batch',
  'set_proof_config',
  'set_reveal_committee',
] as const;

/** Strict-private runtime defaults currently admit Tier 0 only. */
export const ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES = ANIMA_TIER0_ACTION_TYPES;

export type AnimaTier0ActionType = (typeof ANIMA_TIER0_ACTION_TYPES)[number];

/**
 * Runtime capability posture for ANIMA Native execution.
 * `strict-private` is the default launch posture; compatibility modes are explicit.
 */
export type AnimaCapabilityMode =
  | 'strict-private'
  | 'compatibility';

/**
 * Logical signer-role key resolved by the host/runtime.
 * Kept string-based to remain compatible with future signer registries.
 */
export type AnimaSignerRoleKey = string;

/**
 * Concrete signer material owned by the host/runtime for routed calls.
 * Can be a raw private key string or a VM SDK-compatible signer instance.
 */
export type AnimaSignerMaterial = string | Signer;

/** Role-keyed signer material entries used by runtime call routing. */
export type AnimaSignerMaterialByRole =
  Partial<Record<AnimaSignerRoleKey, AnimaSignerMaterial>>;

/**
 * Concrete signer registry decoupled from `signerRoleMapping` routing hints.
 * This remains host/runtime-owned and can later be bridged to non-TS runtimes.
 */
export interface AnimaSignerRegistry {
  /** Signer material by logical role key for per-call signer override dispatch. */
  byRole?: AnimaSignerMaterialByRole;
}

export interface AnimaStrictPrivateCapabilityDefaults {
  /**
   * Default admitted actions in strict-private mode.
   * If unset, use `ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES`.
   */
  admittedActionTypes?: readonly AgentActionType[];
  /**
   * Compatibility rails are disabled by default under VM-first native mode.
   * This field is config-only in LB-04 (no runtime enforcement yet).
   */
  enableEvmCompatibilityRails?: boolean;
  /**
   * Deprecated VEIL2/legacy wrapper execution surfaces should remain disabled.
   * This field is config-only in LB-04 (no runtime enforcement yet).
   */
  allowDeprecatedSurfaces?: boolean;
}

export interface AnimaStrictPrivateCapabilityOverrides {
  /**
   * Per-action admission overrides layered on top of strict-private defaults.
   * `true` explicitly admits, `false` explicitly denies.
   */
  actionAdmission?: Partial<Record<AgentActionType, boolean>>;
  /**
   * Explicit compatibility-rail override for non-default environments.
   * This field is config-only in LB-04 (no runtime enforcement yet).
   */
  enableEvmCompatibilityRails?: boolean;
  /**
   * Explicit deprecated-surface override for non-default environments.
   * This field is config-only in LB-04 (no runtime enforcement yet).
   */
  allowDeprecatedSurfaces?: boolean;
}

export interface AnimaSignerRoleMapping {
  /** Fallback signer role when no action-specific route is configured. */
  defaultRole?: AnimaSignerRoleKey;
  /**
   * Per-action signer-role routing hints used by later executor branches.
   * This is intentionally decoupled from concrete key material ownership.
   */
  byActionType?: Partial<Record<AgentActionType, AnimaSignerRoleKey>>;
}

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
  /**
   * Runtime capability posture for native execution.
   * Strict-private Tier 0 admission should remain the default posture.
   */
  capabilityMode?: AnimaCapabilityMode;
  /** Optional strict-private default policy configuration (type/config only in LB-04). */
  strictPrivateDefaults?: AnimaStrictPrivateCapabilityDefaults;
  /** Optional strict-private explicit overrides (type/config only in LB-04). */
  strictPrivateOverrides?: AnimaStrictPrivateCapabilityOverrides;
  /** Optional signer-role routing map for future per-action signer override dispatch. */
  signerRoleMapping?: AnimaSignerRoleMapping;
  /** Optional concrete signer registry for role-based per-call signer override routing. */
  signerRegistry?: AnimaSignerRegistry;
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

/** Opaque Tier 0 request payload until VM SDK Tier 0 request types are wired through. */
export type AnimaTier0ActionRequest = Record<string, unknown>;

export interface AnimaTier0ActionBase {
  /**
   * Optional signer-role routing hint for per-call signer override selection.
   * Actual routing behavior is implemented in later executor tasks.
   */
  signerRole?: AnimaSignerRoleKey;
}

export interface CommitOrderAction extends AnimaTier0ActionBase {
  type: 'commit_order';
  request: AnimaTier0ActionRequest;
}

export interface RevealBatchAction extends AnimaTier0ActionBase {
  type: 'reveal_batch';
  request: AnimaTier0ActionRequest;
}

export interface SubmitBatchProofAction extends AnimaTier0ActionBase {
  type: 'submit_batch_proof';
  request: AnimaTier0ActionRequest;
}

export interface ClearBatchAction extends AnimaTier0ActionBase {
  type: 'clear_batch';
  request: AnimaTier0ActionRequest;
}

export interface SetProofConfigAction extends AnimaTier0ActionBase {
  type: 'set_proof_config';
  request: AnimaTier0ActionRequest;
}

export interface SetRevealCommitteeAction extends AnimaTier0ActionBase {
  type: 'set_reveal_committee';
  request: AnimaTier0ActionRequest;
}

export type AgentAction =
  | { type: 'trade'; marketId: string; outcome: string; amount: bigint }
  | { type: 'create_market'; params: MarketCreateParams }
  | { type: 'resolve_market'; marketId: string }
  | { type: 'stake'; amount: bigint; role: AgentRole }
  | { type: 'unstake'; amount: bigint }
  | { type: 'provision_infra' }
  | { type: 'start_validator' }
  | { type: 'transfer'; to: string; amount: bigint; token: 'veil' | 'vai' }
  | CommitOrderAction
  | RevealBatchAction
  | SubmitBatchProofAction
  | ClearBatchAction
  | SetProofConfigAction
  | SetRevealCommitteeAction
  | { type: 'noop'; reason: string };

export type AgentActionType = AgentAction['type'];

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
