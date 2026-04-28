package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/aerion/t/internal/model"
	"github.com/aerion/t/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handlers wires HTTP endpoints over a Store.
type Handlers struct {
	Store *store.Store
}

// New constructs a Handlers.
func New(s *store.Store) *Handlers {
	return &Handlers{Store: s}
}

// Router builds a chi router with all endpoints registered.
func (h *Handlers) Router() http.Handler {
	r := chi.NewRouter()
	r.Get("/health", h.Health)
	r.Get("/tasks", h.ListTasks)
	r.Post("/tasks", h.CreateTask)
	r.Patch("/tasks/{id}", h.UpdateTask)
	r.Get("/projects", h.ListProjects)
	r.Post("/projects", h.CreateProject)
	r.Patch("/projects/{id}", h.UpdateProject)
	return r
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// Health returns daemon liveness.
func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ListTasks returns tasks (and projects) updated since `since` ms, plus server_time.
// Without a `since` parameter, returns all live tasks (CLI list view).
func (h *Handlers) ListTasks(w http.ResponseWriter, r *http.Request) {
	sinceParam := r.URL.Query().Get("since")
	var tasks []*model.Task
	var err error
	since := int64(0)
	if sinceParam != "" {
		since, err = strconv.ParseInt(sinceParam, 10, 64)
		if err != nil {
			writeErr(w, 400, "invalid since")
			return
		}
		tasks, err = h.Store.GetTasksSince(since)
	} else {
		tasks, err = h.Store.ListTasks(store.TaskFilters{})
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	projects, err := h.Store.GetProjectsSince(since)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tasks == nil {
		tasks = []*model.Task{}
	}
	if projects == nil {
		projects = []*model.Project{}
	}
	writeJSON(w, 200, map[string]interface{}{
		"tasks":       tasks,
		"projects":    projects,
		"server_time": model.Now(),
	})
}

type createTaskReq struct {
	ID        string   `json:"id,omitempty"`
	Project   string   `json:"project,omitempty"`
	ProjectID string   `json:"project_id,omitempty"`
	Title     string   `json:"title"`
	Status    string   `json:"status,omitempty"`
	Notes     string   `json:"notes,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt int64    `json:"created_at,omitempty"`
	UpdatedAt int64    `json:"updated_at,omitempty"`
}

// CreateTask creates a new task. Accepts `project` (name) or `project_id`.
func (h *Handlers) CreateTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.Title == "" {
		writeErr(w, 400, "title required")
		return
	}

	projectID := req.ProjectID
	if projectID == "" {
		name := req.Project
		if name == "" {
			name = "inbox"
		}
		p, err := h.Store.GetProjectByName(name)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if p == nil {
			writeErr(w, 400, "project not found: "+name)
			return
		}
		projectID = p.ID
	}

	now := model.Now()
	t := &model.Task{
		ID:        req.ID,
		ProjectID: projectID,
		Title:     req.Title,
		Status:    req.Status,
		Notes:     req.Notes,
		Tags:      req.Tags,
		CreatedAt: req.CreatedAt,
		UpdatedAt: req.UpdatedAt,
	}
	if t.ID == "" {
		t.ID = uuid.Must(uuid.NewV7()).String()
	}
	if t.Status == "" {
		t.Status = model.StatusInbox
	}
	if !model.IsValidStatus(t.Status) {
		writeErr(w, 400, "invalid status")
		return
	}
	if t.CreatedAt == 0 {
		t.CreatedAt = now
	}
	if t.UpdatedAt == 0 {
		t.UpdatedAt = now
	}

	existing, err := h.Store.GetTask(t.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if existing != nil {
		writeErr(w, 409, "task exists")
		return
	}
	if err := h.Store.CreateTask(t); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, t)
}

type updateTaskReq struct {
	ProjectID *string   `json:"project_id,omitempty"`
	Project   *string   `json:"project,omitempty"`
	Title     *string   `json:"title,omitempty"`
	Status    *string   `json:"status,omitempty"`
	Notes     *string   `json:"notes,omitempty"`
	Tags      *[]string `json:"tags,omitempty"`
	UpdatedAt *int64    `json:"updated_at,omitempty"`
	DeletedAt *int64    `json:"deleted_at,omitempty"`
}

// UpdateTask patches an existing task.
func (h *Handlers) UpdateTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, err := h.Store.GetTask(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if t == nil {
		writeErr(w, 404, "task not found")
		return
	}
	var req updateTaskReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.ProjectID != nil {
		t.ProjectID = *req.ProjectID
	}
	if req.Project != nil {
		p, err := h.Store.GetProjectByName(*req.Project)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if p == nil {
			writeErr(w, 400, "project not found")
			return
		}
		t.ProjectID = p.ID
	}
	if req.Title != nil {
		t.Title = *req.Title
	}
	if req.Status != nil {
		if !model.IsValidStatus(*req.Status) {
			writeErr(w, 400, "invalid status")
			return
		}
		t.Status = *req.Status
	}
	if req.Notes != nil {
		t.Notes = *req.Notes
	}
	if req.Tags != nil {
		t.Tags = *req.Tags
	}
	if req.DeletedAt != nil {
		t.DeletedAt = req.DeletedAt
	}
	if req.UpdatedAt != nil {
		t.UpdatedAt = *req.UpdatedAt
	} else {
		t.UpdatedAt = model.Now()
	}
	if err := h.Store.UpdateTask(t); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, t)
}

type createProjectReq struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at,omitempty"`
	UpdatedAt int64  `json:"updated_at,omitempty"`
}

// CreateProject creates a project.
func (h *Handlers) CreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	now := model.Now()
	p := &model.Project{
		ID:        req.ID,
		Name:      req.Name,
		CreatedAt: req.CreatedAt,
		UpdatedAt: req.UpdatedAt,
	}
	if p.ID == "" {
		p.ID = uuid.Must(uuid.NewV7()).String()
	}
	if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	if p.UpdatedAt == 0 {
		p.UpdatedAt = now
	}
	existing, err := h.Store.GetProject(p.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if existing != nil {
		writeErr(w, 409, "project exists")
		return
	}
	if err := h.Store.CreateProject(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

type updateProjectReq struct {
	Name      *string `json:"name,omitempty"`
	UpdatedAt *int64  `json:"updated_at,omitempty"`
	DeletedAt *int64  `json:"deleted_at,omitempty"`
}

// UpdateProject patches a project.
func (h *Handlers) UpdateProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := h.Store.GetProject(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if p == nil {
		writeErr(w, 404, "project not found")
		return
	}
	var req updateProjectReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.Name != nil {
		p.Name = *req.Name
	}
	if req.DeletedAt != nil {
		p.DeletedAt = req.DeletedAt
	}
	if req.UpdatedAt != nil {
		p.UpdatedAt = *req.UpdatedAt
	} else {
		p.UpdatedAt = model.Now()
	}
	if err := h.Store.UpdateProject(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

// ListProjects returns all live projects.
func (h *Handlers) ListProjects(w http.ResponseWriter, r *http.Request) {
	ps, err := h.Store.ListProjects()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if ps == nil {
		ps = []*model.Project{}
	}
	writeJSON(w, 200, ps)
}
