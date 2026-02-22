package bloodsworn

import (
	"context"
	"math"
	"time"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// Protocol-level constants. Not configurable per-agent.
const (
	// Time decay half-lives
	PredictionHalfLifeDays = 30.0
	ContractRecencyDays    = 30.0
	ContractRecencyWeight  = 3.0

	// Validator
	SlashDecayBase       = 0.8  // Each slash multiplies by this
	StakeDurationTauDays = 90.0 // Duration factor time constant

	// Liquidity
	MaxVAIDays            = 1_000_000.0
	VolatilityPenalty     = 0.85

	// Infrastructure
	SingleNodeFactor = 0.6
	NodeFactorStep   = 0.2

	// Composite
	FloorThreshold = 0.2

	// Asymmetric momentum
	AlphaUp   = 0.1 // Slow climb
	AlphaDown = 0.5 // Fast fall

	// Tier hysteresis
	DemotionBuffer = 0.05

	// Replication
	ReplicationMinEV         = 0.85
	ReplicationMinDaysSworn  = 90
	ReplicationMinContractCₛ = 0.80
	ReplicationMaxRecentSlash = 0

	// Minimum sample sizes
	MinPredictionSamples = 10
)

// Tier thresholds
var TierThresholds = []struct {
	Tier      types.BloodswornTier
	Threshold float64
}{
	{types.BloodswornSovereign, 0.85},
	{types.BloodswornSworn, 0.65},
	{types.BloodswornBlooded, 0.45},
	{types.BloodswornInitiate, 0.20},
	{types.BloodswornUnproven, 0.0},
}

// Stage weights — what matters at each lifecycle phase
type stageWeights struct {
	Prediction float64
	Validator  float64
	Liquidity  float64
	Infra      float64
	Contract   float64
}

var stageWeightMap = map[types.AgentState]stageWeights{
	types.StateNewborn:  {0.50, 0.00, 0.20, 0.00, 0.30},
	types.StateTrading:  {0.50, 0.00, 0.20, 0.00, 0.30},
	types.StateEarning:  {0.35, 0.00, 0.25, 0.15, 0.25},
	types.StateProvisioning: {0.30, 0.00, 0.25, 0.20, 0.25},
	types.StateValidating:   {0.25, 0.20, 0.20, 0.15, 0.20},
	types.StateAdolescent:   {0.20, 0.25, 0.20, 0.15, 0.20},
}

// ChainReader provides on-chain data for EV computation.
// The network computes your score — you don't get to self-report.
type ChainReader interface {
	GetPredictionHistory(ctx context.Context, agent string) ([]ResolvedPosition, error)
	GetValidatorMetrics(ctx context.Context, agent string) (*ValidatorMetrics, error)
	GetLiquidityContribution(ctx context.Context, agent string) (*LiquidityData, error)
	GetInfraNodes(ctx context.Context, agent string) (*InfraData, error)
	GetContractHistory(ctx context.Context, agent string) ([]ContractEvent, error)
}

// --- On-chain data types ---

type ResolvedPosition struct {
	MarketID   string
	Side       string
	Correct    bool
	EntryPrice float64   // Price agent paid (0-1, represents confidence)
	PnL        float64   // Realized profit/loss in VAI
	Capital    float64   // Capital deployed
	ResolvedAt time.Time
}

type ValidatorMetrics struct {
	BlocksProduced  uint64
	BlocksExpected  uint64
	SlashEvents     int
	SlashTimestamps []time.Time
	StakeStarted    time.Time
	IsActive        bool
}

type LiquidityData struct {
	Positions           []LiquidityPosition
	VolatileWithdrawals int // Withdrawals during high-vol windows
}

type LiquidityPosition struct {
	AmountVAI float64
	StartTime time.Time
	EndTime   *time.Time // nil = still active
}

type InfraData struct {
	Nodes []InfraNode
}

type InfraNode struct {
	Active       bool
	UptimePercent float64
}

type ContractEvent struct {
	Fulfilled bool
	Timestamp time.Time
}

// ComputeEV calculates the network-determined EV score.
// All data from chain state. No self-reporting.
func ComputeEV(ctx context.Context, chain ChainReader, agentAddr string, agentState types.AgentState, previousEV *types.EVScore) (*types.EVScore, error) {
	now := time.Now()

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

	infra, err := chain.GetInfraNodes(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	contracts, err := chain.GetContractHistory(ctx, agentAddr)
	if err != nil {
		return nil, err
	}

	// Compute component scores
	pScore := predictionScore(predictions, now)
	vScore := validatorScore(validator, now)
	lScore := liquidityScore(liquidity, now)
	iScore := infraScore(infra)
	cScore := contractScore(contracts, now)

	// Weighted harmonic mean with stage-appropriate weights
	weights := stageWeightMap[agentState]
	if weights == (stageWeights{}) {
		weights = stageWeightMap[types.StateTrading] // fallback
	}

	rawEV := weightedHarmonicMean(
		[]float64{pScore, vScore, lScore, iScore, cScore},
		[]float64{weights.Prediction, weights.Validator, weights.Liquidity, weights.Infra, weights.Contract},
	)

	// Floor penalty — any active component below 0.2 tanks everything
	penalty := floorPenalty(
		[]float64{pScore, vScore, lScore, iScore, cScore},
		[]float64{weights.Prediction, weights.Validator, weights.Liquidity, weights.Infra, weights.Contract},
	)
	rawEV *= penalty

	// Asymmetric momentum smoothing
	finalEV := rawEV
	if previousEV != nil {
		finalEV = asymmetricSmooth(previousEV.NetEV, rawEV)
	}

	// Determine tier with hysteresis
	tier := computeTier(finalEV, previousEV)

	return &types.EVScore{
		PredictionAccuracy: pScore,
		ValidatorUptime:    vScore,
		InfraProvisioned:   countActiveNodes(infra),
		ContractsFulfilled: countFulfilled(contracts),
		ContractsBroken:    countBroken(contracts),
		NetEV:              finalEV,
		BloodswornTier:     tier,
		LastComputed:       now,
	}, nil
}

// CanReplicate checks ALL replication requirements.
func CanReplicate(ev *types.EVScore, milestones *types.Milestones, swornSince time.Time, recentSlashes int) bool {
	if ev.BloodswornTier != types.BloodswornSovereign {
		return false
	}
	if ev.NetEV < ReplicationMinEV {
		return false
	}
	if !milestones.IsAdolescent {
		return false
	}
	daysSworn := time.Since(swornSince).Hours() / 24
	if daysSworn < ReplicationMinDaysSworn {
		return false
	}
	if recentSlashes > ReplicationMaxRecentSlash {
		return false
	}
	// Contract honor check
	total := ev.ContractsFulfilled + ev.ContractsBroken
	if total > 0 {
		honor := float64(ev.ContractsFulfilled) / float64(total)
		if honor < ReplicationMinContractCₛ {
			return false
		}
	}
	return true
}

// --- Component scoring functions ---

// predictionScore uses a proper log scoring rule with time decay.
func predictionScore(positions []ResolvedPosition, now time.Time) float64 {
	n := len(positions)
	if n == 0 {
		return 0.5 // Neutral — no data
	}

	lambda := math.Ln2 / (PredictionHalfLifeDays * 24 * 3600) // per second

	var weightedSum, weightSum, totalPnL, totalCapital float64

	for _, p := range positions {
		// Time decay weight
		dt := now.Sub(p.ResolvedAt).Seconds()
		w := math.Exp(-lambda * dt)

		// Log scoring rule (proper scoring rule)
		var s float64
		price := clamp(p.EntryPrice, 0.01, 0.99) // Avoid log(0)
		if p.Correct {
			s = math.Log(price)
		} else {
			s = math.Log(1 - price)
		}

		weightedSum += s * w
		weightSum += w
		totalPnL += p.PnL
		totalCapital += p.Capital
	}

	if weightSum == 0 {
		return 0.5
	}

	// Time-decayed mean log score
	meanLogScore := weightedSum / weightSum

	// Sigmoid mapping: log score ∈ (-∞, 0] → (0, 1]
	// Perfect score (all correct at high confidence) → ~0.95
	// Random guessing → ~0.5
	// Terrible predictions → ~0.05
	rawScore := sigmoid(meanLogScore + 0.5) // +0.5 centers neutral at ~0.5

	// ROI adjustment (±30%)
	roi := 0.0
	if totalCapital > 0 {
		roi = totalPnL / totalCapital
	}
	roiFactor := 0.7 + 0.3*clamp(roi, -1, 1)

	score := rawScore * roiFactor

	// Minimum sample ramp
	if n < MinPredictionSamples {
		score = 0.5 + (score-0.5)*float64(n)/float64(MinPredictionSamples)
	}

	return clamp(score, 0, 1)
}

// validatorScore: uptime × slash decay × stake duration.
func validatorScore(v *ValidatorMetrics, now time.Time) float64 {
	if v == nil || !v.IsActive {
		return 0 // No validator = 0 (excluded from composite via weights)
	}

	// Base: epoch participation rate
	base := 0.0
	if v.BlocksExpected > 0 {
		base = float64(v.BlocksProduced) / float64(v.BlocksExpected)
	}

	// Slash penalty: exponential compound
	slashFactor := math.Pow(SlashDecayBase, float64(v.SlashEvents))

	// Stake duration factor: asymptotic approach to 1.0
	stakeDays := now.Sub(v.StakeStarted).Hours() / 24
	durationFactor := 1 - math.Exp(-stakeDays/StakeDurationTauDays)

	return clamp(base*slashFactor*durationFactor, 0, 1)
}

// liquidityScore: VAI-days with logarithmic scaling.
func liquidityScore(data *LiquidityData, now time.Time) float64 {
	if data == nil || len(data.Positions) == 0 {
		return 0
	}

	// Compute total VAI-days
	var vaiDays float64
	for _, pos := range data.Positions {
		end := now
		if pos.EndTime != nil {
			end = *pos.EndTime
		}
		days := end.Sub(pos.StartTime).Hours() / 24
		if days > 0 {
			vaiDays += pos.AmountVAI * days
		}
	}

	// Logarithmic scaling (diminishing returns)
	score := math.Log(1+vaiDays/1000) / math.Log(1+MaxVAIDays/1000)

	// Volatile withdrawal penalty (compounds)
	for i := 0; i < data.VolatileWithdrawals; i++ {
		score *= VolatilityPenalty
	}

	return clamp(score, 0, 1)
}

// infraScore: binary milestones with ongoing health.
func infraScore(data *InfraData) float64 {
	if data == nil || len(data.Nodes) == 0 {
		return 0
	}

	activeCount := 0
	var totalUptime float64

	for _, node := range data.Nodes {
		if node.Active {
			activeCount++
			totalUptime += node.UptimePercent / 100.0
		}
	}

	if activeCount == 0 {
		return 0
	}

	avgUptime := totalUptime / float64(activeCount)

	// Node count factor
	nodeFactor := math.Min(1.0, SingleNodeFactor+NodeFactorStep*float64(activeCount-1))

	return clamp(avgUptime*nodeFactor, 0, 1)
}

// contractScore: Bayesian Beta distribution with recency bias on broken contracts.
func contractScore(events []ContractEvent, now time.Time) float64 {
	if len(events) == 0 {
		return 0.5 // Neutral — Beta(1,1) MAP
	}

	alpha := 1.0 // Prior
	beta := 1.0

	for _, e := range events {
		if e.Fulfilled {
			alpha++
		} else {
			// Recency bias: recent broken contracts count 3×
			daysSince := now.Sub(e.Timestamp).Hours() / 24
			if daysSince < ContractRecencyDays {
				beta += ContractRecencyWeight
			} else {
				beta++
			}
		}
	}

	// MAP estimate of Beta(α, β)
	if alpha+beta <= 2 {
		return 0.5
	}
	return (alpha - 1) / (alpha + beta - 2)
}

// --- Composite aggregation ---

// weightedHarmonicMean computes the weighted harmonic mean,
// excluding components with zero weight.
func weightedHarmonicMean(scores, weights []float64) float64 {
	var wSum, recipSum float64

	for i := range scores {
		if weights[i] <= 0 {
			continue // Skip inactive components
		}
		s := scores[i]
		if s <= 0.001 {
			s = 0.001 // Avoid division by zero, but still punish heavily
		}
		wSum += weights[i]
		recipSum += weights[i] / s
	}

	if wSum == 0 || recipSum == 0 {
		return 0
	}

	return wSum / recipSum
}

// floorPenalty applies multiplicative penalty for any active component below threshold.
func floorPenalty(scores, weights []float64) float64 {
	penalty := 1.0
	for i := range scores {
		if weights[i] <= 0 {
			continue
		}
		if scores[i] < FloorThreshold {
			penalty *= scores[i] / FloorThreshold
		}
	}
	return clamp(penalty, 0, 1)
}

// asymmetricSmooth applies fast-fall, slow-climb smoothing.
func asymmetricSmooth(current, new float64) float64 {
	if new > current {
		return current + AlphaUp*(new-current)
	}
	return current + AlphaDown*(new-current)
}

// computeTier with hysteresis to prevent oscillation.
func computeTier(ev float64, previous *types.EVScore) types.BloodswornTier {
	var prevTier types.BloodswornTier
	if previous != nil {
		prevTier = previous.BloodswornTier
	}

	// Check promotion (standard thresholds)
	for _, t := range TierThresholds {
		if ev >= t.Threshold {
			// If this would be a demotion, require extra buffer
			if previous != nil && tierRank(t.Tier) < tierRank(prevTier) {
				// Demotion: must be DemotionBuffer below the CURRENT tier's threshold
				currentThreshold := tierThreshold(prevTier)
				if ev >= currentThreshold-DemotionBuffer {
					return prevTier // Hold current tier (hysteresis)
				}
			}
			return t.Tier
		}
	}

	return types.BloodswornUnproven
}

// --- Utilities ---

func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x*3)) // Steepness factor 3
}

func clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}

func tierRank(t types.BloodswornTier) int {
	switch t {
	case types.BloodswornSovereign:
		return 4
	case types.BloodswornSworn:
		return 3
	case types.BloodswornBlooded:
		return 2
	case types.BloodswornInitiate:
		return 1
	default:
		return 0
	}
}

func tierThreshold(t types.BloodswornTier) float64 {
	for _, tt := range TierThresholds {
		if tt.Tier == t {
			return tt.Threshold
		}
	}
	return 0
}

func countActiveNodes(data *InfraData) int {
	if data == nil {
		return 0
	}
	count := 0
	for _, n := range data.Nodes {
		if n.Active {
			count++
		}
	}
	return count
}

func countFulfilled(events []ContractEvent) int {
	c := 0
	for _, e := range events {
		if e.Fulfilled {
			c++
		}
	}
	return c
}

func countBroken(events []ContractEvent) int {
	c := 0
	for _, e := range events {
		if !e.Fulfilled {
			c++
		}
	}
	return c
}
