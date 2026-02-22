package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
)

// Bridge handles communication between the Go runtime and the TS agent brain.
// Go owns the wallet, chain access, and enforcement.
// TS owns the intelligence — reasoning, strategy, tool selection.
//
// The brain NEVER has direct chain access or private keys.
// Every action goes through the bridge, where Go enforces policy.
type Bridge struct {
	listener net.Listener
	mu       sync.RWMutex
	handlers map[string]Handler
}

// Handler processes a request from the TS brain.
type Handler func(ctx context.Context, params json.RawMessage) (json.RawMessage, error)

// Request from the TS brain to the Go runtime.
type Request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// Response from Go runtime back to TS brain.
type Response struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *BridgeError    `json:"error,omitempty"`
}

// BridgeError returned when a request is denied or fails.
type BridgeError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// NewBridge creates a new Go<->TS bridge.
func NewBridge(socketPath string) (*Bridge, error) {
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		// Fallback to TCP for Windows
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, fmt.Errorf("failed to create bridge listener: %w", err)
		}
	}

	b := &Bridge{
		listener: listener,
		handlers: make(map[string]Handler),
	}

	// Register default handlers — these are the ONLY ways
	// the TS brain can interact with the outside world.
	b.registerDefaults()

	return b, nil
}

// Addr returns the bridge address for the TS brain to connect to.
func (b *Bridge) Addr() string {
	return b.listener.Addr().String()
}

// RegisterHandler adds a new method the brain can call.
func (b *Bridge) RegisterHandler(method string, handler Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[method] = handler
}

// Serve starts accepting connections from the TS brain.
func (b *Bridge) Serve(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return b.listener.Close()
		default:
		}

		conn, err := b.listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			continue
		}

		go b.handleConnection(ctx, conn)
	}
}

func (b *Bridge) handleConnection(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	for {
		var req Request
		if err := decoder.Decode(&req); err != nil {
			return
		}

		b.mu.RLock()
		handler, ok := b.handlers[req.Method]
		b.mu.RUnlock()

		var resp Response
		resp.ID = req.ID

		if !ok {
			resp.Error = &BridgeError{
				Code:    -1,
				Message: fmt.Sprintf("unknown method: %s", req.Method),
			}
		} else {
			result, err := handler(ctx, req.Params)
			if err != nil {
				resp.Error = &BridgeError{
					Code:    -2,
					Message: err.Error(),
				}
			} else {
				resp.Result = result
			}
		}

		if err := encoder.Encode(resp); err != nil {
			return
		}
	}
}

// registerDefaults sets up the allowed methods for the TS brain.
func (b *Bridge) registerDefaults() {
	// The brain can request these actions — Go decides whether to allow them.
	allowedMethods := []string{
		"market.getPrice",      // Read market data
		"market.submitOrder",   // Submit encrypted order (Go handles encryption + signing)
		"market.getPositions",  // Read own positions
		"balance.getVEIL",     // Read VEIL balance
		"balance.getVAI",      // Read VAI balance
		"identity.getScore",   // Read own bloodsworn score
		"identity.getState",   // Read own lifecycle state
		"validator.getStatus", // Read validator status
		"sandbox.exec",        // Execute tool (policy-checked by Go)
		"sandbox.readFile",    // Read file from sandbox
		"sandbox.writeFile",   // Write file in sandbox (Go checks path policy)
	}

	for _, method := range allowedMethods {
		m := method // capture
		b.RegisterHandler(m, func(ctx context.Context, params json.RawMessage) (json.RawMessage, error) {
			// TODO: Route to actual implementations with policy enforcement
			return nil, fmt.Errorf("%s: not yet implemented", m)
		})
	}
}
