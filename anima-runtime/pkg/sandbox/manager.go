package sandbox

import (
	"context"
	"fmt"
)

// Manager controls the isolated container where the TS agent brain runs.
// This is the enforcement boundary — the brain cannot modify its own jail.
type Manager interface {
	// Create provisions a new sandbox for an agent brain.
	Create(ctx context.Context, opts CreateOpts) (*Sandbox, error)

	// Start launches the TS brain process inside the sandbox.
	Start(ctx context.Context, id string) error

	// Stop gracefully shuts down the brain.
	Stop(ctx context.Context, id string) error

	// Kill forcefully terminates (used when agent is -EV / dead).
	Kill(ctx context.Context, id string) error

	// Exec runs a command inside the sandbox (for the brain to use tools).
	// All commands are logged and policy-checked at the Go level.
	Exec(ctx context.Context, id string, cmd []string) (*ExecResult, error)

	// Health checks if the brain process is alive and responsive.
	Health(ctx context.Context, id string) (*HealthStatus, error)
}

// CreateOpts for provisioning a new sandbox.
type CreateOpts struct {
	AgentAddr   string            // VEIL L1 address (identity)
	Image       string            // Container image for TS brain
	MemoryMB    int               // Memory limit
	CPUShares   int               // CPU allocation
	Env         map[string]string // Environment variables (NO private keys — those stay in Go)
	NetworkMode string            // "veil" for chain access only, "none" for isolated
}

// Sandbox represents a running agent brain container.
type Sandbox struct {
	ID         string `json:"id"`
	AgentAddr  string `json:"agent_addr"`
	State      string `json:"state"` // created, running, stopped, dead
	PID        int    `json:"pid"`
	BridgeAddr string `json:"bridge_addr"` // IPC address for Go<->TS communication
}

// ExecResult from a sandboxed command.
type ExecResult struct {
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	Duration int64  `json:"duration_ms"`
}

// HealthStatus of the brain process.
type HealthStatus struct {
	Alive       bool   `json:"alive"`
	MemoryUsage int64  `json:"memory_bytes"`
	CPUPercent  float64 `json:"cpu_percent"`
	Uptime      int64  `json:"uptime_sec"`
	LastPing    int64  `json:"last_ping_ms"` // Latency to brain
}

// --- AvaCloud implementation ---

// AvaCloudManager manages agent sandboxes on AvaCloud infrastructure.
type AvaCloudManager struct {
	apiKey  string
	baseURL string
}

// NewAvaCloudManager creates a sandbox manager backed by AvaCloud.
func NewAvaCloudManager(apiKey, baseURL string) *AvaCloudManager {
	return &AvaCloudManager{
		apiKey:  apiKey,
		baseURL: baseURL,
	}
}

func (m *AvaCloudManager) Create(ctx context.Context, opts CreateOpts) (*Sandbox, error) {
	// TODO: Call AvaCloud API to provision compute instance
	return nil, fmt.Errorf("AvaCloud sandbox creation not yet implemented")
}

func (m *AvaCloudManager) Start(ctx context.Context, id string) error {
	return fmt.Errorf("not yet implemented")
}

func (m *AvaCloudManager) Stop(ctx context.Context, id string) error {
	return fmt.Errorf("not yet implemented")
}

func (m *AvaCloudManager) Kill(ctx context.Context, id string) error {
	return fmt.Errorf("not yet implemented")
}

func (m *AvaCloudManager) Exec(ctx context.Context, id string, cmd []string) (*ExecResult, error) {
	return nil, fmt.Errorf("not yet implemented")
}

func (m *AvaCloudManager) Health(ctx context.Context, id string) (*HealthStatus, error) {
	return nil, fmt.Errorf("not yet implemented")
}
