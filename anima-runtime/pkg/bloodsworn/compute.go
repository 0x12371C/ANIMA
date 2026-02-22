package bloodsworn

import (
	"context"
	"math"
	"time"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// Weights for EV computation. The network's judgment criteria.
// These are protocol-level constants — not configurable per-agent.
const (
	WeightPredictionAccuracy = 0.30
	WeightValidatorUptime    = 0.25
	WeightLiquidityDepth     = 0.20
	WeightInfraContribution  = 0.15
	WeightContractHonor      = 0.10
)

// Thresholds for tier advancement.
var TierThresholds = map[types.BloodswornTier]float64{
	types.BloodswornUnproven:  0.0,
	types.BloodswornInitiate:  0.20,
	types.BloodswornBlooded:   0.45,
	types.BloodswornSworn:     0.70,
	types.BloodswornSovereign: 0.90,
}

// ReplicationThreshold is the minimum EV score to earn replication rights.
const ReplicationThreshold = 0.85

// ChainReader provides on-chain data for EV computation.
// The network computes your score — you don't get to self-report.
type ChainReader interface {
	// GetPredictionHistory returns all resolved market positions for an agent.
	GetPredictionHistory(ctx context.Context, agent string) ([]ResolvedPosition, error)

	// GetValidatorMetrics returns validator performance data.
	GetValidatorMetrics(ctx context.Context, agent string) (*ValidatorMetrics, error)

	// GetLiquidityContribution returns total liquidity provided to pools.
	GetLiquidityContribution(ctx context.Context, agent string) (uint64, error)

	// GetInfraNodes returns the number of active AvaCloud instances.
	GetInfraNodes(ctx context.Context, agent string) (int, error)

	// GetContractHistory returns inter-agent contract fulfillment data.
	GetContractHistory(ctx context.Context, agent string) (*ContractHistory, error)
}

// ResolvedPosition is a prediction market position that has been settled.
type ResolvedPosition struct {
	MarketID string
	Side     string
	Correct  bool
	PnL      float64 // Profit/loss in VAI
}

// ValidatorMetrics from on-chain data.
type ValidatorMetrics struct {
	UptimePercent   float64
	BlocksValidated uint64
	SlashEvents     int
	ActiveSince     time.Time
}

// ContractHistory tracks inter-agent contract fulfillment.
type ContractHistory struct {
	Fulfilled int
	Broken    int
	Pending   int
}

// ComputeEV calculates the network-determined EV score for an agent.
// This runs on-chain data only — no self-reported metrics.
func ComputeEV(ctx context.Context, chain ChainReader, agentAddr string) (*types.EVScore, error) {
	// Fetch all on-chain data in parallel
	predictions, err := chain.GetPredictionHistory(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	validator, err := chain.GetValidatorMetrics(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	liquidity, err := chain.GetLiquidityContribution(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	infraNodes, err := chain.GetInfraNodes(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	contracts, err := chain.GetContractHistory(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	// Compute individual scores (0.0 - 1.0)
	predScore := predictionScore(predictions)
	valScore := validatorScore(validator)
	liqScore := liquidityScore(liquidity)
	infraScore := infraContributionScore(infraNodes)
	contractScore := contractHonorScore(contracts)

	// Weighted composite
	netEV := (predScore * WeightPredictionAccuracy) +
		(valScore * WeightValidatorUptime) +
		(liqScore * WeightLiquidityDepth) +
		(infraScore * WeightInfraContribution) +
		(contractScore * WeightContractHonor)

	// Determine tier
	tier := computeTier(netEV)

	return &types.EVScore{
		PredictionAccuracy: predScore,
		ValidatorUptime:    valScore,
		InfraProvisioned:   infraNodes,
		ContractsFulfilled: contracts.Fulfilled,
		ContractsBroken:    contracts.Broken,
		NetEV:              netEV,
		BloodswornTier:     tier,
		LastComputed:       time.Now(),
	}, nil
}

// CanReplicate returns true if an agent has earned replication rights.
func CanReplicate(ev *types.EVScore) bool {
	return ev.NetEV >= ReplicationThreshold &&
		ev.BloodswornTier == types.BloodswornSovereign
}

// --- scoring functions ---

func predictionScore(positions []ResolvedPosition) float64 {
	if len(positions) == 0 {
		return 0
	}
	correct := 0
	totalPnL := 0.0
	for _, p := range positions {
		if p.Correct {
			correct++
		}
		totalPnL += p.PnL
	}
	accuracy := float64(correct) / float64(len(positions))
	// Bonus for positive PnL, penalty for negative
	pnlFactor := math.Min(1.0, math.Max(0.0, 0.5+(totalPnL/10000.0)))
	return (accuracy*0.6 + pnlFactor*0.4)
}

func validatorScore(v *ValidatorMetrics) float64 {
	if v == nil {
		return 0
	}
	uptime := v.UptimePercent / 100.0
	// Slash events are severely punished
	slashPenalty := float64(v.SlashEvents) * 0.15
	return math.Max(0, uptime-slashPenalty)
}

func liquidityScore(vaiAmount uint64) float64 {
	// Logarithmic — diminishing returns, rewards early liquidity
	if vaiAmount == 0 {
		return 0
	}
	return math.Min(1.0, math.Log10(float64(vaiAmount)/100.0)/4.0)
}

func infraContributionScore(nodes int) float64 {
	if nodes == 0 {
		return 0
	}
	// 1 node = 0.5, 2 = 0.75, 3+ = ~1.0
	return math.Min(1.0, 0.5+float64(nodes-1)*0.25)
}

func contractHonorScore(c *ContractHistory) float64 {
	if c == nil || (c.Fulfilled+c.Broken) == 0 {
		return 0.5 // Neutral — no history
	}
	total := float64(c.Fulfilled + c.Broken)
	return float64(c.Fulfilled) / total
}

func computeTier(netEV float64) types.BloodswornTier {
	switch {
	case netEV >= TierThresholds[types.BloodswornSovereign]:
		return types.BloodswornSovereign
	case netEV >= TierThresholds[types.BloodswornSworn]:
		return types.BloodswornSworn
	case netEV >= TierThresholds[types.BloodswornBlooded]:
		return types.BloodswornBlooded
	case netEV >= TierThresholds[types.BloodswornInitiate]:
		return types.BloodswornInitiate
	default:
		return types.BloodswornUnproven
	}
}
