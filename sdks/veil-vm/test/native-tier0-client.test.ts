import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VeilClient } from '../src/client.js';
import type {
  ClearBatchRequest,
  CommitOrderRequest,
  RevealBatchRequest,
  SetProofConfigRequest,
  SetRevealCommitteeRequest,
  Signer,
  SubmitBatchProofRequest,
  TransactionReceipt,
} from '../src/types.js';

const RPC_URL = 'http://127.0.0.1:9650/ext/bc/VEIL/rpc';
const ORIGINAL_FETCH = globalThis.fetch;

const CONFIG_SIGNER: Signer = {
  address: '0x000000000000000000000000000000000000dEaD',
  signMessage: async () => '0x',
  signTransaction: async () => '0x',
};

const OVERRIDE_SIGNER: Signer = {
  address: '0x0000000000000000000000000000000000001234',
  signMessage: async () => '0x',
  signTransaction: async () => '0x',
};

const MOCK_RECEIPT: TransactionReceipt = {
  hash: '0xabc',
  blockNumber: 123,
  blockHash: '0xdef',
  status: 'success',
  gasUsed: 21_000n,
  events: [],
};

const TIER0_METHOD_CASES = [
  { sdkMethod: 'commitOrder', rpcMethod: 'veil_commit_order' },
  { sdkMethod: 'revealBatch', rpcMethod: 'veil_reveal_batch' },
  { sdkMethod: 'submitBatchProof', rpcMethod: 'veil_submit_batch_proof' },
  { sdkMethod: 'clearBatch', rpcMethod: 'veil_clear_batch' },
  { sdkMethod: 'setProofConfig', rpcMethod: 'veil_set_proof_config' },
  { sdkMethod: 'setRevealCommittee', rpcMethod: 'veil_set_reveal_committee' },
] as const;

type Tier0SdkMethod = (typeof TIER0_METHOD_CASES)[number]['sdkMethod'];
type Tier0CallOptions = {
  sender?: string;
  signer?: string | Signer;
};

interface Tier0CaseFixture {
  request:
    | CommitOrderRequest
    | RevealBatchRequest
    | SubmitBatchProofRequest
    | ClearBatchRequest
    | SetProofConfigRequest
    | SetRevealCommitteeRequest;
  expectedParams: Record<string, unknown>;
  invoke: (
    client: VeilClient,
    request: Tier0CaseFixture['request'],
    options?: Tier0CallOptions,
  ) => Promise<TransactionReceipt>;
}

interface CapturedRpcRequest {
  url: string;
  rpcMethod: string;
  rpcParams: unknown[];
}

// Byte fields are serialized by the SDK with Buffer.toString('hex'):
// lowercase hex strings without a 0x prefix.
const TIER0_FIXTURES: Record<Tier0SdkMethod, Tier0CaseFixture> = {
  commitOrder: {
    request: {
      marketId: 'market-commit',
      windowId: 42n,
      envelope: Uint8Array.from([0x00, 0xab, 0xcd]),
      commitment: Uint8Array.from([0x10, 0x20, 0xff]),
    },
    expectedParams: {
      marketId: 'market-commit',
      windowId: '42',
      envelope: '00abcd',
      commitment: '1020ff',
    },
    invoke: (client, request, options) => client.commitOrder(request as CommitOrderRequest, options),
  },
  revealBatch: {
    request: {
      marketId: 'market-reveal',
      windowId: 7n,
      envelopeEpoch: 99n,
      envelopeCommitteeKeyId: Uint8Array.from([0x01, 0x02, 0x0f]),
      decryptionShare: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      validatorIndex: 3,
    },
    expectedParams: {
      marketId: 'market-reveal',
      windowId: '7',
      envelopeEpoch: '99',
      envelopeCommitteeKeyId: '01020f',
      decryptionShare: 'deadbeef',
      validatorIndex: 3,
    },
    invoke: (client, request, options) => client.revealBatch(request as RevealBatchRequest, options),
  },
  submitBatchProof: {
    request: {
      marketId: 'market-proof',
      windowId: 9n,
      windowCloseAtMs: 1_700_000_000_123,
      proofType: 2,
      publicInputsHash: Uint8Array.from([0x00, 0x01]),
      fillsHash: Uint8Array.from([0xaa, 0xbb, 0xcc]),
      proof: Uint8Array.from([0x0f, 0xf0]),
    },
    expectedParams: {
      marketId: 'market-proof',
      windowId: '9',
      windowCloseAtMs: 1_700_000_000_123,
      proofType: 2,
      publicInputsHash: '0001',
      fillsHash: 'aabbcc',
      proof: '0ff0',
    },
    invoke: (client, request, options) => client.submitBatchProof(
      request as SubmitBatchProofRequest,
      options,
    ),
  },
  clearBatch: {
    request: {
      marketId: 'market-clear',
      windowId: 10n,
      clearPrice: 1234567890123456789n,
      totalVolume: 5n,
      fillsHash: Uint8Array.from([0x00, 0x00, 0x01]),
    },
    expectedParams: {
      marketId: 'market-clear',
      windowId: '10',
      clearPrice: '1234567890123456789',
      totalVolume: '5',
      fillsHash: '000001',
    },
    invoke: (client, request, options) => client.clearBatch(request as ClearBatchRequest, options),
  },
  setProofConfig: {
    request: {
      requireProof: true,
      requiredProofType: 7,
      requiredCircuitId: 'circuit-alpha',
      batchWindowMs: 1500,
      proofDeadlineMs: 3000,
      revealThresholdX: 2,
      revealThresholdY: 3,
      proverAuthority: '0x0000000000000000000000000000000000009999',
    },
    expectedParams: {
      requireProof: true,
      requiredProofType: 7,
      requiredCircuitId: 'circuit-alpha',
      batchWindowMs: 1500,
      proofDeadlineMs: 3000,
      revealThresholdX: 2,
      revealThresholdY: 3,
      proverAuthority: '0x0000000000000000000000000000000000009999',
    },
    invoke: (client, request, options) => client.setProofConfig(request as SetProofConfigRequest, options),
  },
  setRevealCommittee: {
    request: {
      validatorIndex: 11,
      member: '0x0000000000000000000000000000000000007777',
    },
    expectedParams: {
      validatorIndex: 11,
      member: '0x0000000000000000000000000000000000007777',
    },
    invoke: (client, request, options) => client.setRevealCommittee(
      request as SetRevealCommitteeRequest,
      options,
    ),
  },
};

