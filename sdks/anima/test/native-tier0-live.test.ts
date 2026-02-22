import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_LOCAL_ENV_PATH = resolve(TEST_DIR, "fixtures", "native-tier0.env.local");
const EXAMPLE_ENV_PATH = resolve(TEST_DIR, "fixtures", "native-tier0.env.example");

const STRICT_PRIVATE_ORDERED_FLOW = [
  {
    actionId: 2,
    actionName: "CommitOrder",
    expectedExecutorMethod: "commitOrder",
    signerRole: "commitOrder",
    payloadEnvKey: "TIER0_COMMIT_ORDER_PARAMS_PATH",
  },
  {
    actionId: 3,
    actionName: "RevealBatch",
    expectedExecutorMethod: "revealBatch",
    signerRole: "revealBatch",
    payloadEnvKey: "TIER0_BATCH_REVEAL_PAYLOAD_PATH",
  },
  {
    actionId: 17,
    actionName: "SubmitBatchProof",
    expectedExecutorMethod: "submitBatchProof",
    signerRole: "submitBatchProof",
    payloadEnvKey: "TIER0_BATCH_PROOF_PATH",
  },
  {
    actionId: 4,
    actionName: "ClearBatch",
    expectedExecutorMethod: "clearBatch",
    signerRole: "clearBatch",
    payloadEnvKey: "TIER0_CLEAR_BATCH_PARAMS_PATH",
  },
] as const;

type StrictPrivateFlowStep = (typeof STRICT_PRIVATE_ORDERED_FLOW)[number];
type SignerRole = StrictPrivateFlowStep["signerRole"];

const SIGNER_ROLE_ENV = {
  commitOrder: {
    privateKeyEnvKey: "TIER0_SIGNER_COMMIT_ORDER_PRIVATE_KEY",
    addressEnvKey: "TIER0_SIGNER_COMMIT_ORDER_ADDRESS",
    zeroIdEnvKey: "TIER0_ZEROID_COMMIT_ORDER",
  },
  revealBatch: {
    privateKeyEnvKey: "TIER0_SIGNER_REVEAL_BATCH_PRIVATE_KEY",
    addressEnvKey: "TIER0_SIGNER_REVEAL_BATCH_ADDRESS",
    zeroIdEnvKey: "TIER0_ZEROID_REVEAL_BATCH",
  },
  submitBatchProof: {
    privateKeyEnvKey: "TIER0_SIGNER_SUBMIT_BATCH_PROOF_PRIVATE_KEY",
    addressEnvKey: "TIER0_SIGNER_SUBMIT_BATCH_PROOF_ADDRESS",
    zeroIdEnvKey: "TIER0_ZEROID_SUBMIT_BATCH_PROOF",
  },
  clearBatch: {
    privateKeyEnvKey: "TIER0_SIGNER_CLEAR_BATCH_PRIVATE_KEY",
    addressEnvKey: "TIER0_SIGNER_CLEAR_BATCH_ADDRESS",
    zeroIdEnvKey: "TIER0_ZEROID_CLEAR_BATCH",
  },
} as const satisfies Record<
  SignerRole,
  {
    privateKeyEnvKey: string;
    addressEnvKey: string;
    zeroIdEnvKey: string;
  }
>;

