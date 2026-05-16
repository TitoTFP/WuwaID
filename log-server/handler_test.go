package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// makeValidZip creates a zip archive containing one log file for testing.
func makeValidZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("launcher-20260516.log")
	if err != nil {
		t.Fatal(err)
	}
	w.Write([]byte("[2026-05-16] INFO test log content"))
	zw.Close()
	return buf.Bytes()
}

// setupTestServer creates a test server with in-memory/temp storage.
func setupTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	store := NewStorage(dir)
	cfg := Config{
		Port:         8080,
		DataDir:      dir,
		MaxUploadMB:  10,
		RetentionDays: 30,
	}
	srv := NewServer(cfg, store)
	return srv, dir
}

func TestHealthEndpoint(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /health status = %d; want 200", rec.Code)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "ok") {
		t.Errorf("GET /health body = %s; want contains 'ok'", body)
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "json") {
		t.Errorf("Content-Type = %s; want application/json", ct)
	}
}

func TestUploadLogSuccess(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()
	zipData := makeValidZip(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	logWriter.Write(zipData)
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "20260516T143022")
	w.WriteField("os", "Windows 10")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("POST /api/logs status = %d; want 200. Body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(rec.Body).Decode(&resp)

	if resp["status"] != "ok" {
		t.Errorf("response status = %v; want ok", resp["status"])
	}
	if resp["id"] == "" {
		t.Error("response id should not be empty")
	}
}

func TestUploadLogMissingFile(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "now")
	w.WriteField("os", "Windows")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d; want 400 (missing file)", rec.Code)
	}
}

func TestUploadLogMissingFields(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	// Upload with file but missing required fields (only logs file, no appVersion etc.)
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	logWriter.Write([]byte("fake-zip-content"))
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d; want 400 (missing fields)", rec.Code)
	}
}

func TestUploadLogOversized(t *testing.T) {
	srv, _ := setupTestServer(t)
	// Override max upload to 1MB for testing
	srv.cfg.MaxUploadMB = 1

	mux := srv.Handler()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	// Write more than 1MB
	logWriter.Write(make([]byte, 2*1024*1024))
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "now")
	w.WriteField("os", "Windows")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d; want 413 (oversized)", rec.Code)
	}
}

func TestUploadLogWrongFieldName(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	// Wrong field name instead of "logs"
	fw, _ := w.CreateFormFile("wrongfield", "logs.zip")
	fw.Write([]byte("content"))
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "now")
	w.WriteField("os", "Windows")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d; want 400 (wrong field)", rec.Code)
	}
}

func TestListLogsEndpoint(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()
	zipData := makeValidZip(t)

	// First upload a log
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	logWriter.Write(zipData)
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "20260516T143022")
	w.WriteField("os", "Windows 11")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	mux.ServeHTTP(httptest.NewRecorder(), req)

	// Now list
	listReq := httptest.NewRequest("GET", "/api/logs", nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Errorf("GET /api/logs status = %d; want 200", listRec.Code)
	}

	var logs []LogMeta
	json.NewDecoder(listRec.Body).Decode(&logs)

	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}
	if logs[0].AppVersion != "v2.0.0" {
		t.Errorf("AppVersion = %q; want v2.0.0", logs[0].AppVersion)
	}
	if logs[0].OS != "Windows 11" {
		t.Errorf("OS = %q; want Windows 11", logs[0].OS)
	}
}

func TestListLogsEmpty(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	req := httptest.NewRequest("GET", "/api/logs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d; want 200", rec.Code)
	}

	body, _ := io.ReadAll(rec.Body)
	if string(body) != "[]\n" && string(body) != "[]" && string(body) != "[null]\n" {
		t.Errorf("expected empty array, got %s", body)
	}
}

func TestCORSHeaders(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	// Test preflight
	req := httptest.NewRequest("OPTIONS", "/api/logs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("OPTIONS status = %d; want 204", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("CORS Origin header missing")
	}
}

func TestMethodNotAllowed(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	methods := []string{"PUT", "DELETE", "PATCH"}
	for _, method := range methods {
		req := httptest.NewRequest(method, "/api/logs", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/logs status = %d; want 405", method, rec.Code)
		}
	}
}

func TestUploadLogInvalidZip(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	logWriter, _ := w.CreateFormFile("logs", "logs.zip")
	logWriter.Write([]byte("this is not a valid zip file at all"))
	w.WriteField("appVersion", "v2.0.0")
	w.WriteField("timestamp", "20260516T143022")
	w.WriteField("os", "Windows 10")
	w.Close()

	req := httptest.NewRequest("POST", "/api/logs", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d; want 400 (invalid zip). Body: %s", rec.Code, rec.Body.String())
	}
}
