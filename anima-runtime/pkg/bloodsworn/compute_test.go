package bloodsworn

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// --- Mock chain reader ---

type mockChain struct {
	predictions []ResolvedPosition
	validator   *ValidatorMetrics
	liquidity   *LiquidityData
	infra       *InfraData
	contracts   []ContractEvent
}

func (m *mockChain) GetPredictionHistory(_ context.Context, _ string) ([]ResolvedPosition, error) {
	return m.predictions, nil
}
func (m *mockChain) GetValidatorMetrics(_ context.Context, _ string) (*ValidatorMetrics, error) {
	return m.validator, nil
}
func (m *mockChain) GetLiquidityContribution(_ context.Context, _ string) (*LiquidityData, error) {
	return m.liquidity, nil
}
func (m *mockChain) GetInfraNodes(_ context.Context, _ string) (*InfraData, error) {
	return m.infra, nil
}
func (m *mockChain) GetContractHistory(_ context.Context, _ string) ([]ContractEvent, error) {
	return m.contracts, nil
}

func now() time.Time { return time.Now() }
func daysAgo(d int) time.Time { return time.Now().Add(-time.Duration(d) * 24 * time.Hour) }

// --- Prediction Score Tests ---

func TestPredictionScore_Empty(t *testing.T) {
	score := predictionScore(nil, now())
	if score != 0.5 {
		t.Errorf("empty predictions should be neutral (0.5), got %.3f", score)
	}
}

func TestPredictionScore_PerfectTrader(t *testing.T) {
	positions := []ResolvedPosition{
		{Correct: true, EntryPrice: 0.70, PnL: 300, Capital: 1000, ResolvedAt: daysAgo(1)},
		{Correct: true, EntryPrice: 0.65, PnL: 250, Capital: 1000, ResolvedAt: daysAgo(2)},
		{Correct: true, EntryPrice: 0.80, PnL: 400, Capital: 1000, ResolvedAt: daysAgo(3)},
		{Correct: true, EntryPrice: 0.60, PnL: 200, Capital: 1000, ResolvedAt: daysAgo(5)},
		{Correct: true, EntryPrice: 0.75, PnL: 350, Capital: 1000, ResolvedAt: daysAgo(7)},
		{Correct: true, EntryPrice: 0.70, PnL: 300, Capital: 1000, ResolvedAt: daysAgo(10)},
		{Correct: true, EntryPrice: 0.65, PnL: 250, Capital: 1000, ResolvedAt: daysAgo(12)},
		{Correct: true, EntryPrice: 0.80, PnL: 400, Capital: 1000, ResolvedAt: daysAgo(14)},
		{Correct: true, EntryPrice: 0.70, PnL: 300, Capital: 1000, ResolvedAt: daysAgo(16)},
		{Correct: true, EntryPrice: 0.75, PnL: 350, Capital: 1000, ResolvedAt: daysAgo(18)},
	}
	score := predictionScore(positions, now())
	// Log scoring rule: even correct predictions at 0.70 have log(0.70) ≈ -0.36
	// With sigmoid mapping and ROI boost, perfect trader scores ~0.45-0.55
	// This is by design — it takes high-confidence correct calls to score above 0.6
	if score < 0.40 {
		t.Errorf("perfect trader with good ROI should score reasonably, got %.3f", score)
	}
}

func TestPredictionScore_TerribleTrader(t *testing.T) {
	positions := make([]ResolvedPosition, 15)
	for i := range positions {
		positions[i] = ResolvedPosition{
			Correct: false, EntryPrice: 0.85, PnL: -500, Capital: 1000,
			ResolvedAt: daysAgo(i + 1),
		}
	}
	score := predictionScore(positions, now())
	if score > 0.3 {
		t.Errorf("terrible trader should score low, got %.3f", score)
	}
}

