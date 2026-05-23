package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const defaultActiveWindow = 10 * time.Minute

type ActiveHeartbeat struct {
	ClientID        string `json:"client_id"`
	LauncherVersion string `json:"launcher_version"`
	InstallMethod   string `json:"install_method"`
	Event           string `json:"event"`
}

type ActivePlayer struct {
	ClientID        string `json:"client_id"`
	LauncherVersion string `json:"launcher_version,omitempty"`
	InstallMethod   string `json:"install_method,omitempty"`
	Event           string `json:"event,omitempty"`
	LastSeen        string `json:"last_seen"`
}

type ActiveSummary struct {
	Active        int    `json:"active"`
	WindowSeconds int    `json:"window_seconds"`
	UpdatedAt     string `json:"updated_at"`
}

type activeState struct {
	Players map[string]ActivePlayer `json:"players"`
}

func (s *Storage) SaveActiveHeartbeat(h ActiveHeartbeat, now time.Time) error {
	h.ClientID = strings.TrimSpace(h.ClientID)
	if h.ClientID == "" {
		return fmt.Errorf("client_id is required")
	}
	if len(h.ClientID) > 128 {
		return fmt.Errorf("client_id is too long")
	}

	s.activeMu().Lock()
	defer s.activeMu().Unlock()

	state, err := s.readActiveState()
	if err != nil {
		return err
	}
	if state.Players == nil {
		state.Players = map[string]ActivePlayer{}
	}

	state.Players[h.ClientID] = ActivePlayer{
		ClientID:        h.ClientID,
		LauncherVersion: trimMax(h.LauncherVersion, 32),
		InstallMethod:   trimMax(h.InstallMethod, 32),
		Event:           trimMax(h.Event, 32),
		LastSeen:        now.UTC().Format(time.RFC3339),
	}

	if err := s.writeActiveState(state); err != nil {
		return err
	}

	// Record to history (non-fatal)
	event := h.Event
	if event == "" {
		event = "unknown"
	}
	_ = s.RecordHeartbeat(h.ClientID, event, now)

	return nil
}

func (s *Storage) ActiveSummary(now time.Time, window time.Duration) (ActiveSummary, error) {
	players, err := s.ListActivePlayers(now, window)
	if err != nil {
		return ActiveSummary{}, err
	}
	return ActiveSummary{
		Active:        len(players),
		WindowSeconds: int(window.Seconds()),
		UpdatedAt:     now.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Storage) ListActivePlayers(now time.Time, window time.Duration) ([]ActivePlayer, error) {
	s.activeMu().Lock()
	defer s.activeMu().Unlock()

	state, err := s.readActiveState()
	if err != nil {
		return nil, err
	}

	cutoff := now.UTC().Add(-window)
	players := make([]ActivePlayer, 0, len(state.Players))
	for _, player := range state.Players {
		lastSeen, err := time.Parse(time.RFC3339, player.LastSeen)
		if err != nil || lastSeen.Before(cutoff) {
			continue
		}
		players = append(players, player)
	}

	sort.Slice(players, func(i, j int) bool {
		return players[i].LastSeen > players[j].LastSeen
	})
	return players, nil
}

func (s *Storage) readActiveState() (activeState, error) {
	path := s.activeStatePath()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return activeState{Players: map[string]ActivePlayer{}}, nil
	}
	if err != nil {
		return activeState{}, err
	}
	var state activeState
	if err := json.Unmarshal(data, &state); err != nil {
		return activeState{}, err
	}
	if state.Players == nil {
		state.Players = map[string]ActivePlayer{}
	}
	return state, nil
}

func (s *Storage) writeActiveState(state activeState) error {
	path := s.activeStatePath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (s *Storage) activeStatePath() string {
	return filepath.Join(s.dataDir, "active", "players.json")
}

var activeLocks sync.Map

func (s *Storage) activeMu() *sync.Mutex {
	actual, _ := activeLocks.LoadOrStore(s.dataDir, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

func trimMax(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}
