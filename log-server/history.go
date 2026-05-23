package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const (
	historyInterval = 5 * time.Minute
	historyRetention = 30 * 24 * time.Hour
)

// HistoryPoint represents aggregated active player count at a point in time.
type HistoryPoint struct {
	Timestamp string         `json:"timestamp"` // RFC3339, truncated to interval
	Events    map[string]int `json:"events"`    // event_type -> count
	Total     int            `json:"total"`     // total active across all events
}

// historyState is the in-memory + on-disk representation.
type historyState struct {
	Points []HistoryPoint `json:"points"`
}

var historyLock sync.Mutex

func historyPath(dataDir string) string {
	return filepath.Join(dataDir, "active", "history.json")
}

func loadHistory(dataDir string) (historyState, error) {
	path := historyPath(dataDir)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return historyState{Points: []HistoryPoint{}}, nil
	}
	if err != nil {
		return historyState{}, err
	}
	var state historyState
	if err := json.Unmarshal(data, &state); err != nil {
		return historyState{Points: []HistoryPoint{}}, nil
	}
	return state, nil
}

func saveHistory(dataDir string, state historyState) error {
	path := historyPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// RecordHeartbeat records a heartbeat into the current interval bucket.
func (s *Storage) RecordHeartbeat(clientID, event string, now time.Time) error {
	historyLock.Lock()
	defer historyLock.Unlock()

	state, err := loadHistory(s.dataDir)
	if err != nil {
		return err
	}

	// Truncate to interval
	bucketTime := now.Truncate(historyInterval).UTC()
	bucketKey := bucketTime.Format(time.RFC3339)

	// Find or create the bucket
	found := false
	for i, p := range state.Points {
		if p.Timestamp == bucketKey {
			if state.Points[i].Events == nil {
				state.Points[i].Events = map[string]int{}
			}
			state.Points[i].Events[event]++
			state.Points[i].Total++
			found = true
			break
		}
	}

	if !found {
		pt := HistoryPoint{
			Timestamp: bucketKey,
			Events:    map[string]int{event: 1},
			Total:     1,
		}
		state.Points = append(state.Points, pt)
	}

	// Prune old data
	cutoff := now.UTC().Add(-historyRetention)
	state.Points = filterHistoryPoints(state.Points, cutoff)

	// Sort by timestamp
	sort.Slice(state.Points, func(i, j int) bool {
		return state.Points[i].Timestamp < state.Points[j].Timestamp
	})

	return saveHistory(s.dataDir, state)
}

func filterHistoryPoints(points []HistoryPoint, cutoff time.Time) []HistoryPoint {
	result := make([]HistoryPoint, 0, len(points))
	for _, p := range points {
		t, err := time.Parse(time.RFC3339, p.Timestamp)
		if err != nil || t.Before(cutoff) {
			continue
		}
		result = append(result, p)
	}
	return result
}

// GetHistory returns history points within the given duration window.
func (s *Storage) GetHistory(now time.Time, window time.Duration) ([]HistoryPoint, error) {
	historyLock.Lock()
	defer historyLock.Unlock()

	state, err := loadHistory(s.dataDir)
	if err != nil {
		return nil, err
	}

	cutoff := now.UTC().Add(-window)
	result := make([]HistoryPoint, 0, len(state.Points))
	for _, p := range state.Points {
		t, err := time.Parse(time.RFC3339, p.Timestamp)
		if err != nil || t.Before(cutoff) {
			continue
		}
		result = append(result, p)
	}
	return result, nil
}

// HistoryResponse is the JSON response for the history API.
type HistoryResponse struct {
	Points    []HistoryPoint `json:"points"`
	Window    string         `json:"window"`
	Interval  string         `json:"interval"`
	EventKeys []string       `json:"event_keys"`
}

// CollectEventKeys returns all unique event types across the points, sorted.
func CollectEventKeys(points []HistoryPoint) []string {
	seen := map[string]bool{}
	for _, p := range points {
		for k := range p.Events {
			seen[k] = true
		}
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
