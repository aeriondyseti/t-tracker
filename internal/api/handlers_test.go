package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aerion/t/internal/model"
	"github.com/aerion/t/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestServer(t *testing.T) (*httptest.Server, *store.Store) {
	t.Helper()
	s, err := store.New(":memory:")
	require.NoError(t, err)
	h := New(s)
	srv := httptest.NewServer(h.Router())
	t.Cleanup(func() {
		srv.Close()
		s.Close()
	})
	return srv, s
}

func doJSON(t *testing.T, method, url string, body interface{}) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	resp.Body.Close()
	return resp, b
}

func TestHealth(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, body := doJSON(t, "GET", srv.URL+"/health", nil)
	assert.Equal(t, 200, resp.StatusCode)
	assert.Contains(t, string(body), `"ok":true`)
}

func TestCreateAndListTask(t *testing.T) {
	srv, _ := newTestServer(t)

	resp, body := doJSON(t, "POST", srv.URL+"/tasks", map[string]interface{}{
		"title":   "buy milk",
		"project": "inbox",
		"tags":    []string{"errand"},
	})
	require.Equal(t, 200, resp.StatusCode, string(body))
	var task model.Task
	require.NoError(t, json.Unmarshal(body, &task))
	assert.NotEmpty(t, task.ID)
	assert.Equal(t, "buy milk", task.Title)
	assert.Equal(t, model.StatusInbox, task.Status)
	assert.Equal(t, []string{"errand"}, task.Tags)

	resp, body = doJSON(t, "GET", srv.URL+"/tasks", nil)
	require.Equal(t, 200, resp.StatusCode)
	var listed map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(body, &listed))
	var tasks []model.Task
	require.NoError(t, json.Unmarshal(listed["tasks"], &tasks))
	assert.Len(t, tasks, 1)
	assert.Equal(t, task.ID, tasks[0].ID)
}

func TestCreateTaskMissingTitle(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, _ := doJSON(t, "POST", srv.URL+"/tasks", map[string]string{"project": "inbox"})
	assert.Equal(t, 400, resp.StatusCode)
}

func TestCreateTaskUnknownProject(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, _ := doJSON(t, "POST", srv.URL+"/tasks", map[string]string{"title": "x", "project": "ghost"})
	assert.Equal(t, 400, resp.StatusCode)
}

func TestCreateTaskConflict(t *testing.T) {
	srv, _ := newTestServer(t)
	body := map[string]interface{}{"id": "fixed-id", "title": "x", "project": "inbox"}
	resp, _ := doJSON(t, "POST", srv.URL+"/tasks", body)
	require.Equal(t, 200, resp.StatusCode)
	resp, _ = doJSON(t, "POST", srv.URL+"/tasks", body)
	assert.Equal(t, 409, resp.StatusCode)
}

func TestUpdateTask(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, body := doJSON(t, "POST", srv.URL+"/tasks", map[string]interface{}{
		"title": "x", "project": "inbox",
	})
	require.Equal(t, 200, resp.StatusCode)
	var task model.Task
	require.NoError(t, json.Unmarshal(body, &task))

	resp, body = doJSON(t, "PATCH", srv.URL+"/tasks/"+task.ID, map[string]string{
		"status": "active",
	})
	require.Equal(t, 200, resp.StatusCode, string(body))
	var updated model.Task
	require.NoError(t, json.Unmarshal(body, &updated))
	assert.Equal(t, "active", updated.Status)
}

func TestUpdateTaskInvalidStatus(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, body := doJSON(t, "POST", srv.URL+"/tasks", map[string]interface{}{
		"title": "x", "project": "inbox",
	})
	require.Equal(t, 200, resp.StatusCode)
	var task model.Task
	require.NoError(t, json.Unmarshal(body, &task))

	resp, _ = doJSON(t, "PATCH", srv.URL+"/tasks/"+task.ID, map[string]string{"status": "garbage"})
	assert.Equal(t, 400, resp.StatusCode)
}

func TestUpdateTaskNotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, _ := doJSON(t, "PATCH", srv.URL+"/tasks/unknown-id", map[string]string{"status": "active"})
	assert.Equal(t, 404, resp.StatusCode)
}

func TestProjectsCRUD(t *testing.T) {
	srv, _ := newTestServer(t)

	resp, body := doJSON(t, "POST", srv.URL+"/projects", map[string]string{"name": "work"})
	require.Equal(t, 200, resp.StatusCode, string(body))
	var p model.Project
	require.NoError(t, json.Unmarshal(body, &p))
	assert.Equal(t, "work", p.Name)

	resp, body = doJSON(t, "GET", srv.URL+"/projects", nil)
	require.Equal(t, 200, resp.StatusCode)
	var ps []model.Project
	require.NoError(t, json.Unmarshal(body, &ps))
	names := []string{}
	for _, x := range ps {
		names = append(names, x.Name)
	}
	assert.Contains(t, names, "work")
	assert.Contains(t, names, "inbox")

	now := model.Now() + 1
	resp, _ = doJSON(t, "PATCH", srv.URL+"/projects/"+p.ID, map[string]interface{}{
		"deleted_at": now,
	})
	require.Equal(t, 200, resp.StatusCode)
}

func TestListSinceFilter(t *testing.T) {
	srv, s := newTestServer(t)
	// create one task at t0
	resp, body := doJSON(t, "POST", srv.URL+"/tasks", map[string]interface{}{
		"title": "old", "project": "inbox",
	})
	require.Equal(t, 200, resp.StatusCode)
	var old model.Task
	require.NoError(t, json.Unmarshal(body, &old))

	cutoff := old.UpdatedAt + 1
	_ = s

	// Create a newer task
	// sleep replaced by explicit timestamp via direct DB write? Use sufficient real-time gap.
	resp, body = doJSON(t, "POST", srv.URL+"/tasks", map[string]interface{}{
		"title": "new", "project": "inbox", "updated_at": cutoff + 10, "created_at": cutoff + 10,
	})
	require.Equal(t, 200, resp.StatusCode)

	resp, body = doJSON(t, "GET", srv.URL+"/tasks?since="+itoa(cutoff), nil)
	require.Equal(t, 200, resp.StatusCode)
	var listed map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(body, &listed))
	var tasks []model.Task
	require.NoError(t, json.Unmarshal(listed["tasks"], &tasks))
	assert.Len(t, tasks, 1)
	assert.Equal(t, "new", tasks[0].Title)
}

func itoa(n int64) string {
	return formatInt(n)
}

func formatInt(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
