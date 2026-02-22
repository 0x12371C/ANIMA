# VEIL Native API v1 Mapping (ANIMA)

Source-of-truth for ANIMA Native v1 implementation planning.

- Canonical action surface: `C:\Users\Josh\hypersdk\examples\veilvm\actions\*.go` + `C:\Users\Josh\hypersdk\examples\veilvm\README.md` action catalog (IDs `0-41`).
- Gap comparison inputs: `C:\Users\Josh\Desktop\veil-automaton\sdks\veil-vm\src\client.ts` and `C:\Users\Josh\Desktop\veil-automaton\sdks\anima\src\agent.ts`.
- Tiering context (launch-adjacent prioritization language): `C:\Users\Josh\hypersdk\examples\veilvm\VEIL_PRODUCTION_LAUNCH_CHECKLIST.md` and `C:\Users\Josh\Desktop\private-github-ready-20260219\veil-frontend\docs\here-and-now-handoff-2026-02-22.md`.
- Current runtime posture (local launch-gate profile): strict private-only admission currently admits only `CommitOrder`, `RevealBatch`, `SubmitBatchProof`, `ClearBatch`, `SetProofConfig`, `SetRevealCommittee`.
- VM-first privacy stance: ANIMA Native v1 should target native VeilVM actions first; EVM rails are compatibility rails only.
- Explicit do-not-use note: ignore deprecated VEIL2 surfaces for this mapping (legacy `zeroid_*`, `agent_*`, `bloodsworn_*`, `market_*`, role `stake_*` RPC wrappers in current SDK are not the native action source-of-truth).

Status legend: `implemented in SDK` = typed/native wrapper exists for the VeilVM action; `partial` = semantic overlap only (deprecated/mismatched surface); `missing` = no usable native wrapper.

## Tier 0 (Launch-Adjacent, Current Private Admission Set)

These are the actions ANIMA Native v1 must understand first because they are the currently admitted proof-path/admin set in the local strict private-only runtime.

| ID | Action | Action file | Intended SDK method | ANIMA relevance | Privacy classification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | CommitOrder | `actions/commit_order.go` | `commitOrder` | Core v1 (private ingress/execution) | `private proof path` | missing |
| 3 | RevealBatch | `actions/reveal_batch.go` | `revealBatch` | Core v1 (committee reveal pipeline) | `private proof path` | missing |
| 17 | SubmitBatchProof | `actions/submit_batch_proof.go` | `submitBatchProof` | Core v1 (prover pipeline) | `private proof path` | missing |
| 4 | ClearBatch | `actions/clear_batch.go` | `clearBatch` | Core v1 (proof-gated settlement) | `private proof path` | missing |
| 18 | SetProofConfig | `actions/set_proof_config.go` | `setProofConfig` | Ops v1 (launch-gate admin) | `public aggregate/admin` | missing |
| 41 | SetRevealCommittee | `actions/set_reveal_committee.go` | `setRevealCommittee` | Ops v1 (committee admin) | `public aggregate/admin` | missing |

## Tier 1 (Near-Term Native Coverage After Tier 0)

Launch-adjacent market/liquidity/treasury actions that ANIMA may need next, but are not part of the current strict private admission set. Note: local runtime docs state native liquidity ingress is private-commit only, so user-facing liquidity/trading should route via `CommitOrder` path first.

