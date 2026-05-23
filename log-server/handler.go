package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Server holds dependencies for HTTP handlers.
type Server struct {
	cfg   Config
	store *Storage
	now   func() time.Time
}

// NewServer creates a new Server with the given config and storage.
func NewServer(cfg Config, store *Storage) *Server {
	return &Server{cfg: cfg, store: store, now: time.Now}
}

// Handler returns an http.Handler with all routes registered.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/api/active", s.handleActive)
	mux.HandleFunc("/api/active/players", s.handleActivePlayers)
	mux.HandleFunc("/api/active/heartbeat", s.handleActiveHeartbeat)
	return withCORS(mux)
}

// withCORS wraps a handler with CORS headers for launcher access.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleActiveHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var heartbeat ActiveHeartbeat
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&heartbeat); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.store.SaveActiveHeartbeat(heartbeat, s.now()); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleActive(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorizeAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	summary, err := s.store.ActiveSummary(s.now(), defaultActiveWindow)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleActivePlayers(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorizeAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	players, err := s.store.ListActivePlayers(s.now(), defaultActiveWindow)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, players)
}

func (s *Server) authorizeAdmin(r *http.Request) bool {
	if s.cfg.AdminToken == "" {
		return true
	}
	return r.Header.Get("X-Admin-Token") == s.cfg.AdminToken
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		s.listLogs(w, r)
	case "POST":
		s.uploadLog(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) listLogs(w http.ResponseWriter, r *http.Request) {
	uploads, err := s.store.ListUploads()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if uploads == nil {
		uploads = []LogMeta{}
	}

	writeJSON(w, http.StatusOK, uploads)
}

func (s *Server) uploadLog(w http.ResponseWriter, r *http.Request) {
	// Limit request body size
	maxBytes := s.cfg.MaxUploadBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1024) // slight overhead for multipart

	// Parse multipart form (max 32MB in memory, rest to temp files)
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": fmt.Sprintf("upload too large; max %d MB", s.cfg.MaxUploadMB),
			})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart form"})
		return
	}
	defer r.MultipartForm.RemoveAll()

	// Required fields
	appVersion := r.FormValue("appVersion")
	timestamp := r.FormValue("timestamp")
	osName := r.FormValue("os")

	if appVersion == "" || timestamp == "" || osName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required fields: appVersion, timestamp, os",
		})
		return
	}

	// Get uploaded file (field name: "logs")
	file, _, err := r.FormFile("logs")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing 'logs' file field",
		})
		return
	}
	defer file.Close()

	zipData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to read uploaded file",
		})
		return
	}

	// Save to storage
	meta, err := s.store.SaveLogUpload(appVersion, timestamp, osName, zipData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "ok",
		"id":          meta.ID,
		"file_count":  meta.FileCount,
		"total_bytes": meta.TotalBytes,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
