package main

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveLogUploadPathTraversal(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	// Zip with path traversal entry + valid entry
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("../../../etc/passwd")
	w.Write([]byte("root:x:0:0:root:/root:/bin/bash"))
	w, _ = zw.Create("launcher-20260516.log")
	w.Write([]byte("[2026-05-16] INFO safe"))
	zw.Close()

	meta, err := store.SaveLogUpload("v2.0.0", "now", "Linux", buf.Bytes())
	if err != nil {
		t.Fatalf("SaveLogUpload() unexpected error: %v", err)
	}

	// Only the valid file should be counted
	if meta.FileCount != 1 {
		t.Errorf("meta.FileCount = %d; want 1 (traversal entry should be skipped)", meta.FileCount)
	}

	// Verify no files leaked outside the storage directory
	err = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.Contains(path, "etc/passwd") {
			t.Errorf("path traversal file found outside storage: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestSaveLogUploadSolelyPathTraversal(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	// Zip with ONLY path traversal entries — should be handled safely
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("../../etc/hacked")
	w.Write([]byte("evil"))
	zw.Close()

	_, err := store.SaveLogUpload("v2.0.0", "now", "Linux", buf.Bytes())
	// Should error because no valid files remain after skipping traversal entries
	if err == nil {
		t.Error("expected error when all entries are path traversal, got nil")
	}
}

func TestSaveLogUploadDeepPathTraversal(t *testing.T) {
	dir := t.TempDir()
	store := NewStorage(dir)

	// Deep nested traversal
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("foo/bar/../../../../baz/../../../etc/shadow")
	w.Write([]byte("evil"))
	w, _ = zw.Create("valid.log")
	w.Write([]byte("safe"))
	zw.Close()

	meta, err := store.SaveLogUpload("v2.0.0", "now", "Linux", buf.Bytes())
	if err != nil {
		t.Fatalf("SaveLogUpload() unexpected error: %v", err)
	}
	if meta.FileCount != 1 {
		t.Errorf("meta.FileCount = %d; want 1 (deep traversal should be skipped)", meta.FileCount)
	}
}

func TestHealthMethodNotAllowed(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	methods := []string{"POST", "PUT", "DELETE", "PATCH"}
	for _, method := range methods {
		req := httptest.NewRequest(method, "/health", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /health status = %d; want 405", method, rec.Code)
		}
	}
}

func TestUploadInvalidContentType(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	// Send raw JSON instead of multipart
	body := bytes.NewReader([]byte(`{"test":"data"}`))
	req := httptest.NewRequest("POST", "/api/logs", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /api/logs with JSON Content-Type status = %d; want 400", rec.Code)
	}
}

func TestUploadEmptyContentType(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	req := httptest.NewRequest("POST", "/api/logs", nil)
	// No Content-Type header
	req.Header.Set("Content-Type", "")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /api/logs with empty Content-Type status = %d; want 400", rec.Code)
	}
}

func TestUploadEmptyZipFile(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	// 0-byte zip file in multipart
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	logWriter.Write([]byte{})
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "now")
	w.WriteField("os", "Windows")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	// Empty zip is technically a valid zip (0 entries) — should be rejected
	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /api/logs with empty zip status = %d; want 400. Body: %s", rec.Code, rec.Body.String())
	}
}
