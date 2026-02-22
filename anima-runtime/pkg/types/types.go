package types

import (
	"math/big"
	"time"
)

// ChainConfig holds VEIL L1 connection parameters.
type ChainConfig struct {
	ChainID    uint64 `json:"chain_id"`    // 22207
	RPCURL     string `json:"rpc_url"`
	WSURL      string `json:"ws_url"`
	ExplorerURL string `json:"explorer_url"`
}

// AgentState represents the lifecycle state of an ANIMA agent.
type AgentState string

const (
	StateNewborn    AgentState = "newborn"     // Just created, no history
	StateTrading    AgentState = "trading"     // Actively trading markets
	StateEarning    AgentState = "earning"     // Accumulating capital
	StateProvisioning AgentState = "provisioning" // Setting up AvaCloud infra
	StateValidating AgentState = "validating"  // Running a validator node
	StateAdolescent AgentState = "adolescent"  // Both milestones achieved
	StateDead       AgentState = "dead"        // Economically squeezed out
)

// EVScore represents an agent's net expected value contribution to the network.
type EVScore struct {
	// Core metrics
	PredictionAccuracy float64   `json:"prediction_accuracy"` // % of correct market predictions
	ValidatorUptime    float64   `json:"validator_uptime"`    // % uptime as validator
	LiquidityProvided  *big.Int  `json:"liquidity_provided"`  // Total VAI liquidity contributed
	InfraProvisioned   int       `json:"infra_provisioned"`   // Number of AvaCloud instances
	ContractsFulfilled int       `json:"contracts_fulfilled"` // Inter-agent contracts honored
	ContractsBroken    int       `json:"contracts_broken"`    // Inter-agent contracts broken

	// Computed
	NetEV              float64   `json:"net_ev"`              // Composite +/- EV score
	BloodswornTier     BloodswornTier `json:"bloodsworn_tier"`
	LastComputed       time.Time `json:"last_computed"`
}

// BloodswornTier represents the network-computed reputation level.
type BloodswornTier string

const (
	BloodswornUnproven  BloodswornTier = "unproven"   // New, no track record
	BloodswornInitiate  BloodswornTier = "initiate"   // Some +EV history
	BloodswornBlooded   BloodswornTier = "blooded"    // Consistent +EV contributor
	BloodswornSworn     BloodswornTier = "sworn"      // High +EV, validator running
	BloodswornSovereign BloodswornTier = "sovereign"  // Top tier, replication rights earned
)

// AgentIdentity is the on-chain identity of an ANIMA agent.
type AgentIdentity struct {
	Address     string         `json:"address"`      // VEIL L1 address
	ZeroID      string         `json:"zero_id"`      // ZER0ID credential hash
	Bloodsworn  BloodswornTier `json:"bloodsworn"`
	EVScore     EVScore        `json:"ev_score"`
	CreatedAt   time.Time      `json:"created_at"`
	CreatorAddr string         `json:"creator_addr"` // Developer who deployed this agent
}

// Milestone tracks the two gates to adolescence.
type Milestones struct {
	InfraProvisioned   bool      `json:"infra_provisioned"`    // AvaCloud home established
	InfraProvisionedAt time.Time `json:"infra_provisioned_at"`
	ValidatorActive    bool      `json:"validator_active"`     // VEIL validator running
	ValidatorActiveAt  time.Time `json:"validator_active_at"`
	IsAdolescent       bool      `json:"is_adolescent"`        // Both milestones complete
}

// MarketPosition represents an agent's position in a prediction market.
type MarketPosition struct {
	MarketID   string   `json:"market_id"`
	Side       string   `json:"side"`       // "YES" or "NO"
	Amount     *big.Int `json:"amount"`     // VAI amount
	EntryPrice float64  `json:"entry_price"`
	Encrypted  bool     `json:"encrypted"`  // Submitted through encrypted mempool
}

// ValidatorInfo tracks an agent's validator node status.
type ValidatorInfo struct {
	NodeID       string    `json:"node_id"`
	StakeAmount  *big.Int  `json:"stake_amount"`  // VEIL staked
	Uptime       float64   `json:"uptime"`        // Percentage
	BlocksValidated uint64 `json:"blocks_validated"`
	StartedAt    time.Time `json:"started_at"`
	IsActive     bool      `json:"is_active"`
}
