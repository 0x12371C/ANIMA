package bloodsworn

import (
	"context"
	"testing"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// --- Mock chain reader ---

type mockChain struct {
	predictions []ResolvedPosition
	validator   *ValidatorMetrics
	liquidity   uint64
	infraNodes  int
	contracts   *ContractHistory
}

func (m *mockChain) GetPredictionHistory(_ context.Context, _ string) ([]ResolvedPosition, error) {
	return m.predictions, nil
}
func (m *mockChain) GetValidatorMetrics(_ context.Context, _ string) (*ValidatorMetrics, error) {
	return m.validator, nil
}
func (m *mockChain) GetLiquidityContribution(_ context.Context, _ string) (uint64, error) {
	return m.liquidity, nil
}
func (m *mockChain) GetInfraNodes(_ context.Context, _ string) (int, error) {
	return m.infraNodes, nil
}
func (m *mockChain) GetContractHistory(_ context.Context, _ string) (*ContractHistory, error) {
	return m.contracts, nil
}

// --- Tests ---

func TestComputeEV_NewAgent(t *testing.T) {
	chain := &mockChain{
		predictions: nil,
		validator:   nil,
		liquidity:   0,
		infraNodes:  0,
		contracts:   &ContractHistory{},
	}

	ev, err := ComputeEV(context.Background(), chain, "0xNEWAGENT")
	if err != nil {
		t.Fatal(err)
	}

	if ev.BloodswornTier != types.BloodswornUnproven {
		t.Errorf("new agent should be unproven, got %s", ev.BloodswornTier)
	}
	if ev.NetEV > 0.2 {
		t.Errorf("new agent EV should be low, got %.3f", ev.NetEV)
	}
}

func TestComputeEV_StrongAgent(t *testing.T) {
	chain := &mockChain{
		predictions: []ResolvedPosition{
			{Correct: true, PnL: 500},
			{Correct: true, PnL: 300},
			{Correct: true, PnL: 200},
			{Correct: false, PnL: -100},
			{Correct: true, PnL: 400},
		},
		validator:  &ValidatorMetrics{UptimePercent: 99.5, BlocksValidated: 10000},
		liquidity:  50000,
		infraNodes: 2,
		contracts:  &ContractHistory{Fulfilled: 15, Broken: 1},
	}

	ev, err := ComputeEV(context.Background(), chain, "0xSTRONG")
	if err != nil {
		t.Fatal(err)
	}

	if ev.NetEV < 0.7 {
		t.Errorf("strong agent should have high EV, got %.3f", ev.NetEV)
	}
	if ev.BloodswornTier != types.BloodswornSworn && ev.BloodswornTier != types.BloodswornSovereign {
		t.Errorf("strong agent should be sworn or sovereign, got %s", ev.BloodswornTier)
	}
}

func TestComputeEV_BadAgent(t *testing.T) {
	chain := &mockChain{
		predictions: []ResolvedPosition{
			{Correct: false, PnL: -500},
			{Correct: false, PnL: -300},
			{Correct: false, PnL: -200},
			{Correct: true, PnL: 50},
		},
		validator:  &ValidatorMetrics{UptimePercent: 40.0, SlashEvents: 3},
		liquidity:  100,
		infraNodes: 0,
		contracts:  &ContractHistory{Fulfilled: 2, Broken: 8},
	}

	ev, err := ComputeEV(context.Background(), chain, "0xBAD")
	if err != nil {
		t.Fatal(err)
	}

	if ev.NetEV > 0.3 {
		t.Errorf("bad agent should have low EV, got %.3f", ev.NetEV)
	}
	if ev.BloodswornTier != types.BloodswornUnproven && ev.BloodswornTier != types.BloodswornInitiate {
		t.Errorf("bad agent should be unproven or initiate, got %s", ev.BloodswornTier)
	}
}

func TestCanReplicate_RequiresSovereign(t *testing.T) {
	// Not sovereign — can't replicate
	ev := &types.EVScore{NetEV: 0.80, BloodswornTier: types.BloodswornSworn}
	if CanReplicate(ev) {
		t.Error("sworn agents should not be able to replicate")
	}

	// Sovereign with high EV — can replicate
	ev = &types.EVScore{NetEV: 0.92, BloodswornTier: types.BloodswornSovereign}
	if !CanReplicate(ev) {
		t.Error("sovereign agents with high EV should be able to replicate")
	}

	// Sovereign but EV too low — can't replicate
	ev = &types.EVScore{NetEV: 0.80, BloodswornTier: types.BloodswornSovereign}
	if CanReplicate(ev) {
		t.Error("sovereign agents with low EV should not replicate")
	}
}

func TestTierThresholds(t *testing.T) {
	tests := []struct {
		ev   float64
		tier types.BloodswornTier
	}{
		{0.0, types.BloodswornUnproven},
		{0.10, types.BloodswornUnproven},
		{0.20, types.BloodswornInitiate},
		{0.44, types.BloodswornInitiate},
		{0.45, types.BloodswornBlooded},
		{0.69, types.BloodswornBlooded},
		{0.70, types.BloodswornSworn},
		{0.89, types.BloodswornSworn},
		{0.90, types.BloodswornSovereign},
		{1.0, types.BloodswornSovereign},
	}

	for _, tt := range tests {
		got := computeTier(tt.ev)
		if got != tt.tier {
			t.Errorf("EV %.2f: expected %s, got %s", tt.ev, tt.tier, got)
		}
	}
}

func TestPredictionScore_Empty(t *testing.T) {
	score := predictionScore(nil)
	if score != 0 {
		t.Errorf("empty predictions should score 0, got %.3f", score)
	}
}

func TestContractHonorScore_NoHistory(t *testing.T) {
	score := contractHonorScore(&ContractHistory{})
	if score != 0.5 {
		t.Errorf("no history should be neutral (0.5), got %.3f", score)
	}
}

func TestValidatorScore_WithSlashes(t *testing.T) {
	v := &ValidatorMetrics{UptimePercent: 95.0, SlashEvents: 2}
	score := validatorScore(v)
	expected := 0.95 - (2 * 0.15) // 0.65
	if score < expected-0.01 || score > expected+0.01 {
		t.Errorf("validator with 2 slashes: expected ~%.2f, got %.3f", expected, score)
	}
}
