# ANIMA Native v1 Task Board (Implementation-Grade)

Scope: ANIMA Native v1 on the current strict private-only VeilVM runtime (not full VEIL production launch gating).

Tier 0 first: complete launch-blocking cards `LB-*` before any `PL-*` work.

Deprecated surface rule (explicit): ignore deprecated VEIL2/legacy wrappers for this effort (`zeroid_*`, `agent_*`, `bloodsworn_*`, `market_*`, role `stake_*`). Do not use them as ANIMA Native v1 execution paths.

Current admitted action IDs (README / strict private-only gate): `2 CommitOrder`, `3 RevealBatch`, `4 ClearBatch`, `17 SubmitBatchProof`, `18 SetProofConfig`, `41 SetRevealCommittee`.

## Launch-Blocking (Tier 0)

### LB-01 - Define Tier 0 Native Types in VM SDK
- Objective: Add typed request/response/result interfaces for Tier 0 actions and export them for downstream ANIMA use.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/index.ts`
- Acceptance test: `pnpm --filter @veil/vm-sdk build` passes; new types are exported from `@veil/vm-sdk`; no `any`/ad hoc JSON payloads in Tier 0 public method signatures.
- Dependencies: none
- Estimated risk: `Medium` (Go field parity mismatches)

### LB-02 - Add Tier 0 Tx Methods to `VeilClient`
- Objective: Implement typed `VeilClient` methods for `commitOrder`, `revealBatch`, `submitBatchProof`, `clearBatch`, `setProofConfig`, `setRevealCommittee`.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/client.ts`
- Acceptance test: Unit mocks verify each method calls `veil_*` RPC with expected method names/serialized fields and returns `TransactionReceipt`.
- Dependencies: `LB-01`
- Estimated risk: `Medium` (RPC payload shape/byte encoding mistakes)

### LB-03 - Add Per-Call Signer Override / Ops Sender Support
- Objective: Support sender-role separation needed for Tier 0 ops/admin calls (especially `CommitOrder` / proof config / committee ops) without mutating global client state.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/client.ts`
- Acceptance test: Tests cover default signer path and explicit override signer path; sender field differs as expected per call.
- Dependencies: `LB-01`, `LB-02`
- Estimated risk: `High` (API design breakage if method signatures are not backward-compatible)

### LB-04 - Add ANIMA Tier 0 Action Union + Runtime Config
- Objective: Add ANIMA action types for Tier 0 and config fields for strict-private capability mode + signer-role mapping.
- Owner: `ANIMA SDK`
- Owned files: `sdks/anima/src/types.ts`, `sdks/anima/src/index.ts`
- Acceptance test: `pnpm --filter @veil/anima build` passes; `AgentAction` includes Tier 0 variants; config types expose strict-private defaults/overrides.
- Dependencies: `LB-01`
- Estimated risk: `Low`

### LB-05 - Implement `commit_order` Execution Path (Replace Native-Mode `trade`)
- Objective: Add ANIMA executor branch for `commit_order` and route native private execution through `CommitOrder` instead of deprecated/public `trade`.
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/agent.ts`
- Acceptance test: Unit test proves native-mode `trade` requests are either translated to `commit_order` or rejected; `client.commitOrder(...)` is invoked for private execution.
- Dependencies: `LB-02`, `LB-03`, `LB-04`
- Estimated risk: `High` (behavior change in existing agent plans)

### LB-06 - Implement Reveal/Proof/Clear Executor Branches
- Objective: Add ANIMA executor support for `reveal_batch`, `submit_batch_proof`, and `clear_batch` with explicit orchestration (no hidden implicit flow).
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/agent.ts`
- Acceptance test: Unit tests verify each action dispatches to the matching Tier 0 `VeilClient` method and preserves action ordering.
- Dependencies: `LB-02`, `LB-03`, `LB-04`
- Estimated risk: `Medium`

### LB-07 - Implement Tier 0 Admin Executor Branches
- Objective: Add ANIMA executor support for `set_proof_config` and `set_reveal_committee` using ops/admin signer routing.
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/agent.ts`
- Acceptance test: Unit tests verify admin actions call `client.setProofConfig(...)` / `client.setRevealCommittee(...)` with configured ops/admin signer context.
- Dependencies: `LB-03`, `LB-04`, `LB-06`
- Estimated risk: `Medium`