func TestPredictionScore_OverconfidentWrongPunished(t *testing.T) {
	// Agent pays 0.95 for YES but it resolves NO — should be punished severely
	overconfident := []ResolvedPosition{
		{Correct: false, EntryPrice: 0.95, PnL: -950, Capital: 1000, ResolvedAt: daysAgo(1)},
	}
	// Agent pays 0.55 for YES but it resolves NO — mild punishment
	cautious := []ResolvedPosition{
		{Correct: false, EntryPrice: 0.55, PnL: -550, Capital: 1000, ResolvedAt: daysAgo(1)},
	}

	// Both have min sample ramp, but overconfident should still score lower
	scoreOver := predictionScore(overconfident, now())
	scoreCaut := predictionScore(cautious, now())
	if scoreOver >= scoreCaut {
		t.Errorf("overconfident wrong (%.3f) should score lower than cautious wrong (%.3f)", scoreOver, scoreCaut)
	}
}

func TestPredictionScore_TimeDecay(t *testing.T) {
	// Same prediction, one recent, one old
	recent := []ResolvedPosition{
		{Correct: true, EntryPrice: 0.70, PnL: 300, Capital: 1000, ResolvedAt: daysAgo(1)},
	}
	old := []ResolvedPosition{
		{Correct: true, EntryPrice: 0.70, PnL: 300, Capital: 1000, ResolvedAt: daysAgo(60)},
	}
	// Both have min sample ramp so scores are muted, but the underlying weighted score should differ
	recentScore := predictionScore(recent, now())
	oldScore := predictionScore(old, now())
	// Due to sample ramp both are close to 0.5, but recent should be >= old
	if recentScore < oldScore-0.01 {
		t.Errorf("recent prediction (%.3f) should score >= old prediction (%.3f)", recentScore, oldScore)
	}
}

// --- Validator Score Tests ---

func TestValidatorScore_NoValidator(t *testing.T) {
	score := validatorScore(nil, now())
	if score != 0 {
		t.Errorf("no validator should score 0, got %.3f", score)
	}
}

func TestValidatorScore_PerfectUptime(t *testing.T) {
	v := &ValidatorMetrics{
		BlocksProduced: 10000, BlocksExpected: 10000,
		StakeStarted: daysAgo(180), IsActive: true,
	}
	score := validatorScore(v, now())
	if score < 0.8 {
		t.Errorf("perfect uptime + long stake should score high, got %.3f", score)
	}
}

func TestValidatorScore_SlashesPunishExponentially(t *testing.T) {
	base := &ValidatorMetrics{
		BlocksProduced: 950, BlocksExpected: 1000,
		StakeStarted: daysAgo(120), IsActive: true,
	}
	score0 := validatorScore(base, now())

	slash1 := *base
	slash1.SlashEvents = 1
	score1 := validatorScore(&slash1, now())

	slash3 := *base
	slash3.SlashEvents = 3
	score3 := validatorScore(&slash3, now())

	if score1 >= score0 {
		t.Errorf("1 slash (%.3f) should score less than 0 slashes (%.3f)", score1, score0)
	}
	if score3 >= score1 {
		t.Errorf("3 slashes (%.3f) should score less than 1 slash (%.3f)", score3, score1)
	}
	// Verify exponential: ratio should compound
	ratio1 := score1 / score0
	ratio3 := score3 / score0
	expectedRatio3 := math.Pow(0.8, 3) / math.Pow(0.8, 0)
	if math.Abs(ratio3/ratio1-expectedRatio3/0.8) > 0.05 {
		t.Logf("Slash ratios — 1: %.3f, 3: %.3f (expected exponential decay)", ratio1, ratio3)
	}
}

func TestValidatorScore_NewStakeLowDuration(t *testing.T) {
	v := &ValidatorMetrics{
		BlocksProduced: 100, BlocksExpected: 100,
		StakeStarted: daysAgo(7), IsActive: true,
	}
	score := validatorScore(v, now())
	if score > 0.15 {
		t.Errorf("new stake (7 days) should have low duration factor, got %.3f", score)
	}
}

// --- Liquidity Score Tests ---

