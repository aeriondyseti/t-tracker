package store

import (
	"testing"
	"time"

	"github.com/aerion/t/internal/model"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	// Verify inbox project was created
	inbox, err := s.GetProjectByName("inbox")
	require.NoError(t, err)
	require.NotNil(t, inbox)
	assert.Equal(t, "inbox", inbox.Name)
}

func TestProjectCRUD(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	now := model.Now()
	p := &model.Project{
		ID:        uuid.Must(uuid.NewV7()).String(),
		Name:      "test-project",
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Create
	err = s.CreateProject(p)
	require.NoError(t, err)

	// Read by ID
	got, err := s.GetProject(p.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, p.ID, got.ID)
	assert.Equal(t, p.Name, got.Name)

	// Read by name
	got, err = s.GetProjectByName("test-project")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, p.ID, got.ID)

	// List
	projects, err := s.ListProjects()
	require.NoError(t, err)
	assert.Len(t, projects, 2) // inbox + test-project

	// Update
	p.Name = "updated-project"
	p.UpdatedAt = model.Now()
	err = s.UpdateProject(p)
	require.NoError(t, err)

	got, err = s.GetProject(p.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated-project", got.Name)

	// Soft delete
	deletedAt := model.Now()
	p.DeletedAt = &deletedAt
	err = s.UpdateProject(p)
	require.NoError(t, err)

	// Should not appear in list
	projects, err = s.ListProjects()
	require.NoError(t, err)
	assert.Len(t, projects, 1) // only inbox

	// But should still be retrievable by ID
	got, err = s.GetProject(p.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.NotNil(t, got.DeletedAt)
}

func TestTaskCRUD(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	inbox, err := s.GetProjectByName("inbox")
	require.NoError(t, err)

	now := model.Now()
	task := &model.Task{
		ID:        uuid.Must(uuid.NewV7()).String(),
		ProjectID: inbox.ID,
		Title:     "test task",
		Status:    model.StatusInbox,
		Notes:     "some notes",
		Tags:      []string{"tag1", "tag2"},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Create
	err = s.CreateTask(task)
	require.NoError(t, err)

	// Read
	got, err := s.GetTask(task.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, task.ID, got.ID)
	assert.Equal(t, task.Title, got.Title)
	assert.Equal(t, task.Status, got.Status)
	assert.Equal(t, task.Notes, got.Notes)
	assert.Equal(t, task.Tags, got.Tags)

	// List all
	tasks, err := s.ListTasks(TaskFilters{})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)

	// List by project
	tasks, err = s.ListTasks(TaskFilters{ProjectID: inbox.ID})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)

	// List by status
	tasks, err = s.ListTasks(TaskFilters{Status: model.StatusInbox})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)

	// List by tag
	tasks, err = s.ListTasks(TaskFilters{Tag: "tag1"})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)

	// Update
	task.Status = model.StatusActive
	task.UpdatedAt = model.Now()
	err = s.UpdateTask(task)
	require.NoError(t, err)

	got, err = s.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.StatusActive, got.Status)

	// Soft delete
	deletedAt := model.Now()
	task.DeletedAt = &deletedAt
	err = s.UpdateTask(task)
	require.NoError(t, err)

	// Should not appear in list
	tasks, err = s.ListTasks(TaskFilters{})
	require.NoError(t, err)
	assert.Len(t, tasks, 0)

	// But should still be retrievable by ID
	got, err = s.GetTask(task.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.NotNil(t, got.DeletedAt)
}