| ID | Action | Action file | Intended SDK method | ANIMA relevance | Privacy classification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Transfer | `actions/transfer.go` | `transfer` | Near-term funding/ops utility | `public user utility` | missing |
| 1 | CreateMarket | `actions/create_market.go` | `createMarket` | Near-term market admin/orchestration | `public aggregate/admin` | partial |
| 5 | ResolveMarket | `actions/resolve_market.go` | `resolveMarket` | Near-term market resolution ops | `public aggregate/admin` | partial |
| 6 | Dispute | `actions/dispute.go` | `dispute` | Near-term market safety | `public user/guardian` | missing |
| 7 | RouteFees | `actions/route_fees.go` | `routeFees` | Near-term treasury automation | `public aggregate/admin` | missing |
| 8 | ReleaseCOLTranche | `actions/release_col_tranche.go` | `releaseColTranche` | Near-term treasury automation | `public aggregate/admin` | missing |
| 9 | MintVAI | `actions/mint_vai.go` | `mintVAI` | Near-term reserve/stability ops | `public user treasury` | missing |
| 10 | BurnVAI | `actions/burn_vai.go` | `burnVAI` | Near-term reserve/stability ops | `public user treasury` | missing |
| 11 | CreatePool | `actions/create_pool.go` | `createPool` | Near-term liquidity infra | `public aggregate/admin` | missing |
| 12 | AddLiquidity | `actions/add_liquidity.go` | `addLiquidity` | Near-term liquidity (direct path not v1 ingress) | `public user liquidity` | missing |
| 13 | RemoveLiquidity | `actions/remove_liquidity.go` | `removeLiquidity` | Near-term liquidity ops | `public user liquidity` | missing |
| 14 | SwapExactIn | `actions/swap_exact_in.go` | `swapExactIn` | Near-term liquidity/trading (direct path not v1 ingress) | `public user liquidity` | missing |
| 15 | UpdateReserveState | `actions/update_reserve_state.go` | `updateReserveState` | Near-term reserve telemetry/admin | `public aggregate/admin` | missing |
| 16 | SetRiskParams | `actions/set_risk_params.go` | `setRiskParams` | Near-term risk governance | `public aggregate/admin` | missing |

## Tier 2 (Deferred / Extended Native Coverage)

Important VeilVM-native subsystems, but lower priority for ANIMA Native v1 unless ANIMA is explicitly extended into treasury/stability/vault/bond automation.

| ID | Action | Action file | Intended SDK method | ANIMA relevance | Privacy classification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | BondDeposit | `actions/bond_deposit.go` | `bondDeposit` | Deferred (bond subsystem user flow) | `public user treasury` | missing |
| 20 | BondRedeem | `actions/bond_redeem.go` | `bondRedeem` | Deferred (bond treasury buffer flow) | `public user treasury` | missing |
| 21 | CreateBondMarket | `actions/create_bond_market.go` | `createBondMarket` | Deferred (bond governance/admin) | `public aggregate/admin` | missing |
| 22 | PurchaseBond | `actions/purchase_bond.go` | `purchaseBond` | Deferred (bond user strategy) | `public user treasury` | missing |
| 23 | RedeemBondNote | `actions/redeem_bond_note.go` | `redeemBondNote` | Deferred (bond user strategy) | `public user treasury` | missing |
| 24 | SetYRFConfig | `actions/set_yrf_config.go` | `setYRFConfig` | Deferred (YRF governance) | `public aggregate/admin` | missing |
| 25 | RunYRFWeeklyReset | `actions/run_yrf_weekly_reset.go` | `runYRFWeeklyReset` | Deferred (YRF keeper/ops) | `public aggregate/admin` | missing |
| 26 | RunYRFDailyBeat | `actions/run_yrf_daily_beat.go` | `runYRFDailyBeat` | Deferred (YRF keeper/ops) | `public aggregate/admin` | missing |
| 27 | SetRBSConfig | `actions/set_rbs_config.go` | `setRBSConfig` | Deferred (RBS governance) | `public aggregate/admin` | missing |
| 28 | TickRBS | `actions/tick_rbs.go` | `tickRBS` | Deferred (RBS keeper/ops) | `public aggregate/admin` | missing |
| 29 | LiquidateCDP | `actions/liquidate_cdp.go` | `liquidateCDP` | Deferred (liquidation automation) | `public keeper/liquidation` | missing |
| 30 | SetVVEILPolicy | `actions/set_vveil_policy.go` | `setVVEILPolicy` | Deferred (vVEIL governance) | `public aggregate/admin` | missing |
| 31 | StakeVEIL | `actions/stake_veil.go` | `stakeVEIL` | Deferred (staking strategy) | `public user staking` | missing |
| 32 | WrapVVEIL | `actions/wrap_vveil.go` | `wrapVVEIL` | Deferred (staking position mgmt) | `public user staking` | missing |
| 33 | UnwrapGVEIL | `actions/unwrap_gveil.go` | `unwrapGVEIL` | Deferred (staking position mgmt) | `public user staking` | missing |
| 34 | RebaseVVEIL | `actions/rebase_vveil.go` | `rebaseVVEIL` | Deferred (vVEIL keeper/policy) | `public aggregate/admin` | missing |
| 35 | SetVAIVaultConfig | `actions/set_vai_vault_config.go` | `setVAIVaultConfig` | Deferred (vault governance) | `public aggregate/admin` | missing |
| 36 | DepositCDP | `actions/deposit_cdp.go` | `depositCDP` | Deferred (CDP user flow) | `public user CDP` | missing |
| 37 | WithdrawCDP | `actions/withdraw_cdp.go` | `withdrawCDP` | Deferred (CDP user flow) | `public user CDP` | missing |
| 38 | DrawVAIFromCDP | `actions/draw_vai_from_cdp.go` | `drawVAIFromCDP` | Deferred (CDP user flow) | `public user CDP` | missing |
| 39 | RepayVAIToCDP | `actions/repay_vai_to_cdp.go` | `repayVAIToCDP` | Deferred (CDP user flow) | `public user CDP` | missing |
| 40 | AccrueVAIStability | `actions/accrue_vai_stability.go` | `accrueVAIStability` | Deferred (vault stability keeper) | `public aggregate/admin` | missing |

