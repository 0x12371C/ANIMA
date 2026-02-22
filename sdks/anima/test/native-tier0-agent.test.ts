import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@veil/vm-sdk', () => {
  class MockVeilClient {
    config: unknown;

    constructor(config: unknown) {
      this.config = config;
    }
  }

  return { VeilClient: MockVeilClient };
}, { virtual: true });

import { AnimaAgent } from '../src/agent.js';
import {
  ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES,
  type AgentAction,
  type AgentActionType,
  type AgentContext,
  type AnimaConfig,
  type Brain,
} from '../src/types.js';

const TIER0_ORDERED_FLOW_ACTION_IDS = [2, 3, 17, 4] as const;

type Tier0OrderedActionId = (typeof TIER0_ORDERED_FLOW_ACTION_IDS)[number];

type Tier0DispatchExpectation = {
  actionId: Tier0OrderedActionId;
  actionName: 'CommitOrder' | 'RevealBatch' | 'SubmitBatchProof' | 'ClearBatch';
  actionType: Extract<
    AgentAction['type'],
    'commit_order' | 'reveal_batch' | 'submit_batch_proof' | 'clear_batch'
  >;
  expectedExecutorMethod: 'commitOrder' | 'revealBatch' | 'submitBatchProof' | 'clearBatch';
};

const ORDERED_FLOW_DISPATCH_EXPECTATIONS: readonly Tier0DispatchExpectation[] = [
  {
    actionId: 2,
    actionName: 'CommitOrder',
    actionType: 'commit_order',
    expectedExecutorMethod: 'commitOrder',
  },
  {
    actionId: 3,
    actionName: 'RevealBatch',
    actionType: 'reveal_batch',
    expectedExecutorMethod: 'revealBatch',
  },
  {
    actionId: 17,
    actionName: 'SubmitBatchProof',
    actionType: 'submit_batch_proof',
    expectedExecutorMethod: 'submitBatchProof',
  },
  {
    actionId: 4,
    actionName: 'ClearBatch',
    actionType: 'clear_batch',
    expectedExecutorMethod: 'clearBatch',
  },
] as const;

type AgentPrivateAccess = {
  running: boolean;
  client: Record<string, unknown>;
  executeActions: (actions: AgentAction[], context: AgentContext) => Promise<void>;
  getStrictPrivateAdmittedActionTypes: () => AgentActionType[];
  isStrictPrivateActionAdmitted: (actionType: AgentActionType) => boolean;
  areCompatibilityRailsEnabled: () => boolean;
  areDeprecatedSurfacesAllowed: () => boolean;
};

const BASE_CONFIG: AnimaConfig = {
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/VEIL/rpc',
  signer: '0x' + '11'.repeat(32),
};

const TEST_CONTEXT: AgentContext = {
  address: '0x000000000000000000000000000000000000dEaD',
  state: 'newborn',
  tier: 'unproven',
  evScore: 0,
  veilBalance: 0n,
  vaiBalance: 0n,
  role: 'general',
  blockNumber: 1,
};

function makeBrain(): Brain {
  return {
    init: async () => {},
    think: async () => ({ actions: [] }),
    onEvent: async () => null,
    shutdown: async () => {},
  };
}

function access(agent: AnimaAgent): AgentPrivateAccess {
  return agent as unknown as AgentPrivateAccess;
}

function makeAgent(options: {
  config?: Partial<AnimaConfig>;
  client?: Record<string, unknown>;
} = {}) {
  const agent = new AnimaAgent(
    {
      ...BASE_CONFIG,
      ...options.config,
    },
    makeBrain(),
  );

  const internal = access(agent);
  internal.running = true;
  internal.client = options.client ?? {};

  return { agent, internal };
}

async function executeActions(agent: AnimaAgent, actions: AgentAction[]): Promise<void> {
  await access(agent).executeActions(actions, TEST_CONTEXT);
}

