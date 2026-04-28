// Package sync implements daemon → server synchronization per SPEC §4.
// Last-write-wins, per-row, on updated_at.
package sync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/aerion/t/internal/model"
	"github.com/aerion/t/internal/store"
)

const metaLastSyncKey = "last_sync_at"

// Engine performs synchronization between the local store and a remote server.
type Engine struct {
	st        *store.Store
	serverURL string
	token     string
	http      *http.Client
	log       *slog.Logger

	mu        sync.Mutex
	applying  bool // true while we're writing remote→local; suppresses re-sync triggers
	stats     Stats
}

// Stats counts what happened in the most recent Run.
type Stats struct {
	PulledTasks    int
	PulledProjects int
	PushedTasks    int
	PushedProjects int
}

// New creates a sync engine.
func New(st *store.Store, serverURL, token string, log *slog.Logger) *Engine {
	if log == nil {
		log = slog.Default()
	}
	return &Engine{
		st:        st,
		serverURL: serverURL,
		token:     token,
		http:      &http.Client{Timeout: 30 * time.Second},
		log:       log,
	}
}

// IsApplyingRemote returns true while a remote→local apply is in flight.
// Used by the daemon to suppress sync-on-write loops.
func (e *Engine) IsApplyingRemote() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.applying
}

// Run performs one sync cycle. Returns Stats and any terminal error.
// On error, last_sync_at is NOT advanced — the next cycle will retry.
func (e *Engine) Run() (Stats, error) {
	e.stats = Stats{}

	if e.token == "" || e.token == "REPLACE_ME" {
		return e.stats, fmt.Errorf("server_token not configured; skipping sync")
	}

	since, err := e.readLastSync()
	if err != nil {
		return e.stats, fmt.Errorf("read last_sync_at: %w", err)
	}

	// Phase 1: pull remote → local. Track which IDs were applied so we don't
	// immediately re-push them as if they were local edits.
	pulled := pulledIDs{tasks: map[string]bool{}, projects: map[string]bool{}}
	serverTime, err := e.pull(since, &pulled)
	if err != nil {
		return e.stats, fmt.Errorf("pull: %w", err)
	}

	// Phase 2: push local → remote.
	if err := e.push(since, &pulled); err != nil {
		return e.stats, fmt.Errorf("push: %w", err)
	}

	// Phase 3: advance last_sync_at to server's clock from the pull response.
	if err := e.st.SetMeta(metaLastSyncKey, strconv.FormatInt(serverTime, 10)); err != nil {
		return e.stats, fmt.Errorf("set last_sync_at: %w", err)
	}

	return e.stats, nil
}

func (e *Engine) readLastSync() (int64, error) {
	v, err := e.st.GetMeta(metaLastSyncKey)
	if err != nil {
		return 0, err
	}
	if v == "" {
		return 0, nil
	}
	return strconv.ParseInt(v, 10, 64)
}

type pullResponse struct {
	Tasks      []*model.Task    `json:"tasks"`
	Projects   []*model.Project `json:"projects"`
	ServerTime int64            `json:"server_time"`
}

type pulledIDs struct {
	tasks    map[string]bool
	projects map[string]bool
}

func (e *Engine) pull(since int64, pulled *pulledIDs) (int64, error) {
	u, err := url.Parse(e.serverURL + "/tasks")
	if err != nil {
		return 0, err
	}
	q := u.Query()
	q.Set("since", strconv.FormatInt(since, 10))
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	resp, err := e.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("pull HTTP %d: %s", resp.StatusCode, string(body))
	}
	var pr pullResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return 0, err
	}

	e.mu.Lock()
	e.applying = true
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		e.applying = false
		e.mu.Unlock()
	}()

	// Apply projects first (tasks reference them via FK).
	for _, p := range pr.Projects {
		existing, err := e.st.GetProject(p.ID)
		if err != nil {
			return 0, err
		}
		if existing != nil && existing.UpdatedAt >= p.UpdatedAt {
			continue
		}
		if err := e.st.UpsertProject(p); err != nil {
			return 0, err
		}
		pulled.projects[p.ID] = true
		e.stats.PulledProjects++
	}
	for _, t := range pr.Tasks {
		existing, err := e.st.GetTask(t.ID)
		if err != nil {
			return 0, err
		}
		if existing != nil && existing.UpdatedAt >= t.UpdatedAt {
			continue
		}
		if err := e.st.UpsertTask(t); err != nil {
			return 0, err
		}
		pulled.tasks[t.ID] = true
		e.stats.PulledTasks++
	}
	return pr.ServerTime, nil
}

func (e *Engine) push(since int64, pulled *pulledIDs) error {
	projects, err := e.st.GetProjectsSince(since)
	if err != nil {
		return err
	}
	for _, p := range projects {
		if pulled.projects[p.ID] {
			continue
		}
		if err := e.pushProject(p); err != nil {
			return err
		}
		e.stats.PushedProjects++
	}
	tasks, err := e.st.GetTasksSince(since)
	if err != nil {
		return err
	}
	for _, t := range tasks {
		if pulled.tasks[t.ID] {
			continue
		}
		if err := e.pushTask(t); err != nil {
			return err
		}
		e.stats.PushedTasks++
	}
	return nil
}

func (e *Engine) pushProject(p *model.Project) error {
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	// Try POST first; on 409, fall back to PATCH.
	resp, err := e.do("POST", "/projects", body)
	if err != nil {
		return err
	}
	if resp.StatusCode == 409 {
		resp.Body.Close()
		patchResp, err := e.do("PATCH", "/projects/"+p.ID, body)
		if err != nil {
			return err
		}
		defer patchResp.Body.Close()
		if patchResp.StatusCode != 200 {
			b, _ := io.ReadAll(patchResp.Body)
			return fmt.Errorf("PATCH /projects/%s: %d %s", p.ID, patchResp.StatusCode, string(b))
		}
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("POST /projects: %d %s", resp.StatusCode, string(b))
	}
	return nil
}

func (e *Engine) pushTask(t *model.Task) error {
	body, err := json.Marshal(t)
	if err != nil {
		return err
	}
	resp, err := e.do("POST", "/tasks", body)
	if err != nil {
		return err
	}
	if resp.StatusCode == 409 {
		resp.Body.Close()
		patchResp, err := e.do("PATCH", "/tasks/"+t.ID, body)
		if err != nil {
			return err
		}
		defer patchResp.Body.Close()
		if patchResp.StatusCode != 200 {
			b, _ := io.ReadAll(patchResp.Body)
			return fmt.Errorf("PATCH /tasks/%s: %d %s", t.ID, patchResp.StatusCode, string(b))
		}
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("POST /tasks: %d %s", resp.StatusCode, string(b))
	}
	return nil
}

func (e *Engine) do(method, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequest(method, e.serverURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.token)
	return e.http.Do(req)
}
