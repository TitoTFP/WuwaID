package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// BuildInfo is set at build time via -ldflags.
var BuildInfo = "dev"

func main() {
	cfg := ConfigFromEnv()
	store := NewStorage(cfg.DataDir)

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory %s: %v", cfg.DataDir, err)
	}

	// Start background cleanup (every 6 hours)
	done := make(chan struct{})
	go StartCleanupScheduler(cfg, store, 6*time.Hour, done)

	srv := NewServer(cfg, store)
	addr := fmt.Sprintf(":%d", cfg.Port)

	log.Printf("🚀 WuwaID Log Server v%s starting on %s", BuildInfo, addr)
	log.Printf("   Data directory: %s", cfg.DataDir)
	log.Printf("   Max upload size: %d MB", cfg.MaxUploadMB)
	log.Printf("   Log retention: %d days", cfg.RetentionDays)
	log.Printf("   Endpoints:")
	log.Printf("     POST /api/logs  - Upload log archive")
	log.Printf("     GET  /api/logs  - List uploaded logs (JSON)")
	log.Printf("     GET  /health    - Health check")

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Shutting down...")
		close(done)
		os.Exit(0)
	}()

	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