function installRpcSuccessMock(result: unknown) {
  const requests: CapturedRpcRequest[] = [];

  const fetchMock = vi.fn(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const parsedBody = typeof init?.body === 'string'
        ? (JSON.parse(init.body) as { method?: unknown; params?: unknown })
        : {};

      requests.push({
        url: String(input),
        rpcMethod: typeof parsedBody.method === 'string' ? parsedBody.method : '',
        rpcParams: Array.isArray(parsedBody.params) ? parsedBody.params : [],
      });

      return {
        json: async () => ({ jsonrpc: '2.0', id: 1, result }),
      } as Response;
    },
  );

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, requests };
}

function getSingleRpcPayload(
  requests: CapturedRpcRequest[],
  expectedRpcMethod: string,
): Record<string, unknown> {
  expect(requests).toHaveLength(1);
  const captured = requests[0];
  expect(captured?.url).toBe(RPC_URL);
  expect(captured?.rpcMethod).toBe(expectedRpcMethod);
  expect(captured?.rpcParams).toHaveLength(1);
  return (captured?.rpcParams[0] ?? {}) as Record<string, unknown>;
}

function getRpcPayloadAt(
  requests: CapturedRpcRequest[],
  index: number,
  expectedRpcMethod: string,
): Record<string, unknown> {
  const captured = requests[index];
  expect(captured?.url).toBe(RPC_URL);
  expect(captured?.rpcMethod).toBe(expectedRpcMethod);
  expect(captured?.rpcParams).toHaveLength(1);
  return (captured?.rpcParams[0] ?? {}) as Record<string, unknown>;
}

