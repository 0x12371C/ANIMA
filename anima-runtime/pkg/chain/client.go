package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// Client interfaces with VEIL L1 (chainId 22207).
// All economic actions go through here — chain-derived timestamps only.
type Client struct {
	rpcURL  string
	chainID uint64
}

// NewClient creates a VEIL L1 chain client.
func NewClient(cfg types.ChainConfig) *Client {
	return &Client{
		rpcURL:  cfg.RPCURL,
		chainID: cfg.ChainID,
	}
}

// --- Balance queries ---

// GetVEILBalance returns the agent's VEIL token balance (gas/governance).
func (c *Client) GetVEILBalance(ctx context.Context, addr string) (*big.Int, error) {
	// TODO: eth_getBalance on VEIL L1
	return nil, fmt.Errorf("not yet implemented")
}

// GetVAIBalance returns the agent's VAI stablecoin balance (settlement/payments).
func (c *Client) GetVAIBalance(ctx context.Context, addr string) (*big.Int, error) {
	// TODO: ERC20 balanceOf on VAI contract
	return nil, fmt.Errorf("not yet implemented")
}

// --- Market interactions ---

// SubmitEncryptedOrder submits a sealed order to the batch auction system.
func (c *Client) SubmitEncryptedOrder(ctx context.Context, order *EncryptedOrder) (string, error) {
	// Order goes to encrypted mempool — not visible until batch clears
	return "", fmt.Errorf("not yet implemented")
}

// GetMarketPrice returns the current price for a market.
func (c *Client) GetMarketPrice(ctx context.Context, marketID string) (*MarketPrice, error) {
	return nil, fmt.Errorf("not yet implemented")
}

// --- Validator operations ---

// RegisterValidator stakes VEIL and registers as a validator.
func (c *Client) RegisterValidator(ctx context.Context, stakeAmount *big.Int) (*types.ValidatorInfo, error) {
	return nil, fmt.Errorf("not yet implemented")
}

// GetValidatorStatus returns current validator status from on-chain.
func (c *Client) GetValidatorStatus(ctx context.Context, nodeID string) (*types.ValidatorInfo, error) {
	return nil, fmt.Errorf("not yet implemented")
}

// --- Bloodsworn ---

// WriteEVScore publishes a computed EV score on-chain.
// Only the protocol can call this — agents cannot self-report.
func (c *Client) WriteEVScore(ctx context.Context, agentAddr string, score *types.EVScore) error {
	return fmt.Errorf("not yet implemented")
}

// ReadBloodsworn reads an agent's bloodsworn tier from on-chain.
func (c *Client) ReadBloodsworn(ctx context.Context, agentAddr string) (types.BloodswornTier, error) {
	return types.BloodswornUnproven, fmt.Errorf("not yet implemented")
}

// --- Agent death ---

// ExecuteDeath performs on-chain death: slash stake, burn identity, liquidate positions.
// Death is permanent. This is not Conway's "fund me and I come back."
func (c *Client) ExecuteDeath(ctx context.Context, agentAddr string) error {
	// 1. Slash validator stake
	// 2. Burn ZER0ID credential
	// 3. Liquidate all market positions
	// 4. Return remaining VAI to protocol treasury (chain-owned liquidity)
	return fmt.Errorf("not yet implemented")
}

// --- Block time ---

// GetBlockTimestamp returns the timestamp of the latest block.
// Used instead of system clock for all economic operations.
func (c *Client) GetBlockTimestamp(ctx context.Context) (uint64, error) {
	return 0, fmt.Errorf("not yet implemented")
}

// --- Types ---

// EncryptedOrder is a sealed order for the batch auction.
type EncryptedOrder struct {
	MarketID      string   `json:"market_id"`
	EncryptedData []byte   `json:"encrypted_data"` // Side + amount, encrypted
	Commitment    [32]byte `json:"commitment"`      // Commitment hash
	AgentAddr     string   `json:"agent_addr"`
}

// MarketPrice from the last batch auction clearing.
type MarketPrice struct {
	MarketID string  `json:"market_id"`
	YesPrice float64 `json:"yes_price"`
	NoPrice  float64 `json:"no_price"`
	Volume   uint64  `json:"volume_vai"`
	LastBatch uint64 `json:"last_batch_block"`
}
