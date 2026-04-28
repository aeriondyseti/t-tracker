package client

import (
	"testing"

	"github.com/aerion/t/internal/api"
	"github.com/aerion/t/internal/model"
	"github.com/aerion/t/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
)

func TestClient(t *testing.T) {
	// Setup: create store and API server
	st, err := store.New(":memory:")
	require.NoError(t, err)
	defer st.Close()

	handlers := api.New(st)
	server := httptest.NewServer(handlers.Router())
	defer server.Close()

	// Create client pointing to test server
	client := &Client{
		baseURL: server.URL,
		http:    server.Client(),
	}

	// Test Health
	err = client.Health()
	require.NoError(t, err)

	// Test CreateProject
	project, err := client.CreateProject("test-project")
	require.NoError(t, err)
	assert.Equal(t, "test-project", project.Name)

	// Test ListProjects
	projects, err := client.ListProjects()
	require.NoError(t, err)
	assert.Len(t, projects, 2) // inbox + test-project

	// Test CreateTask
	task, err := client.CreateTask(CreateTaskRequest{
		Project: "test-project",
		Title:   "test task",
		Tags:    []string{"tag1"},
	})
	require.NoError(t, err)
	assert.Equal(t, "test task", task.Title)
	assert.Equal(t, model.StatusInbox, task.Status)
	assert.Equal(t, []string{"tag1"}, task.Tags)

	// Test ListTasks
	tasks, err := client.ListTasks(ListTasksFilters{})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)
	assert.Equal(t, "test task", tasks[0].Title)

	// Test UpdateTask
	status := model.StatusActive
	updated, err := client.UpdateTask(task.ID, UpdateTaskRequest{
		Status: &status,
	})
	require.NoError(t, err)
	assert.Equal(t, model.StatusActive, updated.Status)

	// Test GetTask (implicit via list)
	fetched, err := client.GetTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, task.ID, fetched.ID)
	assert.Equal(t, model.StatusActive, fetched.Status)

	// Test UpdateProject (soft delete)
	now := model.Now()
	deletedProject, err := client.UpdateProject(project.ID, UpdateProjectRequest{
		DeletedAt: &now,
	})
	require.NoError(t, err)
	assert.NotNil(t, deletedProject.DeletedAt)

	// Verify project is soft deleted
	projects, err = client.ListProjects()
	require.NoError(t, err)
	assert.Len(t, projects, 1) // only inbox remains
}

func TestClientListTasksWithSince(t *testing.T) {
	st, err := store.New(":memory:")
	require.NoError(t, err)
	defer st.Close()

	handlers := api.New(st)
	server := httptest.NewServer(handlers.Router())
	defer server.Close()

	client := &Client{
		baseURL: server.URL,
		http:    server.Client(),
	}

	// Create a task
	task, err := client.CreateTask(CreateTaskRequest{
		Project: "inbox",
		Title:   "task1",
	})
	require.NoError(t, err)

	// List tasks with since parameter
	tasks, err := client.ListTasks(ListTasksFilters{Since: task.CreatedAt - 1})
	require.NoError(t, err)
	assert.Len(t, tasks, 1)
}

func TestClientErrors(t *testing.T) {
	st, err := store.New(":memory:")
	require.NoError(t, err)
	defer st.Close()

	handlers := api.New(st)
	server := httptest.NewServer(handlers.Router())
	defer server.Close()

	client := &Client{
		baseURL: server.URL,
		http:    server.Client(),
	}

	// Test creating task with missing title
	_, err = client.CreateTask(CreateTaskRequest{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "title required")

	// Test updating non-existent task
	status := model.StatusActive
	_, err = client.UpdateTask("nonexistent", UpdateTaskRequest{Status: &status})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	// Test creating task with invalid project
	_, err = client.CreateTask(CreateTaskRequest{
		Project: "nonexistent",
		Title:   "test",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "project not found")
}