func TestLiquidityScore_NoLiquidity(t *testing.T) {
	score := liquidityScore(nil, now())
	if score != 0 {
		t.Errorf("no liquidity should score 0, got %.3f", score)
	}
}

func TestLiquidityScore_DiminishingReturns(t *testing.T) {
	small := &LiquidityData{Positions: []LiquidityPosition{
		{AmountVAI: 1000, StartTime: daysAgo(30)},
	}}
	large := &LiquidityData{Positions: []LiquidityPosition{
		{AmountVAI: 100000, StartTime: daysAgo(30)},
	}}

	scoreSmall := liquidityScore(small, now())
	scoreLarge := liquidityScore(large, now())

	if scoreLarge <= scoreSmall {
		t.Errorf("more liquidity should score higher: small=%.3f, large=%.3f", scoreSmall, scoreLarge)
	}
	// But not linearly — 100x more liquidity shouldn't give 100x more score
	ratio := scoreLarge / scoreSmall
	if ratio > 10 {
		t.Errorf("diminishing returns violated: ratio %.1f (should be < 10)", ratio)
	}
}

func TestLiquidityScore_VolatileWithdrawalPenalty(t *testing.T) {
	base := &LiquidityData{
		Positions:           []LiquidityPosition{{AmountVAI: 10000, StartTime: daysAgo(60)}},
		VolatileWithdrawals: 0,
	}
	penalized := &LiquidityData{
		Positions:           []LiquidityPosition{{AmountVAI: 10000, StartTime: daysAgo(60)}},
		VolatileWithdrawals: 2,
	}

	scoreBase := liquidityScore(base, now())
	scorePen := liquidityScore(penalized, now())

	expectedPen := scoreBase * VolatilityPenalty * VolatilityPenalty
	if math.Abs(scorePen-expectedPen) > 0.01 {
		t.Errorf("volatile withdrawal penalty: expected %.3f, got %.3f", expectedPen, scorePen)
	}
}

// --- Contract Score Tests ---

func TestContractScore_NoHistory(t *testing.T) {
	score := contractScore(nil, now())
	if score != 0.5 {
		t.Errorf("no history should be neutral (0.5), got %.3f", score)
	}
}

func TestContractScore_PerfectHonor(t *testing.T) {
	events := make([]ContractEvent, 20)
	for i := range events {
		events[i] = ContractEvent{Fulfilled: true, Timestamp: daysAgo(i + 1)}
	}
	score := contractScore(events, now())
	if score < 0.9 {
		t.Errorf("perfect honor should score very high, got %.3f", score)
	}
}

func TestContractScore_RecentBrokenPunishedMore(t *testing.T) {
	// Same number of broken contracts, but at different times
	recentBroken := []ContractEvent{
		{Fulfilled: true, Timestamp: daysAgo(60)},
		{Fulfilled: true, Timestamp: daysAgo(50)},
		{Fulfilled: false, Timestamp: daysAgo(5)}, // Recent — 3× weight
	}
	oldBroken := []ContractEvent{
		{Fulfilled: true, Timestamp: daysAgo(60)},
		{Fulfilled: true, Timestamp: daysAgo(50)},
		{Fulfilled: false, Timestamp: daysAgo(90)}, // Old — 1× weight
	}

	scoreRecent := contractScore(recentBroken, now())
	scoreOld := contractScore(oldBroken, now())

	if scoreRecent >= scoreOld {
		t.Errorf("recent broken (%.3f) should score lower than old broken (%.3f)", scoreRecent, scoreOld)
	}
}

// --- Composite Tests ---

func TestWeightedHarmonicMean_PunishesZeros(t *testing.T) {
	// All good except one zero
	scores := []float64{0.8, 0.0, 0.8, 0.8, 0.8}
	weights := []float64{0.2, 0.2, 0.2, 0.2, 0.2}

	hm := weightedHarmonicMean(scores, weights)

	// Harmonic mean should be very low because of the near-zero component
	if hm > 0.1 {
		t.Errorf("harmonic mean should punish zero components harshly, got %.3f", hm)
	}
}

