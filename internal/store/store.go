package store

import (
	"database/sql"
	"fmt"

	"github.com/aerion/t/internal/model"
	"github.com/aerion/t/internal/store/migrations"
	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

// New creates a new Store and runs migrations.
func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Enable foreign keys
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	// Run migrations
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set goose dialect: %w", err)
	}
	if err := goose.Up(db, "."); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	s := &Store{db: db}

	// Ensure inbox project exists
	if err := s.ensureInboxProject(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ensure inbox project: %w", err)
	}

	return s, nil
}

// Close closes the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// ensureInboxProject creates the default "inbox" project if no projects exist.
func (s *Store) ensureInboxProject() error {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL").Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	now := model.Now()
	inbox := &model.Project{
		ID:        uuid.Must(uuid.NewV7()).String(),
		Name:      "inbox",
		CreatedAt: now,
		UpdatedAt: now,
	}
	return s.CreateProject(inbox)
}

// CreateProject inserts a new project.
func (s *Store) CreateProject(p *model.Project) error {
	_, err := s.db.Exec(
		"INSERT INTO projects (id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)",
		p.ID, p.Name, p.CreatedAt, p.UpdatedAt, p.DeletedAt,
	)
	return err
}

// GetProject retrieves a project by ID.
func (s *Store) GetProject(id string) (*model.Project, error) {
	p := &model.Project{}
	err := s.db.QueryRow(
		"SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE id = ?",
		id,
	).Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// GetProjectByName retrieves a project by name.
func (s *Store) GetProjectByName(name string) (*model.Project, error) {
	p := &model.Project{}
	err := s.db.QueryRow(
		"SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE name = ? AND deleted_at IS NULL",
		name,
	).Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// ListProjects returns all non-deleted projects.
func (s *Store) ListProjects() ([]*model.Project, error) {
	rows, err := s.db.Query(
		"SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE deleted_at IS NULL ORDER BY name",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*model.Project
	for rows.Next() {
		p := &model.Project{}
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

// UpdateProject updates an existing project.
func (s *Store) UpdateProject(p *model.Project) error {
	_, err := s.db.Exec(
		"UPDATE projects SET name = ?, updated_at = ?, deleted_at = ? WHERE id = ?",
		p.Name, p.UpdatedAt, p.DeletedAt, p.ID,
	)
	return err
}

// CreateTask inserts a new task.
func (s *Store) CreateTask(t *model.Task) error {
	tags, err := model.MarshalTags(t.Tags)
	if err != nil {
		return fmt.Errorf("marshal tags: %w", err)
	}
	_, err = s.db.Exec(
		"INSERT INTO tasks (id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		t.ID, t.ProjectID, t.Title, t.Status, t.Notes, tags, t.CreatedAt, t.UpdatedAt, t.DeletedAt,
	)
	return err
}

// GetTask retrieves a task by ID.
func (s *Store) GetTask(id string) (*model.Task, error) {
	t := &model.Task{}
	var tagsJSON string
	err := s.db.QueryRow(
		"SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE id = ?",
		id,
	).Scan(&t.ID, &t.ProjectID, &t.Title, &t.Status, &t.Notes, &tagsJSON, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.Tags, err = model.UnmarshalTags(tagsJSON)
	if err != nil {
		return nil, fmt.Errorf("unmarshal tags: %w", err)
	}
	return t, nil
}

// ListTasks returns tasks matching the given filters.
// If no filters are provided, returns all non-deleted tasks.
func (s *Store) ListTasks(filters TaskFilters) ([]*model.Task, error) {
	query := "SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE deleted_at IS NULL"
	var args []interface{}

	if filters.ProjectID != "" {
		query += " AND project_id = ?"
		args = append(args, filters.ProjectID)
	}
	if filters.Status != "" {
		query += " AND status = ?"
		args = append(args, filters.Status)
	}
	if filters.Tag != "" {
		query += " AND tags LIKE ?"
		args = append(args, "%"+filters.Tag+"%")
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []*model.Task
	for rows.Next() {
		t := &model.Task{}
		var tagsJSON string
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Status, &t.Notes, &tagsJSON, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt); err != nil {
			return nil, err
		}
		t.Tags, err = model.UnmarshalTags(tagsJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal tags: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// TaskFilters defines filters for listing tasks.
type TaskFilters struct {
	ProjectID string
	Status    string
	Tag       string
}

// UpdateTask updates an existing task.
func (s *Store) UpdateTask(t *model.Task) error {
	tags, err := model.MarshalTags(t.Tags)
	if err != nil {
		return fmt.Errorf("marshal tags: %w", err)
	}
	_, err = s.db.Exec(
		"UPDATE tasks SET project_id = ?, title = ?, status = ?, notes = ?, tags = ?, updated_at = ?, deleted_at = ? WHERE id = ?",
		t.ProjectID, t.Title, t.Status, t.Notes, tags, t.UpdatedAt, t.DeletedAt, t.ID,
	)
	return err
}

// GetTasksSince returns all tasks (including deleted) updated since the given timestamp.
func (s *Store) GetTasksSince(since int64) ([]*model.Task, error) {
	rows, err := s.db.Query(
		"SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE updated_at > ? ORDER BY updated_at",
		since,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []*model.Task
	for rows.Next() {
		t := &model.Task{}
		var tagsJSON string
		if err := rows.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Status, &t.Notes, &tagsJSON, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt); err != nil {
			return nil, err
		}
		t.Tags, err = model.UnmarshalTags(tagsJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal tags: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// GetProjectsSince returns all projects (including deleted) updated since the given timestamp.
func (s *Store) GetProjectsSince(since int64) ([]*model.Project, error) {
	rows, err := s.db.Query(
		"SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE updated_at > ? ORDER BY updated_at",
		since,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*model.Project
	for rows.Next() {
		p := &model.Project{}
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.DeletedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

// GetMeta retrieves a metadata value by key.
func (s *Store) GetMeta(key string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT value FROM _meta WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetMeta sets a metadata value.
func (s *Store) SetMeta(key, value string) error {
	_, err := s.db.Exec(
		"INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
		key, value, value,
	)
	return err
}

// UpsertTask inserts or updates a task based on updated_at (for sync).
func (s *Store) UpsertTask(t *model.Task) error {
	existing, err := s.GetTask(t.ID)
	if err != nil {
		return err
	}
	if existing == nil {
		return s.CreateTask(t)
	}
	// Only update if incoming is newer
	if t.UpdatedAt > existing.UpdatedAt {
		return s.UpdateTask(t)
	}
	return nil
}

// UpsertProject inserts or updates a project based on updated_at (for sync).
func (s *Store) UpsertProject(p *model.Project) error {
	existing, err := s.GetProject(p.ID)
	if err != nil {
		return err
	}
	if existing == nil {
		return s.CreateProject(p)
	}
	// Only update if incoming is newer
	if p.UpdatedAt > existing.UpdatedAt {
		return s.UpdateProject(p)
	}
	return nil
}
