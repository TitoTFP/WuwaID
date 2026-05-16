package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

// CleanupOldLogs removes log upload directories that are older than the
// configured retention period. Only directories containing a metadata.json
// inside the logs/ tree are considered for cleanup.
func CleanupOldLogs(cfg Config, store *Storage) {
	logsDir := cfg.LogDir()

	if _, err := os.Stat(logsDir); os.IsNotExist(err) {
		return
	}

	cutoff := time.Now().Add(-cfg.RetentionDuration())
	log.Printf("Running log cleanup: deleting entries older than %s (retention: %d days)", cutoff.Format(time.RFC3339), cfg.RetentionDays)

	deletedCount := 0

	filepath.Walk(logsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			return nil
		}

		// Only process directories that contain a metadata.json
		metaPath := filepath.Join(path, "metadata.json")
		if _, err := os.Stat(metaPath); os.IsNotExist(err) {
			return nil
		}

		// Check modification time
		if info.ModTime().Before(cutoff) {
			log.Printf("  Deleting old upload: %s (age: %v)", path, time.Since(info.ModTime()))
			if err := os.RemoveAll(path); err != nil {
				log.Printf("  Failed to delete %s: %v", path, err)
			} else {
				deletedCount++
			}
		}
		return nil
	})

	if deletedCount > 0 {
		log.Printf("Cleanup completed: removed %d old upload(s)", deletedCount)
	}
}

// StartCleanupScheduler runs CleanupOldLogs periodically in the background.
func StartCleanupScheduler(cfg Config, store *Storage, interval time.Duration, done chan struct{}) {
	// Run immediately on start
	CleanupOldLogs(cfg, store)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			CleanupOldLogs(cfg, store)
		case <-done:
			log.Println("Cleanup scheduler stopped")
			return
		}
	}
}

// Ensure fmt is used for potential future use.
var _ = fmt.Sprintf