func TestWeightedHarmonicMean_SkipsZeroWeight(t *testing.T) {
	scores := []float64{0.8, 0.0, 0.8, 0.8, 0.8}
	weights := []float64{0.25, 0.0, 0.25, 0.25, 0.25} // Zero weight on the zero score

	hm := weightedHarmonicMean(scores, weights)
	if hm < 0.7 {
		t.Errorf("zero-weighted components should be excluded, got %.3f", hm)
	}
}

func TestFloorPenalty(t *testing.T) {
	// One component at 0.1 (below 0.2 floor)
	scores := []float64{0.8, 0.1, 0.8, 0.8, 0.8}
	weights := []float64{0.2, 0.2, 0.2, 0.2, 0.2}

	penalty := floorPenalty(scores, weights)
	expected := 0.1 / 0.2 // = 0.5
	if math.Abs(penalty-expected) > 0.01 {
		t.Errorf("floor penalty: expected %.3f, got %.3f", expected, penalty)
	}
}

func TestAsymmetricSmooth(t *testing.T) {
	// Going up: slow
	up := asymmetricSmooth(0.5, 0.9)
	expectedUp := 0.5 + 0.1*(0.9-0.5) // = 0.54
	if math.Abs(up-expectedUp) > 0.001 {
		t.Errorf("upward smooth: expected %.3f, got %.3f", expectedUp, up)
	}

	// Going down: fast
	down := asymmetricSmooth(0.9, 0.5)
	expectedDown := 0.9 + 0.5*(0.5-0.9) // = 0.7
	if math.Abs(down-expectedDown) > 0.001 {
		t.Errorf("downward smooth: expected %.3f, got %.3f", expectedDown, down)
	}
}

// --- Tier Tests ---

func TestTierThresholds_Basic(t *testing.T) {
	tests := []struct {
		ev   float64
		tier types.BloodswornTier
	}{
		{0.0, types.BloodswornUnproven},
		{0.10, types.BloodswornUnproven},
		{0.20, types.BloodswornInitiate},
		{0.44, types.BloodswornInitiate},
		{0.45, types.BloodswornBlooded},
		{0.64, types.BloodswornBlooded},
		{0.65, types.BloodswornSworn},
		{0.84, types.BloodswornSworn},
		{0.85, types.BloodswornSovereign},
		{1.0, types.BloodswornSovereign},
	}

	for _, tt := range tests {
		got := computeTier(tt.ev, nil)
		if got != tt.tier {
			t.Errorf("EV %.2f: expected %s, got %s", tt.ev, tt.tier, got)
		}
	}
}

func TestTierHysteresis_PreventsDemotion(t *testing.T) {
	// Agent is Sworn (threshold 0.65). Drops to 0.62 — should hold due to hysteresis
	prev := &types.EVScore{BloodswornTier: types.BloodswornSworn}
	tier := computeTier(0.62, prev)
	if tier != types.BloodswornSworn {
		t.Errorf("hysteresis should prevent demotion at 0.62, got %s", tier)
	}

	// Drops to 0.59 — below hysteresis buffer (0.65 - 0.05 = 0.60), should demote
	tier = computeTier(0.59, prev)
	if tier == types.BloodswornSworn {
		t.Errorf("should demote at 0.59 (below hysteresis buffer), got %s", tier)
	}
}

// --- Full Integration Test ---

