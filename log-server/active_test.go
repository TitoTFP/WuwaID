package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestActiveHeartbeatAndCount(t *testing.T) {
	srv, _ := setupTestServer(t)
	srv.now = func() time.Time { return time.Date(2026, 5, 24, 1, 0, 0, 0, time.UTC) }
	mux := srv.Handler()

	body := bytes.NewBufferString(`{"client_id":"abc123","launcher_version":"2.2.0","install_method":"method2","event":"open"}`)
	req := httptest.NewRequest("POST", "/api/active/heartbeat", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/active/heartbeat status = %d; want 200. Body: %s", rec.Code, rec.Body.String())
	}

	listReq := httptest.NewRequest("GET", "/api/active", nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("GET /api/active status = %d; want 200", listRec.Code)
	}

	var resp ActiveSummary
	if err := json.NewDecoder(listRec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Active != 1 {
		t.Errorf("active = %d; want 1", resp.Active)
	}
	if resp.WindowSeconds != 600 {
		t.Errorf("window_seconds = %d; want 600", resp.WindowSeconds)
	}
}

func TestActiveCountIgnoresExpiredPlayers(t *testing.T) {
	srv, _ := setupTestServer(t)
	base := time.Date(2026, 5, 24, 1, 0, 0, 0, time.UTC)
	srv.now = func() time.Time { return base }
	mux := srv.Handler()

	body := bytes.NewBufferString(`{"client_id":"abc123","launcher_version":"2.2.0","install_method":"method1","event":"open"}`)
	req := httptest.NewRequest("POST", "/api/active/heartbeat", body)
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(httptest.NewRecorder(), req)

	srv.now = func() time.Time { return base.Add(11 * time.Minute) }
	listReq := httptest.NewRequest("GET", "/api/active", nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)

	var resp ActiveSummary
	json.NewDecoder(listRec.Body).Decode(&resp)
	if resp.Active != 0 {
		t.Errorf("active = %d; want 0 after active window expires", resp.Active)
	}
}

func TestActiveHeartbeatRejectsMissingClientID(t *testing.T) {
	srv, _ := setupTestServer(t)
	mux := srv.Handler()

	req := httptest.NewRequest("POST", "/api/active/heartbeat", bytes.NewBufferString(`{"event":"open"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d; want 400", rec.Code)
	}
}

func TestActiveEndpointRequiresAdminTokenWhenConfigured(t *testing.T) {
	srv, _ := setupTestServer(t)
	srv.cfg.AdminToken = "secret"
	mux := srv.Handler()

	req := httptest.NewRequest("GET", "/api/active", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/active without token = %d; want 401", rec.Code)
	}

	req = httptest.NewRequest("GET", "/api/active", nil)
	req.Header.Set("X-Admin-Token", "secret")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/active with token = %d; want 200", rec.Code)
	}
}
