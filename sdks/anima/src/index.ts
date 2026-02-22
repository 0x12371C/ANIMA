// ============================================================================
// @veil/anima
// Sovereign AI agent framework for the VEIL chain
// ============================================================================

export { AnimaAgent } from './agent.js';
export {
  ANIMA_TIER0_ACTION_TYPES,
  ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES,
} from './types.js';
export type {
  AnimaConfig,
  AnimaCapabilityMode,
  AnimaStrictPrivateCapabilityDefaults,
  AnimaStrictPrivateCapabilityOverrides,
  AnimaSignerRoleKey,
  AnimaSignerRoleMapping,
  AnimaSignerMaterial,
  AnimaSignerMaterialByRole,
  AnimaSignerRegistry,
  Brain,
  AgentContext,
  ThinkInput,
  ThinkOutput,
  AgentAction,
  AgentActionType,
  AnimaTier0ActionType,
  AnimaTier0ActionRequest,
  AnimaTier0ActionBase,
  CommitOrderAction,
  RevealBatchAction,
  SubmitBatchProofAction,
  ClearBatchAction,
  SetProofConfigAction,
  SetRevealCommitteeAction,
  AgentEvent,
  MarketSummary,
  MarketCreateParams,
  LifecycleHooks,
} from './types.js';