## Gaps vs Current `@veil/vm-sdk`

1. Native action wrapper coverage is effectively `0/42` implemented.
2. Only two actions have partial semantic overlap in the current SDK:
   - `CreateMarket` -> `client.createMarket()` (`veil_market_create`, deprecated/mismatched surface)
   - `ResolveMarket` -> `client.resolveMarket()` (`veil_market_resolve`, deprecated/mismatched surface, xAI wrapper logic layered on top)
3. Current SDK is dominated by deprecated/non-canonical surfaces for this effort (`zeroid_*`, `agent_*`, `bloodsworn_*`, `market_trade`, role `stake_*`), which are not VeilVM native action mappings.
4. `AnimaAgent` currently executes `trade/create_market/resolve_market/stake/unstake` and a `transfer` placeholder, but it does not execute the Tier 0 private proof pipeline (`CommitOrder`, `RevealBatch`, `SubmitBatchProof`, `ClearBatch`).
5. No SDK support exists for strict private-only capability gating (ANIMA can plan actions that runtime will reject under current admission policy).
6. No native `CommitOrder` wrapper exists for the current private liquidity ingress path (README states native liquidity ingress is private-commit only in local runtime).
7. No explicit operations-signer support is modeled for `CommitOrder` sender hardening (README notes treasury `Operations` signer requirement on current runtime).

## ANIMA Native v1 Acceptance Checklist (Concrete)

- [ ] Add typed `VeilClient` tx methods for all Tier 0 actions (`commitOrder`, `revealBatch`, `submitBatchProof`, `clearBatch`, `setProofConfig`, `setRevealCommittee`).
- [ ] Define request/response/result types for Tier 0 methods from the corresponding Go action/result structs (no ad hoc JSON payloads).
- [ ] Add ANIMA action types + executor branches for Tier 0 actions; do not rely on deprecated `trade`/`market_trade` for private execution.
- [ ] Replace ANIMA "trade" path with private envelope commit flow (`CommitOrder`) and keep proof/reveal/clear orchestration explicit.
- [ ] Add runtime capability guard (default strict-private mode) so ANIMA does not attempt non-admitted actions without an explicit override.
- [ ] Model signer-role separation for ops/admin actions, especially `CommitOrder` (current runtime sender hardening) and proof/committee admin calls.
- [ ] Add integration test/evidence path on local VeilVM for `CommitOrder -> RevealBatch -> SubmitBatchProof -> ClearBatch` with indexed success checks.
- [ ] Mark deprecated VEIL2 surfaces in `@veil/vm-sdk` as compatibility/deprecated and keep them out of ANIMA Native v1 execution paths.
- [ ] Track Tier 1/Tier 2 implementation as backlog by action family (market, liquidity, treasury, bonds, YRF/RBS, vVEIL, VAI vault/CDP) after Tier 0 passes.

## Ambiguities / Decisions Needed

- Ownership boundary: decide whether ANIMA v1 itself executes committee/prover/admin actions (`RevealBatch`, `SubmitBatchProof`, `SetProofConfig`, `SetRevealCommittee`) or whether those belong to a separate ops service using the same SDK.
- `CreatePool` authorization model is not obvious from the README table alone (listed here as admin-leaning; confirm from action auth checks before finalizing ANIMA role ownership).
- `StakeVEIL` vs current SDK `stake(amount, role)` is a naming collision with different semantics; native v1 method naming should avoid implying compatibility with the deprecated role-stake surface.
- Many actions exist in VeilVM but are currently rejected under strict private-only admission; ANIMA API availability and runtime admissibility should be tracked as separate statuses.