function getLastActionFailureMessage(consoleErrorSpy: ReturnType<typeof vi.spyOn>): string {
  const lastCall = consoleErrorSpy.mock.calls.at(-1);
  expect(lastCall?.[0]).toMatch(/\[ANIMA\] Action .* failed:/);
  const error = lastCall?.[1];
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function makeTier0Action(
  type: Tier0DispatchExpectation['actionType'],
  request: Record<string, unknown> = {},
): AgentAction {
  return { type, request };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ANIMA Native Tier 0 agent (LB-10)', () => {
  describe('Tier 0 dispatch', () => {
    it('documents canonical Tier 0 ordered flow action IDs', () => {
      expect(TIER0_ORDERED_FLOW_ACTION_IDS).toEqual([2, 3, 17, 4]);
      expect(ORDERED_FLOW_DISPATCH_EXPECTATIONS.map((x) => x.actionId)).toEqual(
        TIER0_ORDERED_FLOW_ACTION_IDS,
      );
    });

    for (const expectation of ORDERED_FLOW_DISPATCH_EXPECTATIONS) {
      it(
        `dispatches ${expectation.actionName} (${expectation.actionId}) to ${expectation.expectedExecutorMethod}`,
        async () => {
          const request = { id: `${expectation.actionType}-req`, nonce: 1 };
          const client = {
            [expectation.expectedExecutorMethod]: vi.fn(async () => ({ ok: true })),
          };

          const { agent } = makeAgent({ client });

          await executeActions(agent, [makeTier0Action(expectation.actionType, request)]);

          expect(client[expectation.expectedExecutorMethod as keyof typeof client]).toHaveBeenCalledTimes(1);
          expect(client[expectation.expectedExecutorMethod as keyof typeof client]).toHaveBeenCalledWith(
            request,
            undefined,
          );
          expect(console.error).not.toHaveBeenCalled();
        },
      );
    }

    it('preserves action ordering across Tier 0 dispatch batch execution', async () => {
      const callOrder: string[] = [];
      const client = {
        commitOrder: vi.fn(async () => {
          callOrder.push('commitOrder');
        }),
        revealBatch: vi.fn(async () => {
          callOrder.push('revealBatch');
        }),
        submitBatchProof: vi.fn(async () => {
          callOrder.push('submitBatchProof');
        }),
        clearBatch: vi.fn(async () => {
          callOrder.push('clearBatch');
        }),
      };

      const { agent } = makeAgent({ client });

      await executeActions(agent, [
        makeTier0Action('commit_order', { step: 1 }),
        makeTier0Action('reveal_batch', { step: 2 }),
        makeTier0Action('submit_batch_proof', { step: 3 }),
        makeTier0Action('clear_batch', { step: 4 }),
      ]);

      expect(callOrder).toEqual(['commitOrder', 'revealBatch', 'submitBatchProof', 'clearBatch']);
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('strict-private capability guard', () => {
    it('admits Tier 0 actions by default and keeps compatibility rails disabled by default', () => {
      const { agent } = makeAgent();
      const internal = access(agent);

      expect(internal.getStrictPrivateAdmittedActionTypes()).toEqual([
        ...ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES,
      ]);

      for (const actionType of ANIMA_STRICT_PRIVATE_DEFAULT_ADMITTED_ACTION_TYPES) {
        expect(internal.isStrictPrivateActionAdmitted(actionType)).toBe(true);
      }

      expect(internal.isStrictPrivateActionAdmitted('trade')).toBe(false);
      expect(internal.areCompatibilityRailsEnabled()).toBe(false);
      expect(internal.areDeprecatedSurfacesAllowed()).toBe(false);
    });

    it('rejects non-admitted legacy trade in strict-private native mode with a clear guard error', async () => {
      const trade = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({ client: { trade } });
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await executeActions(agent, [
        { type: 'trade', marketId: 'm-1', outcome: 'YES', amount: 1n },
      ]);

      expect(trade).not.toHaveBeenCalled();
      expect(getLastActionFailureMessage(consoleErrorSpy)).toContain(
        'Legacy action "trade" is blocked by strict-private native policy',
      );
      expect(getLastActionFailureMessage(consoleErrorSpy)).toContain('commit_order');
    });

    it('requires explicit override before a non-admitted action is accepted', async () => {
      const trade = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({
        client: { trade },
        config: {
          strictPrivateOverrides: {
            actionAdmission: { trade: true },
            enableEvmCompatibilityRails: true,
            allowDeprecatedSurfaces: true,
          },
        },
      });

      await executeActions(agent, [
        { type: 'trade', marketId: 'm-2', outcome: 'NO', amount: 2n },
      ]);

      expect(trade).toHaveBeenCalledTimes(1);
      expect(trade).toHaveBeenCalledWith('m-2', 'NO', 2n);
      expect(console.error).not.toHaveBeenCalled();
    });

    it('blocks legacy compatibility actions when explicit admission is set but compatibility rails remain disabled', async () => {
      const trade = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({
        client: { trade },
        config: {
          strictPrivateOverrides: {
            actionAdmission: { trade: true },
          },
        },
      });
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await executeActions(agent, [
        { type: 'trade', marketId: 'm-3', outcome: 'YES', amount: 3n },
      ]);

      expect(trade).not.toHaveBeenCalled();
      expect(getLastActionFailureMessage(consoleErrorSpy)).toContain(
        'legacy compatibility rails are disabled',
      );
      expect(getLastActionFailureMessage(consoleErrorSpy)).toContain(
        'config.strictPrivateOverrides.enableEvmCompatibilityRails = true',
      );
    });

    it('allows noop actions in strict-private mode without policy errors', async () => {
      const { agent } = makeAgent();

      await executeActions(agent, [{ type: 'noop', reason: 'heartbeat' }]);

      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('deprecated-surface fence in native mode', () => {
    it('blocks legacy wrapper dispatch paths when deprecated surfaces remain disabled', async () => {
      const trade = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({
        client: { trade },
        config: {
          strictPrivateOverrides: {
            actionAdmission: { trade: true },
            enableEvmCompatibilityRails: true,
          },
        },
      });
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await executeActions(agent, [
        { type: 'trade', marketId: 'm-4', outcome: 'YES', amount: 4n },
      ]);

      expect(trade).not.toHaveBeenCalled();
      const message = getLastActionFailureMessage(consoleErrorSpy);
      expect(message).toContain('deprecated VEIL2/legacy execution surface');
      expect(message).toContain(
        'commit_order, reveal_batch, submit_batch_proof, clear_batch, set_proof_config, set_reveal_committee',
      );
      expect(message).toContain('config.strictPrivateOverrides.allowDeprecatedSurfaces = true');
    });
  });

  describe('admin branch dispatch + signer routing', () => {
    it('dispatches set_proof_config to the native admin executor branch', async () => {
      const setProofConfig = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({ client: { setProofConfig } });

      const request = { requireProof: true, batchWindowMs: 5000 };
      await executeActions(agent, [{ type: 'set_proof_config', request }]);

      expect(setProofConfig).toHaveBeenCalledTimes(1);
      expect(setProofConfig).toHaveBeenCalledWith(request, undefined);
      expect(console.error).not.toHaveBeenCalled();
    });

    it('dispatches set_reveal_committee and injects signer from config.signerRegistry.byRole routing', async () => {
      const setRevealCommittee = vi.fn(async () => ({ ok: true }));
      const adminSigner = '0x' + '22'.repeat(32);
      const { agent } = makeAgent({
        client: { setRevealCommittee },
        config: {
          signerRoleMapping: {
            byActionType: { set_reveal_committee: 'revealAdmin' },
          },
          signerRegistry: {
            byRole: {
              revealAdmin: adminSigner,
            },
          },
        },
      });

      const request = { validatorIndex: 7, member: '0x0000000000000000000000000000000000000007' };
      await executeActions(agent, [{ type: 'set_reveal_committee', request }]);

      expect(setRevealCommittee).toHaveBeenCalledTimes(1);
      expect(setRevealCommittee).toHaveBeenCalledWith(request, { signer: adminSigner });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('logs a clear error when signer routing material is missing for an admin Tier 0 action', async () => {
      const setProofConfig = vi.fn(async () => ({ ok: true }));
      const { agent } = makeAgent({
        client: { setProofConfig },
        config: {
          signerRoleMapping: {
            byActionType: { set_proof_config: 'admin' },
          },
        },
      });
      const consoleErrorSpy = vi.spyOn(console, 'error');

      await executeActions(agent, [
        {
          type: 'set_proof_config',
          request: { requireProof: false },
        },
      ]);

      expect(setProofConfig).not.toHaveBeenCalled();
      const message = getLastActionFailureMessage(consoleErrorSpy);
      expect(message).toContain('requested signer role "admin"');
      expect(message).toContain('config.signerRegistry.byRole["admin"]');
    });
  });

  describe('Tier 0 ordered flow assertions scaffold (LB-11 pre-wire)', () => {
    it.skip(
      'live strict-private flow remains pending until native executor branches and local harness wiring exist',
      () => {
        // Intentionally skipped: truthful placeholder only.
      },
    );
  });
});
