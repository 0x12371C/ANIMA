package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/types"
)

// Config holds all ANIMA runtime configuration.
type Config struct {
	// Agent identity
	Name        string `json:"name"`
	Address     string `json:"address"`
	CreatorAddr string `json:"creator_addr"`

	// Chain
	Chain types.ChainConfig `json:"chain"`

	// AvaCloud
	AvaCloudAPIKey  string `json:"avacloud_api_key"`
	AvaCloudBaseURL string `json:"avacloud_base_url"`

	// Paths
	DataDir    string `json:"data_dir"`
	BrainSocket string `json:"brain_socket"` // Unix socket / named pipe to TS brain

	// Limits
	MaxVAIPerTrade    string `json:"max_vai_per_trade"`     // Max VAI per single trade
	MaxDailySpend     string `json:"max_daily_spend"`       // Max VAI daily spend
	MinReserve        string `json:"min_reserve"`           // Minimum VAI reserve before conservation

	// Bloodsworn
	EVComputeInterval int `json:"ev_compute_interval_sec"` // How often to recompute EV score

	// Sandbox
	SandboxEnabled bool   `json:"sandbox_enabled"`
	SandboxImage   string `json:"sandbox_image"` // Container image for agent brain

	// Logging
	LogLevel string `json:"log_level"` // debug, info, warn, error
}

// DefaultConfig returns a config with VEIL L1 defaults.
func DefaultConfig() *Config {
	return &Config{
		Chain: types.ChainConfig{
			ChainID:    22207,
			RPCURL:     "http://127.0.0.1:9650/ext/bc/VEIL/rpc",
			WSURL:      "ws://127.0.0.1:9650/ext/bc/VEIL/ws",
		},
		AvaCloudBaseURL:   "https://api.avacloud.io",
		DataDir:           defaultDataDir(),
		EVComputeInterval: 300, // 5 minutes
		SandboxEnabled:    true,
		LogLevel:          "info",
		MaxVAIPerTrade:    "1000",
		MaxDailySpend:     "10000",
		MinReserve:        "100",
	}
}

// Load reads config from ~/.anima/config.json, creating defaults if missing.
func Load() (*Config, error) {
	cfg := DefaultConfig()
	path := filepath.Join(cfg.DataDir, "config.json")

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// First run — write defaults
			if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
				return nil, fmt.Errorf("create data dir: %w", err)
			}
			if err := cfg.Save(); err != nil {
				return nil, fmt.Errorf("save default config: %w", err)
			}
			return cfg, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	return cfg, nil
}

// Save writes the config to disk.
func (c *Config) Save() error {
	path := filepath.Join(c.DataDir, "config.json")
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(path, data, 0600)
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".anima"
	}
	return filepath.Join(home, ".anima")
}