### LB-08 - Add Strict-Private Capability Guard + VEIL2 Fence
- Objective: Default ANIMA to current admitted Tier 0 action set only, with explicit override required for non-admitted actions; block deprecated VEIL2 execution surfaces in native mode.
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/agent.ts`
- Acceptance test: Tests show non-admitted action IDs are rejected with a clear error in strict mode; deprecated `trade/create_market/resolve_market/stake/unstake` paths are not used in native mode.
- Dependencies: `LB-04`, `LB-05`, `LB-06`, `LB-07`
- Estimated risk: `High` (can break legacy callers if error semantics are unclear)

### LB-09 - VM SDK Unit Test Coverage for Tier 0 Methods
- Objective: Add focused tests for Tier 0 wrapper method mapping, serialization, and sender injection/override behavior.
- Owner: `QA (TS SDK)`
- Owned files: `sdks/veil-vm/test/native-tier0-client.test.ts`
- Acceptance test: `pnpm --filter @veil/vm-sdk exec vitest run test/native-tier0-client.test.ts` passes.
- Dependencies: `LB-02`, `LB-03`
- Estimated risk: `Low`

### LB-10 - ANIMA Unit Test Coverage for Dispatch + Guarding
- Objective: Add tests for Tier 0 action dispatch, strict-private capability guard, and deprecated-surface fencing behavior.
- Owner: `QA (ANIMA)`
- Owned files: `sdks/anima/test/native-tier0-agent.test.ts`
- Acceptance test: `pnpm --filter @veil/anima exec vitest run test/native-tier0-agent.test.ts` passes.
- Dependencies: `LB-05`, `LB-06`, `LB-07`, `LB-08`
- Estimated risk: `Low`

### LB-11 - Local Tier 0 Live Flow Integration Test / Evidence Harness
- Objective: Add a local VeilVM integration test (or script-driven vitest) that executes `CommitOrder -> RevealBatch -> SubmitBatchProof -> ClearBatch` and records success receipts / indexed results.
- Owner: `QA/Infra`
- Owned files: `sdks/anima/test/native-tier0-live.test.ts`, `sdks/anima/test/fixtures/native-tier0.env.example`
- Acceptance test: Against local strict-private runtime, harness produces a passing run with successful receipts for action IDs `2,3,17,4` and archives a short evidence note/log path.
- Dependencies: `LB-02` through `LB-10`
- Estimated risk: `High` (local runtime prereqs, proof assets, signer roles, timing)

## Post-Launch ANIMA-Native (After Tier 0 Pass)

### PL-01 - VM SDK Native `transfer` Wrapper
- Objective: Add typed native `transfer` method (`Transfer (0)`) to `VeilClient` and export supporting request/result types.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/client.ts`, `sdks/veil-vm/src/index.ts`
- Acceptance test: VM SDK unit tests/build pass; `client.transfer(...)` submits native tx payload and returns `TransactionReceipt`.
- Dependencies: `LB-01` to `LB-03`
- Estimated risk: `Low`

### PL-02 - ANIMA `transfer` Action Execution (Remove Placeholder)
- Objective: Replace ANIMA `transfer` log-only branch with real `client.transfer(...)` execution and strict-private-mode handling.
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/types.ts`, `sdks/anima/src/agent.ts`
- Acceptance test: ANIMA unit tests confirm `transfer` action submits a native tx in override mode and is blocked with a clear policy error in strict-private default mode.
- Dependencies: `LB-08`, `PL-01`
- Estimated risk: `Medium` (runtime admission mismatch if caller assumes public action is enabled)

### PL-03 - Canonical Native `CreateMarket` / `ResolveMarket` Rebind
- Objective: Move `create_market` and `resolve_market` off deprecated `market_*` wrappers to canonical native action mappings; keep xAI oracle logic separate from tx submission wrapper.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/client.ts`, `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/oracle.ts`
- Acceptance test: Unit tests prove canonical method names are used; ANIMA native mode no longer depends on deprecated market RPC naming.
- Dependencies: `LB-01` to `LB-03`
- Estimated risk: `High` (API compatibility + oracle coupling)

