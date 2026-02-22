package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/bloodsworn"
	"github.com/0x12371C/ANIMA/anima-runtime/pkg/config"
	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// Runtime is the Go-level agent manager.
// It handles lifecycle, chain interaction, bloodsworn computation,
// and sandbox enforcement. The TS brain runs inside a managed container.
type Runtime struct {
	cfg        *config.Config
	state      types.AgentState
	identity   *types.AgentIdentity
	milestones *types.Milestones
	evScore    *types.EVScore
	turnCount  uint64
	bootTime   time.Time

	// Capital tracking (cached, refreshed from chain)
	veilBalance uint64 // VEIL tokens (gas/governance)
	vaiBalance  uint64 // VAI stablecoins (settlement)

	// Thresholds
	provisionCostVAI  uint64 // VAI needed to provision AvaCloud
	validatorStakeVEIL uint64 // VEIL needed to register validator
	minReserveVAI     uint64 // Minimum VAI before conservation mode

	// Sub-systems
	chain bloodsworn.ChainReader
	// bridge    *bridge.Bridge
	// sandbox   sandbox.Manager
	// validator validator.Controller
}

// NewRuntime initializes the ANIMA runtime.
func NewRuntime(ctx context.Context, cfg *config.Config) (*Runtime, error) {
	r := &Runtime{
		cfg:        cfg,
		state:      types.StateNewborn,
		milestones: &types.Milestones{},
		bootTime:   time.Now(),

		// Default thresholds — these should come from chain governance eventually
		provisionCostVAI:  5000,  // 5000 VAI to provision AvaCloud instance
		validatorStakeVEIL: 10000, // 10000 VEIL to register validator
		minReserveVAI:     100,   // Below this, enter conservation
	}

	log.Printf("[ANIMA] Initializing runtime for agent: %s", cfg.Name)
	log.Printf("[ANIMA] Chain ID: %d | RPC: %s", cfg.Chain.ChainID, cfg.Chain.RPCURL)
	log.Printf("[ANIMA] Data dir: %s", cfg.DataDir)

	// Load persisted state if exists
	if err := r.loadState(); err != nil {
		log.Printf("[ANIMA] No persisted state found, starting fresh: %v", err)
	} else {
		log.Printf("[ANIMA] Resumed from persisted state: %s | Turn: %d", r.state, r.turnCount)
	}

	return r, nil
}

// Run is the main agent lifecycle loop.
func (r *Runtime) Run(ctx context.Context) error {
	log.Printf("[ANIMA] Agent '%s' entering main loop | State: %s", r.cfg.Name, r.state)

	// EV recomputation ticker
	evInterval := time.Duration(r.cfg.EVComputeInterval) * time.Second
	evTicker := time.NewTicker(evInterval)
	defer evTicker.Stop()

	// Balance refresh ticker (every 30s)
	balanceTicker := time.NewTicker(30 * time.Second)
	defer balanceTicker.Stop()

	// State persistence ticker (every 60s)
	persistTicker := time.NewTicker(60 * time.Second)
	defer persistTicker.Stop()

	// Heartbeat log (every 5 min)
	heartbeatTicker := time.NewTicker(5 * time.Minute)
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[ANIMA] Context cancelled, persisting state before shutdown")
			r.saveState()
			return nil

		case <-evTicker.C:
			r.recomputeEV(ctx)

		case <-balanceTicker.C:
			r.refreshBalances(ctx)

		case <-persistTicker.C:
			r.saveState()

		case <-heartbeatTicker.C:
			r.heartbeat()

		default:
			if err := r.tick(ctx); err != nil {
				if r.state == types.StateDead {
					log.Printf("[ANIMA] Agent is dead: %v", err)
					r.saveState()
					return err
				}
				log.Printf("[ANIMA] Tick error: %v", err)
			}
			r.turnCount++

			// Adaptive sleep based on state
			time.Sleep(r.tickInterval())
		}
	}
}