func TestTaskWithEmptyTags(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	inbox, err := s.GetProjectByName("inbox")
	require.NoError(t, err)

	now := model.Now()
	task := &model.Task{
		ID:        uuid.Must(uuid.NewV7()).String(),
		ProjectID: inbox.ID,
		Title:     "no tags",
		Status:    model.StatusInbox,
		Notes:     "",
		Tags:      []string{},
		CreatedAt: now,
		UpdatedAt: now,
	}

	err = s.CreateTask(task)
	require.NoError(t, err)

	got, err := s.GetTask(task.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Empty(t, got.Tags)
}

func TestGetTasksSince(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	inbox, err := s.GetProjectByName("inbox")
	require.NoError(t, err)

	now := model.Now()

	// Create task at time T
	task1 := &model.Task{
		ID:        uuid.Must(uuid.NewV7()).String(),
		ProjectID: inbox.ID,
		Title:     "task 1",
		Status:    model.StatusInbox,
		CreatedAt: now,
		UpdatedAt: now,
	}
	err = s.CreateTask(task1)
	require.NoError(t, err)

	// Create task at time T+1
	task2 := &model.Task{
		ID:        uuid.Must(uuid.NewV7()).String(),
		ProjectID: inbox.ID,
		Title:     "task 2",
		Status:    model.StatusInbox,
		CreatedAt: now + 1,
		UpdatedAt: now + 1,
	}
	err = s.CreateTask(task2)
	require.NoError(t, err)

	// Get tasks since T
	tasks, err := s.GetTasksSince(now)
	require.NoError(t, err)
	assert.Len(t, tasks, 1)
	assert.Equal(t, task2.ID, tasks[0].ID)

	// Get tasks since T-1
	tasks, err = s.GetTasksSince(now - 1)
	require.NoError(t, err)
	assert.Len(t, tasks, 2)
}

func TestGetProjectsSince(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	// Ensure a millisecond gap between inbox creation and `now`.
	time.Sleep(2 * time.Millisecond)
	now := model.Now()

	p := &model.Project{
		ID:        uuid.Must(uuid.NewV7()).String(),
		Name:      "new-project",
		CreatedAt: now,
		UpdatedAt: now,
	}
	err = s.CreateProject(p)
	require.NoError(t, err)

	projects, err := s.GetProjectsSince(now - 1)
	require.NoError(t, err)
	assert.Len(t, projects, 1)
	assert.Equal(t, p.ID, projects[0].ID)
}

func TestMeta(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	// Get default last_sync_at
	val, err := s.GetMeta("last_sync_at")
	require.NoError(t, err)
	assert.Equal(t, "0", val)

	// Set new value
	err = s.SetMeta("last_sync_at", "12345")
	require.NoError(t, err)

	val, err = s.GetMeta("last_sync_at")
	require.NoError(t, err)
	assert.Equal(t, "12345", val)

	// Get non-existent key
	val, err = s.GetMeta("nonexistent")
	require.NoError(t, err)
	assert.Equal(t, "", val)
}

func TestUpsertTask(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	inbox, err := s.GetProjectByName("inbox")
	require.NoError(t, err)

	now := model.Now()
	task := &model.Task{
		ID:        uuid.Must(uuid.NewV7()).String(),
		ProjectID: inbox.ID,
		Title:     "original",
		Status:    model.StatusInbox,
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Upsert new task
	err = s.UpsertTask(task)
	require.NoError(t, err)

	got, err := s.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "original", got.Title)

	// Upsert with newer timestamp
	task.Title = "updated"
	task.UpdatedAt = now + 1
	err = s.UpsertTask(task)
	require.NoError(t, err)

	got, err = s.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated", got.Title)

	// Upsert with older timestamp (should not update)
	task.Title = "should not apply"
	task.UpdatedAt = now - 1
	err = s.UpsertTask(task)
	require.NoError(t, err)

	got, err = s.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated", got.Title)
}

func TestUpsertProject(t *testing.T) {
	s, err := New(":memory:")
	require.NoError(t, err)
	defer s.Close()

	now := model.Now()
	p := &model.Project{
		ID:        uuid.Must(uuid.NewV7()).String(),
		Name:      "original",
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Upsert new project
	err = s.UpsertProject(p)
	require.NoError(t, err)

	got, err := s.GetProject(p.ID)
	require.NoError(t, err)
	assert.Equal(t, "original", got.Name)

	// Upsert with newer timestamp
	p.Name = "updated"
	p.UpdatedAt = now + 1
	err = s.UpsertProject(p)
	require.NoError(t, err)

	got, err = s.GetProject(p.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated", got.Name)

	// Upsert with older timestamp (should not update)
	p.Name = "should not apply"
	p.UpdatedAt = now - 1
	err = s.UpsertProject(p)
	require.NoError(t, err)

	got, err = s.GetProject(p.ID)
	require.NoError(t, err)
	assert.Equal(t, "updated", got.Name)
}
