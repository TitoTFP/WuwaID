package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LogMeta stores metadata about a single log upload session.
type LogMeta struct {
	ID          string `json:"id"`
	AppVersion  string `json:"app_version"`
	Timestamp   string `json:"timestamp"`
	OS          string `json:"os"`
	FileCount   int    `json:"file_count"`
	TotalBytes  int64  `json:"total_bytes"`
	CreatedAt   string `json:"created_at"`
	StoragePath string `json:"-"`
}

// Storage handles reading and writing log uploads to disk.
type Storage struct {
	dataDir string
}

// NewStorage creates a new Storage rooted at dataDir.
func NewStorage(dataDir string) *Storage {
	return &Storage{dataDir: dataDir}
}

// generateID creates a short random hex ID for an upload.
func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// SaveLogUpload saves an uploaded zip of log files to disk and returns metadata.
// It extracts the zip contents into: {logsDir}/{appVersion}/{date}/{id}/
func (s *Storage) SaveLogUpload(appVersion, timestamp, osName string, zipData []byte) (LogMeta, error) {
	files, err := extractZipEntries(zipData)
	if err != nil {
		return LogMeta{}, fmt.Errorf("invalid zip: %w", err)
	}
	if len(files) == 0 {
		return LogMeta{}, fmt.Errorf("zip archive contains no files")
	}

	id := generateID()

	// Extract date from timestamp (format: YYYYMMDDTHHMMSS or YYYYMMDD_HHMMSS)
	datePart := timestamp
	if idx := strings.Index(timestamp, "T"); idx >= 0 {
		datePart = timestamp[:idx]
	}
	if idx := strings.Index(timestamp, "_"); idx >= 0 && len(timestamp[:idx]) == 8 {
		datePart = timestamp[:idx]
	}
	if datePart == timestamp && len(timestamp) > 8 {
		datePart = timestamp[:8]
	}
	if len(datePart) == 0 {
		datePart = "unknown"
	}

	// Build path: logs/{appVersion}/{date}/{id}/
	relPath := filepath.Join("logs", appVersion, datePart, id)
	fullPath := filepath.Join(s.dataDir, relPath)

	if err := os.MkdirAll(fullPath, 0755); err != nil {
		return LogMeta{}, fmt.Errorf("creating storage directory: %w", err)
	}

	// Extract zip files into the directory
	var totalBytes int64
	fileCount := 0
	for _, entry := range files {
		cleanName := filepath.Clean(entry.Name)
		if strings.Contains(cleanName, "..") {
			continue // prevent path traversal
		}
		destPath := filepath.Join(fullPath, cleanName)

		// Ensure we're still within the target directory
		if !strings.HasPrefix(destPath, filepath.Clean(fullPath)+string(filepath.Separator)) {
			continue
		}

		if err := os.WriteFile(destPath, entry.Data, 0644); err != nil {
			return LogMeta{}, fmt.Errorf("writing log file: %w", err)
		}
		totalBytes += int64(len(entry.Data))
		fileCount++
	}

	meta := LogMeta{
		ID:          id,
		AppVersion:  appVersion,
		Timestamp:   timestamp,
		OS:          osName,
		FileCount:   fileCount,
		TotalBytes:  totalBytes,
		CreatedAt:   timestamp,
		StoragePath: fullPath,
	}

	// Write metadata.json alongside the log files
	metaData, err := json.Marshal(meta)
	if err != nil {
		return LogMeta{}, fmt.Errorf("marshaling metadata: %w", err)
	}
	if err := os.WriteFile(filepath.Join(fullPath, "metadata.json"), metaData, 0644); err != nil {
		return LogMeta{}, fmt.Errorf("writing metadata: %w", err)
	}

	return meta, nil
}

// ListUploads returns all upload metadata, sorted by timestamp descending (newest first).
func (s *Storage) ListUploads() ([]LogMeta, error) {
	logsDir := filepath.Join(s.dataDir, "logs")

	if _, err := os.Stat(logsDir); os.IsNotExist(err) {
		return []LogMeta{}, nil
	}

	var uploads []LogMeta

	filepath.Walk(logsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if filepath.Base(path) != "metadata.json" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		var meta LogMeta
		if err := json.Unmarshal(data, &meta); err != nil {
			return nil
		}
		meta.StoragePath = filepath.Dir(path)
		uploads = append(uploads, meta)
		return nil
	})

	// Sort by timestamp descending (newest first)
	sort.Slice(uploads, func(i, j int) bool {
		return uploads[i].Timestamp > uploads[j].Timestamp
	})

	return uploads, nil
}

// GetUpload returns metadata for a specific upload ID.
func (s *Storage) GetUpload(id string) (LogMeta, error) {
	logsDir := filepath.Join(s.dataDir, "logs")

	var found LogMeta
	walkErr := filepath.Walk(logsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if filepath.Base(path) != "metadata.json" {
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}

		var meta LogMeta
		if unmarshalErr := json.Unmarshal(data, &meta); unmarshalErr != nil {
			return nil
		}

		if meta.ID == id {
			meta.StoragePath = filepath.Dir(path)
			found = meta
			return fmt.Errorf("found") // break walk
		}
		return nil
	})

	if found.ID != "" {
		return found, nil
	}

	_ = walkErr // ignore "found" error
	return LogMeta{}, fmt.Errorf("upload %q not found", id)
}

// zipEntry represents a single file inside a zip archive.
type zipEntry struct {
	Name string
	Data []byte
}

// extractZipEntries reads all file entries from a zip byte slice.
func extractZipEntries(data []byte) ([]zipEntry, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}

	var entries []zipEntry
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("opening zip entry %q: %w", f.Name, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("reading zip entry %q: %w", f.Name, err)
		}
		entries = append(entries, zipEntry{
			Name: f.Name,
			Data: content,
		})
	}
	return entries, nil
}