const REQUIRED_ENV_KEYS = [
  "ANIMA_NATIVE_RUNTIME",
  "ANIMA_NATIVE_MODE",
  "ANIMA_NATIVE_ENABLE_EVM_COMPAT",
  "ANIMA_NATIVE_ALLOW_DEPRECATED_SURFACES",
  "ANIMA_NATIVE_TIER0_ADMITTED_ACTION_IDS",
  "ANIMA_NATIVE_TIER0_ORDERED_FLOW_IDS",
  "VEILVM_RPC_URL",
  "VEILVM_WS_URL",
  "VEILVM_CHAIN_ID",
  "VEILVM_COMMITTEE_CONFIG_PATH",
  "VEILVM_LOCAL_RUNTIME_STATE_NOTE",
  "ANIMA_TIER0_TEST_TIMEOUT_MS",
  "ANIMA_TIER0_POLL_INTERVAL_MS",
  "ANIMA_TIER0_EVIDENCE_DIR",
  "ANIMA_TIER0_EVIDENCE_NOTE",
  "TIER0_BATCH_ID",
  "TIER0_COMMIT_ORDER_PARAMS_PATH",
  "TIER0_BATCH_REVEAL_PAYLOAD_PATH",
  "TIER0_BATCH_PROOF_PATH",
  "TIER0_CLEAR_BATCH_PARAMS_PATH",
  "TIER0_ZEROID_COMMIT_ORDER",
  "TIER0_ZEROID_REVEAL_BATCH",
  "TIER0_ZEROID_SUBMIT_BATCH_PROOF",
  "TIER0_ZEROID_CLEAR_BATCH",
  "TIER0_SIGNER_COMMIT_ORDER_PRIVATE_KEY",
  "TIER0_SIGNER_REVEAL_BATCH_PRIVATE_KEY",
  "TIER0_SIGNER_SUBMIT_BATCH_PROOF_PRIVATE_KEY",
  "TIER0_SIGNER_CLEAR_BATCH_PRIVATE_KEY",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

type LoadNativeTier0EnvOptions = {
  envFilePath?: string;
  includeProcessEnv?: boolean;
};

type LoadedNativeTier0Env = {
  envPath: string;
  envFileFound: boolean;
  env: Record<string, string>;
};

type NativeTier0EnvValidation = {
  missingKeys: RequiredEnvKey[];
  placeholderKeys: RequiredEnvKey[];
  orderedFlowIds: number[];
  admittedActionIds: number[];
};

type PendingSignerRole = {
  role: SignerRole;
  privateKeyEnvKey: string;
  addressEnvKey: string;
  zeroIdEnvKey: string;
  signerPrivateKey: string | null;
  signerAddress: string | null;
  zeroId: string | null;
};

type PendingReceiptEvidence = {
  actionId: StrictPrivateFlowStep["actionId"];
  actionName: StrictPrivateFlowStep["actionName"];
  status: "pending-executor";
  receipt: null;
  evidenceDir: string | null;
  evidenceNotePath: string | null;
  evidenceTodoPath: string | null;
};

function resolveNativeTier0EnvPath(envFilePath?: string): string {
  if (!envFilePath) {
    return DEFAULT_LOCAL_ENV_PATH;
  }

  return isAbsolute(envFilePath) ? envFilePath : resolve(process.cwd(), envFilePath);
}

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadNativeTier0Env(options: LoadNativeTier0EnvOptions = {}): LoadedNativeTier0Env {
  const envPath = resolveNativeTier0EnvPath(options.envFilePath ?? process.env.ANIMA_TIER0_ENV_FILE);
  const includeProcessEnv = options.includeProcessEnv ?? true;

  const fileEnv = existsSync(envPath) ? parseDotEnv(readFileSync(envPath, "utf8")) : {};
  const env = { ...fileEnv };

  if (includeProcessEnv) {
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  }

  return {
    envPath,
    envFileFound: existsSync(envPath),
    env,
  };
}

function parseCsvIntList(value: string | undefined): number[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => Number(token))
    .filter((token) => Number.isFinite(token));
}

function isPlaceholderValue(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return true;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return trimmed.includes("REPLACE_ME");
}

function validateNativeTier0Env(env: Record<string, string>): NativeTier0EnvValidation {
  const missingKeys: RequiredEnvKey[] = [];
  const placeholderKeys: RequiredEnvKey[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      missingKeys.push(key);
      continue;
    }

    if (isPlaceholderValue(value)) {
      placeholderKeys.push(key);
    }
  }

  return {
    missingKeys,
    placeholderKeys,
    orderedFlowIds: parseCsvIntList(env.ANIMA_NATIVE_TIER0_ORDERED_FLOW_IDS),
    admittedActionIds: parseCsvIntList(env.ANIMA_NATIVE_TIER0_ADMITTED_ACTION_IDS),
  };
}

function buildPendingSignerRoles(env: Record<string, string>): PendingSignerRole[] {
  return (Object.entries(SIGNER_ROLE_ENV) as [SignerRole, (typeof SIGNER_ROLE_ENV)[SignerRole]][]).map(
    ([role, keys]) => ({
      role,
      privateKeyEnvKey: keys.privateKeyEnvKey,
      addressEnvKey: keys.addressEnvKey,
      zeroIdEnvKey: keys.zeroIdEnvKey,
      signerPrivateKey: env[keys.privateKeyEnvKey] ?? null,
      signerAddress: env[keys.addressEnvKey] ?? null,
      zeroId: env[keys.zeroIdEnvKey] ?? null,
    }),
  );
}

function buildPendingReceiptEvidence(
  step: StrictPrivateFlowStep,
  env: Record<string, string>,
): PendingReceiptEvidence {
  const evidenceDir = env.ANIMA_TIER0_EVIDENCE_DIR ?? null;
  const evidenceNotePath = env.ANIMA_TIER0_EVIDENCE_NOTE ?? null;

  return {
    actionId: step.actionId,
    actionName: step.actionName,
    status: "pending-executor",
    receipt: null,
    evidenceDir,
    evidenceNotePath,
    evidenceTodoPath:
      evidenceDir === null ? null : `${evidenceDir}/pending/${step.actionId}-${step.actionName}.receipt.todo.json`,
  };
}