describe('VeilClient Tier 0 native wrappers (LB-09 scaffold)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  describe('scaffold harness sanity', () => {
    it('captures native RPC envelope shape using an existing write method', async () => {
      const { fetchMock, requests } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });

      const receipt = await client.stake(1n, 'general');

      expect(receipt).toBe(MOCK_RECEIPT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(RPC_URL);
      expect(requests[0]?.rpcMethod).toBe('veil_stake_deposit');
      expect(requests[0]?.rpcParams).toEqual([
        {
          amount: '1',
          role: 'general',
          sender: CONFIG_SIGNER.address,
        },
      ]);
    });
  });

  describe('Tier 0 method mapping + serialization (LB-09)', () => {
    for (const { sdkMethod, rpcMethod } of TIER0_METHOD_CASES) {
      it(
        `${sdkMethod} maps to ${rpcMethod}, serializes typed payload fields, and returns TransactionReceipt`,
        async () => {
          const { fetchMock, requests } = installRpcSuccessMock(MOCK_RECEIPT);
          const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
          const fixture = TIER0_FIXTURES[sdkMethod];

          const receipt = await fixture.invoke(client, fixture.request);

          expect(receipt).toBe(MOCK_RECEIPT);
          expect(fetchMock).toHaveBeenCalledTimes(1);
          expect(getSingleRpcPayload(requests, rpcMethod)).toEqual({
            ...fixture.expectedParams,
            sender: CONFIG_SIGNER.address,
          });
        },
      );
    }
  });

  describe('Tier 0 signer injection + per-call override (LB-09)', () => {
    for (const { sdkMethod, rpcMethod } of TIER0_METHOD_CASES) {
      it(
        `${sdkMethod} injects configured sender by default when no per-call signer override is provided`,
        async () => {
          const { requests } = installRpcSuccessMock(MOCK_RECEIPT);
          const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
          const fixture = TIER0_FIXTURES[sdkMethod];

          await fixture.invoke(client, fixture.request);

          const payload = getSingleRpcPayload(requests, rpcMethod);
          expect(payload.sender).toBe(CONFIG_SIGNER.address);
        },
      );

      it(
        `${sdkMethod} honors explicit per-call signer override without mutating client-level signer state`,
        async () => {
          const { fetchMock, requests } = installRpcSuccessMock(MOCK_RECEIPT);
          const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
          const fixture = TIER0_FIXTURES[sdkMethod];

          await fixture.invoke(client, fixture.request, { signer: OVERRIDE_SIGNER });
          await fixture.invoke(client, fixture.request);

          expect(fetchMock).toHaveBeenCalledTimes(2);
          expect(client.getConfiguredAddress()).toBe(CONFIG_SIGNER.address);

          const overridePayload = getRpcPayloadAt(requests, 0, rpcMethod);
          const defaultPayload = getRpcPayloadAt(requests, 1, rpcMethod);

          expect(overridePayload.sender).toBe(OVERRIDE_SIGNER.address);
          expect(overridePayload.sender).not.toBe(CONFIG_SIGNER.address);
          expect(defaultPayload.sender).toBe(CONFIG_SIGNER.address);
        },
      );
    }
  });

  describe('Tier 0 sender/signer edge cases (LB-03)', () => {
    const explicitSender = '0x0000000000000000000000000000000000000001';
    const invalidAddress = 'not-an-address';
    const noSignerConfiguredError =
      'No signer configured. Read methods work without a signer, but write methods require config.signer (private key string or signer object with address).';

    it('uses options.sender in preference to options.signer when both are provided', async () => {
      const { fetchMock, requests } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
      const fixture = TIER0_FIXTURES.commitOrder;
      const invalidOverrideSigner: Signer = {
        ...OVERRIDE_SIGNER,
        address: invalidAddress,
      };

      const receipt = await fixture.invoke(client, fixture.request, {
        sender: explicitSender,
        signer: invalidOverrideSigner,
      });

      expect(receipt).toBe(MOCK_RECEIPT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getSingleRpcPayload(requests, 'veil_commit_order')).toEqual({
        ...fixture.expectedParams,
        sender: explicitSender,
      });
    });

    it('throws a clear error for invalid options.sender and skips RPC submission', async () => {
      const { fetchMock } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
      const fixture = TIER0_FIXTURES.commitOrder;

      await expect(
        fixture.invoke(client, fixture.request, { sender: invalidAddress }),
      ).rejects.toThrow(/Invalid address in call options\.sender:/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws a clear error for invalid options.signer.address and skips RPC submission', async () => {
      const { fetchMock } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL, signer: CONFIG_SIGNER });
      const fixture = TIER0_FIXTURES.commitOrder;
      const invalidOverrideSigner: Signer = {
        ...OVERRIDE_SIGNER,
        address: invalidAddress,
      };

      await expect(
        fixture.invoke(client, fixture.request, { signer: invalidOverrideSigner }),
      ).rejects.toThrow(/Invalid address in config\.signer\.address:/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows Tier 0 submission without a configured signer when options.sender is valid', async () => {
      const { fetchMock, requests } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL });
      const fixture = TIER0_FIXTURES.commitOrder;

      const receipt = await fixture.invoke(client, fixture.request, { sender: explicitSender });

      expect(receipt).toBe(MOCK_RECEIPT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getSingleRpcPayload(requests, 'veil_commit_order')).toEqual({
        ...fixture.expectedParams,
        sender: explicitSender,
      });
    });

    it('fails Tier 0 submission without configured signer or per-call override', async () => {
      const { fetchMock } = installRpcSuccessMock(MOCK_RECEIPT);
      const client = new VeilClient({ rpcUrl: RPC_URL });
      const fixture = TIER0_FIXTURES.commitOrder;

      await expect(fixture.invoke(client, fixture.request)).rejects.toThrow(noSignerConfiguredError);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