### PL-04 - Tier 1 Liquidity Family Native Wrappers (Gated)
- Objective: Add typed wrappers for `CreatePool`, `AddLiquidity`, `RemoveLiquidity`, `SwapExactIn` and mark them implemented-but-not-admitted by default in strict-private mode.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/client.ts`, `sdks/veil-vm/src/index.ts`
- Acceptance test: Build/tests pass; ANIMA capability guard recognizes these as implemented but disabled under strict-private default.
- Dependencies: `LB-01` to `LB-03`, `LB-08`
- Estimated risk: `Medium`

### PL-05 - Tier 1 Treasury/Risk Native Wrappers (Gated)
- Objective: Add typed wrappers for `RouteFees`, `ReleaseCOLTranche`, `MintVAI`, `BurnVAI`, `UpdateReserveState`, `SetRiskParams` and classify them by signer/authority needs.
- Owner: `VM SDK`
- Owned files: `sdks/veil-vm/src/types.ts`, `sdks/veil-vm/src/client.ts`, `sdks/veil-vm/src/index.ts`
- Acceptance test: Build/tests pass; method signatures include typed admin/user request payloads and signer requirements are documented in code comments/types.
- Dependencies: `LB-01` to `LB-03`
- Estimated risk: `Medium`

### PL-06 - ANIMA Capability Matrix (Implemented vs Runtime-Admitted)
- Objective: Surface two statuses in ANIMA planning/execution (`implemented`, `runtime-admitted`) so ANIMA does not confuse SDK coverage with current VeilVM admission policy.
- Owner: `ANIMA Runtime`
- Owned files: `sdks/anima/src/types.ts`, `sdks/anima/src/agent.ts`
- Acceptance test: Unit tests verify a supported-but-non-admitted action returns a deterministic "blocked by runtime policy" decision before tx submission.
- Dependencies: `LB-08`, `PL-04`, `PL-05`
- Estimated risk: `Low`

## Recommended Execution Order (4 Parallel Agents)

Use one owner per hotspot file (`client.ts`, `agent.ts`) at a time to avoid merge collisions.

### Wave 1 (parallel start)
- Agent 1 (`VM SDK`): `LB-01`
- Agent 2 (`ANIMA SDK`): `LB-04`
- Agent 3 (`QA TS SDK`): scaffold `LB-09` test file/mocks (no assertions dependent on new methods yet)
- Agent 4 (`QA ANIMA`): scaffold `LB-10` test file/mocks and `LB-11` env fixture template

### Wave 2 (VM + ANIMA core)
- Agent 1: `LB-02` then `LB-03` (same `client.ts` hotspot; keep serial)
- Agent 2: `LB-05` (after `LB-02/03` and `LB-04`)
- Agent 3: complete `LB-09` once `LB-02/03` lands
- Agent 4: prep local harness plumbing for `LB-11` (skip final assertions until executor branches land)

### Wave 3 (ANIMA executor completion)
- Agent 2: `LB-06` then `LB-07` (same `agent.ts` hotspot; keep serial)
- Agent 3: review/extend SDK tests for signer override edge cases
- Agent 4: continue `LB-11` live harness wiring against local strict-private runtime
- Agent 1: support API review / fix follow-ups from `LB-09`

### Wave 4 (guard + validation gate)
- Agent 2: `LB-08` (strict-private guard + deprecated VEIL2 fence)
- Agent 4: finalize `LB-10` after `LB-08`
- Agent 4: run `LB-11` live flow and archive evidence note/log path
- Agent 1 / Agent 3: bug-fix loop only (no new scope)

### After Tier 0 Pass (post-launch backlog)
- Agent 1: `PL-01`, `PL-03`, `PL-04`, `PL-05` (serial on `client.ts`)
- Agent 2: `PL-02`, `PL-06`
- Agent 3: tests for `PL-01`, `PL-03`, `PL-04`, `PL-05`
- Agent 4: integration validation + docs/evidence updates; run `PL-02` validation after `PL-01`

## Notes

- This board is for ANIMA Native v1 implementation sequencing, not VEIL production checklist closure (`G10`/`G11` remain independent production blockers as of 2026-02-22).
- Keep ANIMA private-path orchestration explicit (`CommitOrder`, `RevealBatch`, `SubmitBatchProof`, `ClearBatch`); do not hide proof/reveal/clear behind a generic `trade` abstraction.