describe("ANIMA Native Tier 0 live harness scaffold (LB-11 prep only)", () => {
  it("documents strict-private ordered flow placeholders 2 -> 3 -> 17 -> 4", () => {
    expect(STRICT_PRIVATE_ORDERED_FLOW.map((step) => step.actionId)).toEqual([2, 3, 17, 4]);
    expect(STRICT_PRIVATE_ORDERED_FLOW.map((step) => step.actionName)).toEqual([
      "CommitOrder",
      "RevealBatch",
      "SubmitBatchProof",
      "ClearBatch",
    ]);
  });

  it("loads and validates the example fixture template shape", () => {
    const loaded = loadNativeTier0Env({ envFilePath: EXAMPLE_ENV_PATH, includeProcessEnv: false });
    const validation = validateNativeTier0Env(loaded.env);

    expect(loaded.envFileFound).toBe(true);
    expect(validation.missingKeys).toEqual([]);
    expect(validation.orderedFlowIds).toEqual([2, 3, 17, 4]);
    expect(validation.admittedActionIds).toEqual([2, 3, 17, 4]);
    expect(validation.placeholderKeys).toContain("VEILVM_COMMITTEE_CONFIG_PATH");
    expect(validation.placeholderKeys).toContain("TIER0_BATCH_PROOF_PATH");
  });

  describe.skip("local strict-private runtime live flow (pending executor methods/tests)", () => {
    it("scaffolds ordered flow execution and evidence capture placeholders", async () => {
      const loaded = loadNativeTier0Env();
      const validation = validateNativeTier0Env(loaded.env);

      // Truthful prerequisite notes for LB-11 harness prep:
      // - proof assets must exist locally (e.g., batch proof / reveal / clear params paths)
      // - committee config must match the local runtime
      // - local runtime state must be prepared for strict-private Tier 0 execution
      // - executor methods/tests are still pending, so no live claims are asserted here yet
      if (!loaded.envFileFound) {
        throw new Error(
          [
            `Missing local env fixture at: ${loaded.envPath}`,
            `Copy ${EXAMPLE_ENV_PATH} -> test/fixtures/native-tier0.env.local and replace placeholders.`,
          ].join("\n"),
        );
      }

      if (validation.missingKeys.length > 0 || validation.placeholderKeys.length > 0) {
        throw new Error(
          [
            "Native Tier 0 live harness env is not ready.",
            `Missing keys: ${validation.missingKeys.join(", ") || "(none)"}`,
            `Placeholder keys: ${validation.placeholderKeys.join(", ") || "(none)"}`,
          ].join("\n"),
        );
      }

      expect(validation.orderedFlowIds).toEqual([2, 3, 17, 4]);
      expect(validation.admittedActionIds).toEqual([2, 3, 17, 4]);
      expect(loaded.env.ANIMA_NATIVE_RUNTIME).toBe("veilvm");
      expect(loaded.env.ANIMA_NATIVE_MODE).toBe("strict-private");
      expect(loaded.env.ANIMA_NATIVE_ENABLE_EVM_COMPAT).toBe("false");
      expect(loaded.env.ANIMA_NATIVE_ALLOW_DEPRECATED_SURFACES).toBe("false");

      const signerRoles = buildPendingSignerRoles(loaded.env);

      const orderedFlowPlaceholders = STRICT_PRIVATE_ORDERED_FLOW.map((step) => ({
        ...step,
        signer: signerRoles.find((signer) => signer.role === step.signerRole) ?? null,
        receiptEvidence: buildPendingReceiptEvidence(step, loaded.env),
        executionStatus: "pending-executor" as const,
      }));

      // Ordered strict-private flow placeholders only (LB-11 harness prep):
      // 2  CommitOrder      -> receipt capture TODO
      // 3  RevealBatch      -> receipt capture TODO
      // 17 SubmitBatchProof -> receipt capture TODO (requires proof assets + committee config)
      // 4  ClearBatch       -> receipt capture TODO (requires local runtime state progression)
      //
      // TODO(LB-11): replace placeholders below with live executor calls once native executor
      // methods and integration tests exist for ANIMA strict-private runtime execution.
      for (const step of orderedFlowPlaceholders) {
        expect(step.executionStatus).toBe("pending-executor");
        expect(step.receiptEvidence.status).toBe("pending-executor");
        expect(step.receiptEvidence.receipt).toBeNull();
      }

      // TODO(LB-11 evidence): persist receipts + hashes under `ANIMA_TIER0_EVIDENCE_DIR`
      // and append an operator note at `ANIMA_TIER0_EVIDENCE_NOTE` after live runs exist.
      void orderedFlowPlaceholders;
    });
  });
});
