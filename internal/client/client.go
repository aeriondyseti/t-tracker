package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/aerion/t/internal/model"
)

// Client communicates with the t-daemon over HTTP.
type Client struct {
	baseURL string
	http    *http.Client
}

// New creates a new Client for the daemon at the given address.
func New(addr string) *Client {
	return &Client{
		baseURL: "http://" + addr,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Health checks if the daemon is running.
func (c *Client) Health() error {
	resp, err := c.http.Get(c.baseURL + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("health check failed: %d", resp.StatusCode)
	}
	return nil
}

// CreateTask creates a new task.
func (c *Client) CreateTask(req CreateTaskRequest) (*model.Task, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Post(c.baseURL+"/tasks", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}
	var task model.Task
	if err := json.NewDecoder(resp.Body).Decode(&task); err != nil {
		return nil, err
	}
	return &task, nil
}

// CreateTaskRequest is the request for creating a task.
type CreateTaskRequest struct {
	Project string   `json:"project,omitempty"`
	Title   string   `json:"title"`
	Status  string   `json:"status,omitempty"`
	Tags    []string `json:"tags,omitempty"`
}

// UpdateTask updates an existing task.
func (c *Client) UpdateTask(id string, req UpdateTaskRequest) (*model.Task, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest("PATCH", c.baseURL+"/tasks/"+id, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}
	var task model.Task
	if err := json.NewDecoder(resp.Body).Decode(&task); err != nil {
		return nil, err
	}
	return &task, nil
}

// UpdateTaskRequest is the request for updating a task.
type UpdateTaskRequest struct {
	Status *string `json:"status,omitempty"`
	Title  *string `json:"title,omitempty"`
	Notes  *string `json:"notes,omitempty"`
	Tags   *[]string `json:"tags,omitempty"`
}

// ListTasks lists tasks, optionally filtered by project, status, or tag.
func (c *Client) ListTasks(filters ListTasksFilters) ([]*model.Task, error) {
	u, err := url.Parse(c.baseURL + "/tasks")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	if filters.Since > 0 {
		q.Set("since", strconv.FormatInt(filters.Since, 10))
	}
	u.RawQuery = q.Encode()

	resp, err := c.http.Get(u.String())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}

	// The API always returns {tasks, projects, server_time} format per §4
	var result struct {
		Tasks      []*model.Task     `json:"tasks"`
		Projects   []*model.Project  `json:"projects"`
		ServerTime int64             `json:"server_time"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.Tasks, nil
}

// ListTasksFilters defines filters for listing tasks.
type ListTasksFilters struct {
	Since int64
}

// GetTask retrieves a single task by ID.
func (c *Client) GetTask(id string) (*model.Task, error) {
	// The API doesn't have a GET /tasks/:id endpoint, so we list all and filter
	tasks, err := c.ListTasks(ListTasksFilters{})
	if err != nil {
		return nil, err
	}
	for _, t := range tasks {
		if t.ID == id {
			return t, nil
		}
	}
	return nil, fmt.Errorf("task not found: %s", id)
}

// CreateProject creates a new project.
func (c *Client) CreateProject(name string) (*model.Project, error) {
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Post(c.baseURL+"/projects", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}
	var project model.Project
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		return nil, err
	}
	return &project, nil
}

// ListProjects lists all projects.
func (c *Client) ListProjects() ([]*model.Project, error) {
	resp, err := c.http.Get(c.baseURL + "/projects")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}
	var projects []*model.Project
	if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
		return nil, err
	}
	return projects, nil
}

// UpdateProject updates a project (typically for soft delete).
func (c *Client) UpdateProject(id string, req UpdateProjectRequest) (*model.Project, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest("PATCH", c.baseURL+"/projects/"+id, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, c.parseError(resp)
	}
	var project model.Project
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		return nil, err
	}
	return &project, nil
}

// UpdateProjectRequest is the request for updating a project.
type UpdateProjectRequest struct {
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

func (c *Client) parseError(resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	var errResp struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
		return fmt.Errorf("daemon error (%d): %s", resp.StatusCode, errResp.Error)
	}
	return fmt.Errorf("daemon error (%d): %s", resp.StatusCode, string(body))
}
