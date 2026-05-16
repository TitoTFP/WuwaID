package main

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the log server.
type Config struct {
	Port          int
	DataDir       string
	MaxUploadMB   int
	RetentionDays int
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Port:          8080,
		DataDir:       defaultDataDir(),
		MaxUploadMB:   10,
		RetentionDays: 30,
	}
}

func defaultDataDir() string {
	home, _ := os.UserHomeDir()
	if home != "" {
		return home + "/wuwaid-log-data"
	}
	return "/var/lib/wuwaid-log-server"
}

// ConfigFromEnv reads configuration from environment variables.
// Only set variables override defaults; unset variables keep defaults.
func ConfigFromEnv() Config {
	cfg := DefaultConfig()

	if v := os.Getenv("WUWAID_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Port = p
		}
	}
	if v := os.Getenv("WUWAID_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("WUWAID_MAX_UPLOAD_MB"); v != "" {
		if m, err := strconv.Atoi(v); err == nil {
			cfg.MaxUploadMB = m
		}
	}
	if v := os.Getenv("WUWAID_RETENTION_DAYS"); v != "" {
		if d, err := strconv.Atoi(v); err == nil {
			cfg.RetentionDays = d
		}
	}

	return cfg
}

// MaxUploadBytes returns the maximum upload size in bytes.
func (c Config) MaxUploadBytes() int64 {
	return int64(c.MaxUploadMB) * 1024 * 1024
}

// RetentionDuration returns the retention period as a time.Duration.
func (c Config) RetentionDuration() time.Duration {
	return time.Duration(c.RetentionDays) * 24 * time.Hour
}

// LogDir returns the path to the logs directory within the data directory.
func (c Config) LogDir() string {
	return c.DataDir + "/logs"
}