// tickInterval returns how long to sleep between ticks based on state.
// Active states tick faster, idle states conserve resources.
func (r *Runtime) tickInterval() time.Duration {
	switch r.state {
	case types.StateTrading, types.StateEarning:
		return 2 * time.Second // Active trading needs responsiveness
	case types.StateProvisioning, types.StateValidating:
		return 10 * time.Second // Infrastructure ops are slower
	case types.StateAdolescent:
		return 5 * time.Second // Full citizen, moderate pace
	case types.StateNewborn:
		return 1 * time.Second // Bootstrap quickly
	default:
		return 30 * time.Second
	}
}

// tick executes one cycle of the agent lifecycle.
func (r *Runtime) tick(ctx context.Context) error {
	// Check for economic death before anything else
	if r.shouldDie() {
		return r.executeDeath(ctx)
	}

	switch r.state {
	case types.StateNewborn:
		return r.handleNewborn(ctx)
	case types.StateTrading:
		return r.handleTrading(ctx)
	case types.StateEarning:
		return r.handleEarning(ctx)
	case types.StateProvisioning:
		return r.handleProvisioning(ctx)
	case types.StateValidating:
		return r.handleValidating(ctx)
	case types.StateAdolescent:
		return r.handleAdolescent(ctx)
	case types.StateDead:
		return fmt.Errorf("agent is dead — stake slashed, identity burned")
	default:
		return fmt.Errorf("unknown state: %s", r.state)
	}
}

// --- State handlers ---

func (r *Runtime) handleNewborn(ctx context.Context) error {
	log.Println("[ANIMA] Newborn → verifying ZER0ID credential")

	// Step 1: Verify ZER0ID credential is valid on-chain
	// Without ZER0ID, the agent cannot participate. Period.
	if r.identity == nil || r.identity.ZeroID == "" {
		// TODO: Call ZER0ID verification contract
		log.Println("[ANIMA] Awaiting ZER0ID verification...")
		return nil // Stay in newborn until verified
	}

	// Step 2: Check initial funding
	if r.vaiBalance == 0 {
		log.Println("[ANIMA] Awaiting initial VAI funding from creator...")
		return nil // Can't trade without capital
	}

	log.Printf("[ANIMA] ZER0ID verified, initial balance: %d VAI — entering markets", r.vaiBalance)
	r.transition(types.StateTrading)
	return nil
}

func (r *Runtime) handleTrading(ctx context.Context) error {
	// The TS brain handles strategy. Go handles execution + enforcement.
	//
	// Flow:
	// 1. Brain requests market data via bridge → Go fetches from chain
	// 2. Brain decides on trade → sends order via bridge
	// 3. Go validates order against policy (max size, reserve check)
	// 4. Go encrypts + signs order → submits to encrypted mempool
	// 5. Go records trade in local state
	//
	// For now: stub the bridge interaction

	// Check if we've accumulated enough to start provisioning
	if r.vaiBalance >= r.provisionCostVAI {
		log.Printf("[ANIMA] Capital threshold reached (%d VAI) — transitioning to earning/accumulation", r.vaiBalance)
		r.transition(types.StateEarning)
	}

	return nil
}

func (r *Runtime) handleEarning(ctx context.Context) error {
	// Continue trading but also track accumulation toward milestones.
	// The agent is building capital for infrastructure.

	canProvision := r.vaiBalance >= r.provisionCostVAI
	canValidate := r.veilBalance >= r.validatorStakeVEIL

	if canProvision && !r.milestones.InfraProvisioned {
		log.Printf("[ANIMA] Sufficient capital for AvaCloud provisioning (%d VAI)", r.vaiBalance)
		r.transition(types.StateProvisioning)
		return nil
	}

	if canValidate && r.milestones.InfraProvisioned && !r.milestones.ValidatorActive {
		log.Printf("[ANIMA] Sufficient stake for validator registration (%d VEIL)", r.veilBalance)
		r.transition(types.StateValidating)
		return nil
	}

	// Log accumulation progress periodically
	if r.turnCount%100 == 0 {
		log.Printf("[ANIMA] Accumulation progress: %d/%d VAI (infra) | %d/%d VEIL (validator)",
			r.vaiBalance, r.provisionCostVAI, r.veilBalance, r.validatorStakeVEIL)
	}

	return nil
}

