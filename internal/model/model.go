package model

import (
	"encoding/json"
	"time"
)

// Project represents a project/category for tasks.
type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"` // unix millis
	UpdatedAt int64  `json:"updated_at"` // unix millis
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

// Task represents a single task.
type Task struct {
	ID        string   `json:"id"`
	ProjectID string   `json:"project_id"`
	Title     string   `json:"title"`
	Status    string   `json:"status"`
	Notes     string   `json:"notes"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"` // unix millis
	UpdatedAt int64    `json:"updated_at"` // unix millis
	DeletedAt *int64   `json:"deleted_at,omitempty"`
}

// TaskStatus constants
const (
	StatusInbox    = "inbox"
	StatusActive   = "active"
	StatusBlocked  = "blocked"
	StatusDone     = "done"
	StatusArchived = "archived"
)

// ValidStatuses is the list of valid task statuses.
var ValidStatuses = []string{
	StatusInbox,
	StatusActive,
	StatusBlocked,
	StatusDone,
	StatusArchived,
}

// IsValidStatus checks if a status string is valid.
func IsValidStatus(status string) bool {
	for _, s := range ValidStatuses {
		if s == status {
			return true
		}
	}
	return false
}

// Now returns the current time in unix milliseconds.
func Now() int64 {
	return time.Now().UnixMilli()
}

// MarshalTags converts a []string to JSON for storage.
func MarshalTags(tags []string) (string, error) {
	if tags == nil {
		tags = []string{}
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// UnmarshalTags converts a JSON string back to []string.
func UnmarshalTags(s string) ([]string, error) {
	if s == "" {
		return []string{}, nil
	}
	var tags []string
	if err := json.Unmarshal([]byte(s), &tags); err != nil {
		return nil, err
	}
	return tags, nil
}
