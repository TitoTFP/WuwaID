package main

import (
	"os"
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Port != 8080 {
		t.Errorf("default Port = %d; want 8080", cfg.Port)
	}
	if cfg.DataDir == "" {
		t.Error("default DataDir should not be empty")
	}
	if cfg.MaxUploadMB != 10 {
		t.Errorf("default MaxUploadMB = %d; want 10", cfg.MaxUploadMB)
	}
	if cfg.RetentionDays != 30 {
		t.Errorf("default RetentionDays = %d; want 30", cfg.RetentionDays)
	}
}

func TestConfigFromEnv(t *testing.T) {
	// Set env vars
	os.Setenv("WUWAID_PORT", "9090")
	os.Setenv("WUWAID_DATA_DIR", "/tmp/wuwaid-test-data")
	os.Setenv("WUWAID_MAX_UPLOAD_MB", "20")
	os.Setenv("WUWAID_RETENTION_DAYS", "14")
	defer func() {
		os.Unsetenv("WUWAID_PORT")
		os.Unsetenv("WUWAID_DATA_DIR")
		os.Unsetenv("WUWAID_MAX_UPLOAD_MB")
		os.Unsetenv("WUWAID_RETENTION_DAYS")
	}()

	cfg := ConfigFromEnv()

	if cfg.Port != 9090 {
		t.Errorf("env Port = %d; want 9090", cfg.Port)
	}
	if cfg.DataDir != "/tmp/wuwaid-test-data" {
		t.Errorf("env DataDir = %s; want /tmp/wuwaid-test-data", cfg.DataDir)
	}
	if cfg.MaxUploadMB != 20 {
		t.Errorf("env MaxUploadMB = %d; want 20", cfg.MaxUploadMB)
	}
	if cfg.RetentionDays != 14 {
		t.Errorf("env RetentionDays = %d; want 14", cfg.RetentionDays)
	}
}

func TestConfigFromEnvPartial(t *testing.T) {
	// Only set one var, rest should be defaults
	os.Setenv("WUWAID_PORT", "3000")
	defer os.Unsetenv("WUWAID_PORT")

	cfg := ConfigFromEnv()

	if cfg.Port != 3000 {
		t.Errorf("env Port = %d; want 3000", cfg.Port)
	}
	if cfg.MaxUploadMB != 10 {
		t.Errorf("default MaxUploadMB = %d; want 10 (not overridden)", cfg.MaxUploadMB)
	}
	if cfg.RetentionDays != 30 {
		t.Errorf("default RetentionDays = %d; want 30 (not overridden)", cfg.RetentionDays)
	}
}

func TestConfigMaxUploadBytes(t *testing.T) {
	cfg := Config{MaxUploadMB: 5}
	want := int64(5 * 1024 * 1024)
	if got := cfg.MaxUploadBytes(); got != want {
		t.Errorf("MaxUploadBytes() = %d; want %d", got, want)
	}
}

func TestConfigRetentionDuration(t *testing.T) {
	cfg := Config{RetentionDays: 7}
	want := 7 * 24 * time.Hour
	if got := cfg.RetentionDuration(); got != want {
		t.Errorf("RetentionDuration() = %v; want %v", got, want)
	}
}

func TestConfigLogDir(t *testing.T) {
	cfg := Config{DataDir: "/data"}
	want := "/data/logs"
	if got := cfg.LogDir(); got != want {
		t.Errorf("LogDir() = %s; want %s", got, want)
	}
}