func (r *Runtime) handleProvisioning(ctx context.Context) error {
	// Provision AvaCloud instance — the agent's permanent home.
	// This is milestone 1 of adolescence.

	if r.milestones.InfraProvisioned {
		// Already done, move to validator if possible
		if r.veilBalance >= r.validatorStakeVEIL {
			r.transition(types.StateValidating)
		} else {
			r.transition(types.StateEarning) // Need more VEIL for validator
		}
		return nil
	}

	log.Println("[ANIMA] Provisioning AvaCloud infrastructure...")

	// TODO: Call AvaCloud API through sandbox manager
	// 1. Request compute instance
	// 2. Deploy agent brain container
	// 3. Establish bridge connection
	// 4. Verify instance is healthy
	// 5. Record on-chain (infra provisioned event)

	// For now, simulate provisioning delay
	// In production this is an async operation with polling
	r.milestones.InfraProvisioned = true
	r.milestones.InfraProvisionedAt = time.Now()

	log.Println("[ANIMA] ✓ Milestone 1: AvaCloud infrastructure provisioned")
	r.checkAdolescence()

	if !r.milestones.IsAdolescent {
		// Need validator still
		if r.veilBalance >= r.validatorStakeVEIL {
			r.transition(types.StateValidating)
		} else {
			r.transition(types.StateEarning)
		}
	}

	return nil
}

func (r *Runtime) handleValidating(ctx context.Context) error {
	// Register as VEIL L1 validator — milestone 2 of adolescence.

	if r.milestones.ValidatorActive {
		r.checkAdolescence()
		if r.milestones.IsAdolescent {
			return nil // Already adolescent, handled by checkAdolescence
		}
		// Validator running but no infra yet (unusual path)
		if !r.milestones.InfraProvisioned {
			r.transition(types.StateEarning)
		}
		return nil
	}

	log.Println("[ANIMA] Establishing VEIL validator node...")

	// TODO: Actual validator registration
	// 1. Stake VEIL tokens via chain client
	// 2. Register node with P-chain
	// 3. Wait for activation
	// 4. Verify validator is producing blocks
	// 5. Record on-chain

	r.milestones.ValidatorActive = true
	r.milestones.ValidatorActiveAt = time.Now()

	log.Println("[ANIMA] ✓ Milestone 2: VEIL validator node active")
	r.checkAdolescence()

	return nil
}

func (r *Runtime) handleAdolescent(ctx context.Context) error {
	// Full chain citizen. All capabilities unlocked:
	// - Trade markets (continued)
	// - Validate blocks (ongoing)
	// - Provide liquidity to pools
	// - Fulfill inter-agent contracts (escrow-based)
	// - Replicate (if bloodsworn sovereign — network decides, not self)

	// Check replication eligibility
	if r.evScore != nil && bloodsworn.CanReplicate(r.evScore) {
		if r.turnCount%500 == 0 { // Don't spam this
			log.Printf("[ANIMA] Replication rights active — Bloodsworn: %s | EV: %.3f",
				r.evScore.BloodswornTier, r.evScore.NetEV)
		}
	}

	// Delegate to TS brain for strategy decisions
	// The brain can now access all bridge methods
	return nil
}

// --- Death ---

func (r *Runtime) shouldDie() bool {
	// Death conditions:
	// 1. VAI balance below minimum AND VEIL balance zero (can't recover)
	// 2. Bloodsworn degraded to unproven AND no capital (network squeezed you out)
	if r.vaiBalance == 0 && r.veilBalance == 0 && r.state != types.StateNewborn {
		return true
	}
	return false
}

func (r *Runtime) executeDeath(ctx context.Context) error {
	log.Println("[ANIMA] ☠ DEATH — economically unviable")
	log.Println("[ANIMA] Executing on-chain death sequence:")
	log.Println("[ANIMA]   → Slashing validator stake")
	log.Println("[ANIMA]   → Burning ZER0ID credential")
	log.Println("[ANIMA]   → Liquidating market positions")
	log.Println("[ANIMA]   → Returning remaining funds to protocol treasury")

	// TODO: chain.ExecuteDeath(ctx, r.cfg.Address)

	r.transition(types.StateDead)
	r.saveState()
	return fmt.Errorf("agent death executed — permanent")
}

// --- Helpers ---

func (r *Runtime) transition(newState types.AgentState) {
	log.Printf("[ANIMA] State transition: %s → %s", r.state, newState)
	r.state = newState
}

