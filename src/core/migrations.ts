// Hand-rolled database migrations
// Per SPEC §1: _meta row tracks schema_version, ordered array of { version, up: (db) => void }

import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: (db: Database) => {
      // Create projects table
      db.run(`
        CREATE TABLE projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        )
      `);

      // Partial unique index: allows recreating a project after soft-delete (SPEC §3)
      db.run(`
        CREATE UNIQUE INDEX idx_projects_name_live
          ON projects(name) WHERE deleted_at IS NULL
      `);

      // Create tasks table
      db.run(`
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
        )
      `);

      db.run("CREATE INDEX idx_tasks_project ON tasks(project_id)");
      db.run("CREATE INDEX idx_tasks_status ON tasks(status)");
      db.run("CREATE INDEX idx_tasks_updated ON tasks(updated_at)");

      // Create _meta table for sync state
      db.run(`
        CREATE TABLE _meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Initialize schema_version
      db.run(`INSERT INTO _meta (key, value) VALUES ('schema_version', '1')`);
    },
  },
];

export function runMigrations(db: Database): void {
  // Enable foreign keys
  db.run("PRAGMA foreign_keys = ON");

  // Get current schema version
  let currentVersion = 0;
  try {
    const row = db.query("SELECT value FROM _meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (row) {
      currentVersion = Number.parseInt(row.value, 10);
    }
  } catch {
    // _meta table doesn't exist yet; version is 0
  }

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      migration.up(db);
      // Update schema_version if _meta exists (migration 1 creates it)
      if (migration.version > 1) {
        db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", [
          migration.version.toString(),
        ]);
      }
    }
  }
}