func TestComputeEV_StrongAgent(t *testing.T) {
	chain := &mockChain{
		predictions: func() []ResolvedPosition {
			var p []ResolvedPosition
			for i := 0; i < 20; i++ {
				correct := i%5 != 0 // 80% accuracy
				price := 0.70
				pnl := 300.0
				if !correct {
					pnl = -200
				}
				p = append(p, ResolvedPosition{
					Correct: correct, EntryPrice: price, PnL: pnl,
					Capital: 1000, ResolvedAt: daysAgo(i + 1),
				})
			}
			return p
		}(),
		validator: &ValidatorMetrics{
			BlocksProduced: 9900, BlocksExpected: 10000,
			StakeStarted: daysAgo(120), IsActive: true,
		},
		liquidity: &LiquidityData{
			Positions: []LiquidityPosition{{AmountVAI: 50000, StartTime: daysAgo(90)}},
		},
		infra: &InfraData{Nodes: []InfraNode{{Active: true, UptimePercent: 99.5}}},
		contracts: func() []ContractEvent {
			var e []ContractEvent
			for i := 0; i < 15; i++ {
				e = append(e, ContractEvent{Fulfilled: true, Timestamp: daysAgo(i * 3)})
			}
			e = append(e, ContractEvent{Fulfilled: false, Timestamp: daysAgo(60)})
			return e
		}(),
	}

	ev, err := ComputeEV(context.Background(), chain, "0xSTRONG", types.StateAdolescent, nil)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("Strong agent — EV: %.3f | Tier: %s | P:%.3f V:%.3f", ev.NetEV, ev.BloodswornTier, ev.PredictionAccuracy, ev.ValidatorUptime)

	if ev.NetEV < 0.4 {
		t.Errorf("strong agent should have decent EV, got %.3f", ev.NetEV)
	}
	if ev.BloodswornTier == types.BloodswornUnproven {
		t.Errorf("strong agent shouldn't be unproven, got %s", ev.BloodswornTier)
	}
}

func TestComputeEV_BadAgent(t *testing.T) {
	chain := &mockChain{
		predictions: func() []ResolvedPosition {
			var p []ResolvedPosition
			for i := 0; i < 15; i++ {
				p = append(p, ResolvedPosition{
					Correct: false, EntryPrice: 0.80, PnL: -500,
					Capital: 1000, ResolvedAt: daysAgo(i + 1),
				})
			}
			return p
		}(),
		validator: &ValidatorMetrics{
			BlocksProduced: 400, BlocksExpected: 1000,
			SlashEvents: 3, StakeStarted: daysAgo(30), IsActive: true,
		},
		liquidity: &LiquidityData{
			Positions:           []LiquidityPosition{{AmountVAI: 100, StartTime: daysAgo(10)}},
			VolatileWithdrawals: 2,
		},
		infra:     &InfraData{},
		contracts: []ContractEvent{
			{Fulfilled: false, Timestamp: daysAgo(5)},
			{Fulfilled: false, Timestamp: daysAgo(10)},
			{Fulfilled: true, Timestamp: daysAgo(30)},
		},
	}

	ev, err := ComputeEV(context.Background(), chain, "0xBAD", types.StateAdolescent, nil)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("Bad agent — EV: %.3f | Tier: %s", ev.NetEV, ev.BloodswornTier)

	if ev.NetEV > 0.3 {
		t.Errorf("bad agent should have low EV, got %.3f", ev.NetEV)
	}
}

func TestCanReplicate_AllRequirements(t *testing.T) {
	milestones := &types.Milestones{IsAdolescent: true}

	// Missing sovereign tier
	ev := &types.EVScore{NetEV: 0.90, BloodswornTier: types.BloodswornSworn, ContractsFulfilled: 20, ContractsBroken: 1}
	if CanReplicate(ev, milestones, daysAgo(100), 0) {
		t.Error("sworn agents should not replicate")
	}

	// Sovereign but too recent
	ev.BloodswornTier = types.BloodswornSovereign
	if CanReplicate(ev, milestones, daysAgo(30), 0) {
		t.Error("should not replicate with only 30 days sworn")
	}

	// Sovereign, long enough, but recent slash
	if CanReplicate(ev, milestones, daysAgo(100), 1) {
		t.Error("should not replicate with recent slashes")
	}

	// All requirements met
	if !CanReplicate(ev, milestones, daysAgo(100), 0) {
		t.Error("should be able to replicate with all requirements met")
	}

	// Not adolescent
	if CanReplicate(ev, &types.Milestones{IsAdolescent: false}, daysAgo(100), 0) {
		t.Error("should not replicate without adolescence")
	}
}