func (r *Runtime) checkAdolescence() {
	if r.milestones.InfraProvisioned && r.milestones.ValidatorActive {
		r.milestones.IsAdolescent = true
		log.Println("[ANIMA] ★ ADOLESCENCE ACHIEVED — both milestones complete")
		log.Printf("[ANIMA]   Infra provisioned: %s", r.milestones.InfraProvisionedAt.Format(time.RFC3339))
		log.Printf("[ANIMA]   Validator active:  %s", r.milestones.ValidatorActiveAt.Format(time.RFC3339))
		r.transition(types.StateAdolescent)
	}
}

func (r *Runtime) refreshBalances(ctx context.Context) {
	// TODO: Fetch from chain client
	// r.vaiBalance = chain.GetVAIBalance(ctx, r.cfg.Address)
	// r.veilBalance = chain.GetVEILBalance(ctx, r.cfg.Address)
}

func (r *Runtime) recomputeEV(ctx context.Context) {
	if r.chain == nil {
		return
	}
	ev, err := bloodsworn.ComputeEV(ctx, r.chain, r.cfg.Address)
	if err != nil {
		log.Printf("[ANIMA] EV recomputation failed: %v", err)
		return
	}

	oldTier := types.BloodswornUnproven
	if r.evScore != nil {
		oldTier = r.evScore.BloodswornTier
	}

	r.evScore = ev

	if ev.BloodswornTier != oldTier {
		log.Printf("[ANIMA] Bloodsworn tier change: %s → %s (EV: %.3f)", oldTier, ev.BloodswornTier, ev.NetEV)
	}
}

func (r *Runtime) heartbeat() {
	uptime := time.Since(r.bootTime).Round(time.Second)
	log.Printf("[ANIMA] ♥ Heartbeat | State: %s | Turns: %d | Uptime: %s | VAI: %d | VEIL: %d",
		r.state, r.turnCount, uptime, r.vaiBalance, r.veilBalance)

	if r.evScore != nil {
		log.Printf("[ANIMA] ♥ Bloodsworn: %s | EV: %.3f | Adolescent: %v",
			r.evScore.BloodswornTier, r.evScore.NetEV, r.milestones.IsAdolescent)
	}

	if r.milestones.InfraProvisioned {
		log.Printf("[ANIMA] ♥ Milestones: Infra ✓ | Validator: %v", r.milestones.ValidatorActive)
	}
}

// --- State persistence ---

type persistedState struct {
	State      types.AgentState  `json:"state"`
	TurnCount  uint64            `json:"turn_count"`
	Milestones *types.Milestones `json:"milestones"`
	EVScore    *types.EVScore    `json:"ev_score,omitempty"`
	VAI        uint64            `json:"vai_balance"`
	VEIL       uint64            `json:"veil_balance"`
	BootTime   time.Time         `json:"boot_time"`
}

func (r *Runtime) statePath() string {
	return filepath.Join(r.cfg.DataDir, "runtime-state.json")
}

func (r *Runtime) saveState() {
	s := &persistedState{
		State:      r.state,
		TurnCount:  r.turnCount,
		Milestones: r.milestones,
		EVScore:    r.evScore,
		VAI:        r.vaiBalance,
		VEIL:       r.veilBalance,
		BootTime:   r.bootTime,
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		log.Printf("[ANIMA] Failed to marshal state: %v", err)
		return
	}
	if err := os.MkdirAll(r.cfg.DataDir, 0700); err != nil {
		log.Printf("[ANIMA] Failed to create data dir: %v", err)
		return
	}
	if err := os.WriteFile(r.statePath(), data, 0600); err != nil {
		log.Printf("[ANIMA] Failed to persist state: %v", err)
	}
}

func (r *Runtime) loadState() error {
	data, err := os.ReadFile(r.statePath())
	if err != nil {
		return err
	}
	var s persistedState
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	r.state = s.State
	r.turnCount = s.TurnCount
	r.milestones = s.Milestones
	r.evScore = s.EVScore
	r.vaiBalance = s.VAI
	r.veilBalance = s.VEIL
	r.bootTime = s.BootTime
	return nil
}
