package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// makeLogZip creates a zip archive containing fake log files for testing.
func makeLogZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, err = w.Write([]byte(content))
		if err != nil {
			t.Fatal(err)
		}
	}
	zw.Close()
	return buf.Bytes()
}

func TestSaveLogUpload(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	zipData := makeLogZip(t, map[string]string{
		"launcher-20260516.log": "[2026-05-16] INFO Logger initialized",
	})

	meta, err := store.SaveLogUpload("v2.0.0", "20260516T143022", "Windows 10", zipData)
	if err != nil {
		t.Fatalf("SaveLogUpload() unexpected error: %v", err)
	}

	if meta.AppVersion != "v2.0.0" {
		t.Errorf("meta.AppVersion = %q; want v2.0.0", meta.AppVersion)
	}
	if meta.Timestamp != "20260516T143022" {
		t.Errorf("meta.Timestamp = %q; want 20260516T143022", meta.Timestamp)
	}
	if meta.OS != "Windows 10" {
		t.Errorf("meta.OS = %q; want Windows 10", meta.OS)
	}
	if meta.ID == "" {
		t.Error("meta.ID should not be empty")
	}
	if meta.FileCount != 1 {
		t.Errorf("meta.FileCount = %d; want 1", meta.FileCount)
	}
	if meta.TotalBytes <= 0 {
		t.Errorf("meta.TotalBytes = %d; should be > 0", meta.TotalBytes)
	}

	// Verify files were written to disk
	filesDir := filepath.Join(dir, "logs", "v2.0.0", "20260516", meta.ID)
	if _, err := os.Stat(filesDir); os.IsNotExist(err) {
		t.Errorf("expected directory %s to exist", filesDir)
	}

	logPath := filepath.Join(filesDir, "launcher-20260516.log")
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Errorf("expected log file %s to exist", logPath)
	}

	// Verify metadata.json was written
	metaPath := filepath.Join(filesDir, "metadata.json")
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Errorf("expected metadata file %s to exist", metaPath)
	}

	// Read back content
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Logger initialized") {
		t.Errorf("log content mismatch")
	}
}

func TestSaveLogUploadWithNoFiles(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	// Empty zip (no files)
	var emptyBuf bytes.Buffer
	zw := zip.NewWriter(&emptyBuf)
	zw.Close()

	_, err := store.SaveLogUpload("v2.0.0", "now", "Linux", emptyBuf.Bytes())
	if err == nil {
		t.Error("expected error for empty zip, got nil")
	}
}

func TestSaveLogUploadInvalidData(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	// Invalid zip data
	_, err := store.SaveLogUpload("v2.0.0", "now", "Linux", []byte("not-a-zip"))
	if err == nil {
		t.Error("expected error for invalid zip data, got nil")
	}
}

func TestListUploadsEmpty(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	uploads, err := store.ListUploads()
	if err != nil {
		t.Fatalf("ListUploads() unexpected error: %v", err)
	}
	if len(uploads) != 0 {
		t.Errorf("expected 0 uploads, got %d", len(uploads))
	}
}

func TestListUploads(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	zipData := makeLogZip(t, map[string]string{
		"launcher-20260516.log": "[2026-05-16] INFO test",
	})

	meta1, _ := store.SaveLogUpload("v2.0.0", "20260516T140000", "Windows 10", zipData)
	meta2, _ := store.SaveLogUpload("v2.0.0", "20260516T150000", "Windows 11", zipData)

	uploads, err := store.ListUploads()
	if err != nil {
		t.Fatalf("ListUploads() unexpected error: %v", err)
	}
	if len(uploads) != 2 {
		t.Fatalf("expected 2 uploads, got %d", len(uploads))
	}

	// Most recent first (sorted by timestamp desc)
	if uploads[0].ID != meta2.ID && uploads[1].ID != meta1.ID {
		t.Errorf("expected uploads sorted by timestamp descending")
	}
}

func TestListUploadsAcrossVersions(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	zipData := makeLogZip(t, map[string]string{"test.log": "content"})

	store.SaveLogUpload("v2.0.0", "20260516T140000", "Windows 10", zipData)
	store.SaveLogUpload("v1.5.0", "20260515T120000", "Windows 10", zipData)

	uploads, err := store.ListUploads()
	if err != nil {
		t.Fatalf("ListUploads() unexpected error: %v", err)
	}
	if len(uploads) != 2 {
		t.Errorf("expected 2 uploads across versions, got %d", len(uploads))
	}
}

func TestGetUpload(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	zipData := makeLogZip(t, map[string]string{
		"launcher-20260516.log": "[2026-05-16] INFO test",
	})

	saved, _ := store.SaveLogUpload("v2.0.0", "20260516T140000", "Windows 10", zipData)

	meta, err := store.GetUpload(saved.ID)
	if err != nil {
		t.Fatalf("GetUpload() unexpected error: %v", err)
	}
	if meta.ID != saved.ID {
		t.Errorf("GetUpload returned ID = %q; want %q", meta.ID, saved.ID)
	}
	if meta.AppVersion != "v2.0.0" {
		t.Errorf("GetUpload AppVersion = %q; want v2.0.0", meta.AppVersion)
	}
}

func TestGetUploadNotFound(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	_, err := store.GetUpload("nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent upload, got nil")
	}
}

func TestStorageConcurrentSaves(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	zipData := makeLogZip(t, map[string]string{"test.log": "concurrent content"})

	done := make(chan bool, 5)
	for i := 0; i < 5; i++ {
		go func() {
			_, err := store.SaveLogUpload("v2.0.0", time.Now().Format("20060102T150405"), "Windows", zipData)
			if err != nil {
				t.Errorf("concurrent save error: %v", err)
			}
			done <- true
		}()
	}

	for i := 0; i < 5; i++ {
		<-done
	}

	uploads, _ := store.ListUploads()
	if len(uploads) != 5 {
		t.Errorf("expected 5 uploads after concurrent saves, got %d", len(uploads))
	}
}
