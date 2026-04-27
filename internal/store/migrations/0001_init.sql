-- +goose Up
-- +goose StatementBegin
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('inbox','active','blocked','done','archived')),
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated ON tasks(updated_at);

CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO _meta (key, value) VALUES ('last_sync_at', '0');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS _meta;
DROP INDEX IF EXISTS idx_tasks_updated;
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_project;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
-- +goose StatementEnd
