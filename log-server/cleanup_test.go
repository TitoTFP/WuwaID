package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanupOldLogs(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir
	cfg.RetentionDays = 7

	// Create a log entry that looks old
	oldDir := filepath.Join(dir, "logs", "v1.0.0", "20260501", "old-upload-001")
	err := os.MkdirAll(oldDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(oldDir, "launcher-20260501.log")
	os.WriteFile(oldFile, []byte("old log content"), 0644)
	os.WriteFile(filepath.Join(oldDir, "metadata.json"), []byte(`{"app_version":"v1.0.0"}`), 0644)

	// Set modification time to 15 days ago
	fifteenDaysAgo := time.Now().Add(-15 * 24 * time.Hour)
	os.Chtimes(oldDir, fifteenDaysAgo, fifteenDaysAgo)
	os.Chtimes(oldFile, fifteenDaysAgo, fifteenDaysAgo)

	// Create a recent log entry
	recentDir := filepath.Join(dir, "logs", "v2.0.0", "20260516", "recent-upload-001")
	err = os.MkdirAll(recentDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	recentFile := filepath.Join(recentDir, "launcher-20260516.log")
	os.WriteFile(recentFile, []byte("recent log content"), 0644)
	os.WriteFile(filepath.Join(recentDir, "metadata.json"), []byte(`{"app_version":"v2.0.0"}`), 0644)

	// Run cleanup
	CleanupOldLogs(cfg, store)

	// Old logs should be gone
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Errorf("expected old log directory to be deleted, but it still exists")
	}

	// Recent logs should remain
	if _, err := os.Stat(recentDir); os.IsNotExist(err) {
		t.Errorf("expected recent log directory to exist, but it was deleted")
	}
}

func TestCleanupKeepsRecentLogs(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir
	cfg.RetentionDays = 30

	// Create a log from 5 days ago (should be kept)
	fiveDaysAgo := time.Now().Add(-5 * 24 * time.Hour)
	recentDir := filepath.Join(dir, "logs", "v2.0.0", fiveDaysAgo.Format("20060102"), "recent-upload")
	err := os.MkdirAll(recentDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(recentDir, "launcher.log"), []byte("recent"), 0644)
	os.WriteFile(filepath.Join(recentDir, "metadata.json"), []byte("{}"), 0644)
	os.Chtimes(recentDir, fiveDaysAgo, fiveDaysAgo)

	CleanupOldLogs(cfg, store)

	if _, err := os.Stat(recentDir); os.IsNotExist(err) {
		t.Errorf("expected logs within retention period to be kept")
	}
}

func TestCleanupBoundary(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir
	cfg.RetentionDays = 7

	// Well within retention period (1 day ago) — must be kept
	recentTime := time.Now().Add(-24 * time.Hour)
	recentDir := filepath.Join(dir, "logs", "v2.0.0", recentTime.Format("20060102"), "recent-upload")
	err := os.MkdirAll(recentDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(recentDir, "launcher.log"), []byte("recent"), 0644)
	os.WriteFile(filepath.Join(recentDir, "metadata.json"), []byte("{}"), 0644)
	os.Chtimes(recentDir, recentTime, recentTime)

	// Beyond retention period (14 days ago) — must be deleted
	oldTime := time.Now().Add(-14 * 24 * time.Hour)
	oldDir := filepath.Join(dir, "logs", "v1.0.0", oldTime.Format("20060102"), "old-upload")
	err = os.MkdirAll(oldDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(oldDir, "launcher.log"), []byte("old"), 0644)
	os.WriteFile(filepath.Join(oldDir, "metadata.json"), []byte("{}"), 0644)
	os.Chtimes(oldDir, oldTime, oldTime)

	CleanupOldLogs(cfg, store)

	// Recent should still exist
	if _, err := os.Stat(recentDir); os.IsNotExist(err) {
		t.Errorf("expected recent logs to be kept")
	}

	// Old should be deleted
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Errorf("expected old logs to be deleted")
	}
}

func TestCleanupEmptyStorage(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir

	// Should not panic on empty storage
	CleanupOldLogs(cfg, store)
}

func TestCleanupOnlyDeletesLogDirs(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir
	cfg.RetentionDays = 7

	// Create a non-log file in the root logs dir
	otherFile := filepath.Join(dir, "logs", "other.txt")
	os.MkdirAll(filepath.Dir(otherFile), 0755)
	os.WriteFile(otherFile, []byte("should not be deleted"), 0644)

	oldDir := filepath.Join(dir, "logs", "v1.0.0", "20260501", "old-upload")
	os.MkdirAll(oldDir, 0755)
	os.WriteFile(filepath.Join(oldDir, "launcher.log"), []byte("old"), 0644)
	os.WriteFile(filepath.Join(oldDir, "metadata.json"), []byte("{}"), 0644)

	oldTime := time.Now().Add(-15 * 24 * time.Hour)
	os.Chtimes(oldDir, oldTime, oldTime)

	CleanupOldLogs(cfg, store)

	// Other file should still exist
	if _, err := os.Stat(otherFile); os.IsNotExist(err) {
		t.Errorf("expected non-log files to be preserved")
	}
}

func TestStartCleanupSchedulerRuns(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir
	cfg.RetentionDays = 7

	// Create an old log entry (15 days ago)
	oldDir := filepath.Join(dir, "logs", "v1.0.0", "20260501", "old-upload")
	err := os.MkdirAll(oldDir, 0755)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(oldDir, "launcher.log"), []byte("old"), 0644)
	os.WriteFile(filepath.Join(oldDir, "metadata.json"), []byte("{}"), 0644)
	oldTime := time.Now().Add(-15 * 24 * time.Hour)
	os.Chtimes(oldDir, oldTime, oldTime)

	// Create a recent log entry (1 day ago)
	recentTime := time.Now().Add(-24 * time.Hour)
	recentDir := filepath.Join(dir, "logs", "v2.0.0", recentTime.Format("20060102"), "recent-upload")
	os.MkdirAll(recentDir, 0755)
	os.WriteFile(filepath.Join(recentDir, "launcher.log"), []byte("recent"), 0644)
	os.WriteFile(filepath.Join(recentDir, "metadata.json"), []byte("{}"), 0644)
	os.Chtimes(recentDir, recentTime, recentTime)

	done := make(chan struct{})
	go StartCleanupScheduler(cfg, store, 50*time.Millisecond, done)

	// Wait for at least 2 ticks (100ms) to let cleanup run
	time.Sleep(150 * time.Millisecond)
	close(done)

	// Old log should be deleted by the scheduler
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Errorf("expected old log to be cleaned up by scheduler, but it still exists")
	}

	// Recent log should remain
	if _, err := os.Stat(recentDir); os.IsNotExist(err) {
		t.Errorf("expected recent log to be preserved by scheduler, but it was deleted")
	}
}

func TestStartCleanupSchedulerStopsOnDone(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := DefaultConfig()
	cfg.DataDir = dir

	done := make(chan struct{})
	go StartCleanupScheduler(cfg, store, 10*time.Hour, done)

	// Close immediately — should stop without panic
	close(done)

	// Give it a moment to process the done signal
	time.Sleep(10 * time.Millisecond)

	// If we got here without panic/timeout, the scheduler stopped gracefully
}
