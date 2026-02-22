package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/0x12371C/ANIMA/anima-runtime/pkg/agent"
	"github.com/0x12371C/ANIMA/anima-runtime/pkg/config"
)

func main() {
	fmt.Println(`
    ▽ ANIMA Runtime v0.1.0
    Sovereign Agent Infrastructure for VEIL
    ────────────────────────────────────────
    No users. Only developers.
	`)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\n[ANIMA] Shutting down gracefully...")
		cancel()
	}()

	runtime, err := agent.NewRuntime(ctx, cfg)
	if err != nil {
		log.Fatalf("failed to initialize runtime: %v", err)
	}

	if err := runtime.Run(ctx); err != nil {
		log.Fatalf("runtime error: %v", err)
	}
}
