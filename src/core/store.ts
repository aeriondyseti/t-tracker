// SQLite store using bun:sqlite
// NOTE: This file uses bun:sqlite and requires Bun runtime

import { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";
import { runMigrations } from "./migrations.ts";
import type { Project, Task } from "./model.ts";
import { now } from "./model.ts";

export interface TaskFilters {
  projectId?: string;
  status?: string;
  tag?: string;
}

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    runMigrations(this.db);
    this.ensureInboxProject();
  }

  close(): void {
    this.db.close();
  }

  // --- Project CRUD ---

  createProject(p: Partial<Project> & { name: string }): Project {
    const project: Project = {
      id: p.id || uuidv7(),
      name: p.name,
      created_at: p.created_at || now(),
      updated_at: p.updated_at || now(),
      deleted_at: p.deleted_at || null,
    };

    this.db.run(
      "INSERT INTO projects (id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)",
      [project.id, project.name, project.created_at, project.updated_at, project.deleted_at],
    );

    return project;
  }

  getProject(id: string): Project | null {
    const row = this.db
      .query("SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE id = ?")
      .get(id) as Project | undefined;
    return row || null;
  }

  getProjectByName(name: string): Project | null {
    const row = this.db
      .query(
        "SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE name = ? AND deleted_at IS NULL",
      )
      .get(name) as Project | undefined;
    return row || null;
  }

  listProjects(): Project[] {
    return this.db
      .query(
        "SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE deleted_at IS NULL ORDER BY name",
      )
      .all() as Project[];
  }

  updateProject(p: Project): void {
    this.db.run("UPDATE projects SET name = ?, updated_at = ?, deleted_at = ? WHERE id = ?", [
      p.name,
      p.updated_at,
      p.deleted_at,
      p.id,
    ]);
  }

  getProjectsSince(since: number): Project[] {
    return this.db
      .query(
        "SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE updated_at > ? ORDER BY updated_at",
      )
      .all(since) as Project[];
  }

  upsertProject(p: Project): void {
    const existing = this.getProject(p.id);
    if (!existing) {
      this.createProject(p);
    } else if (p.updated_at > existing.updated_at) {
      this.updateProject(p);
    }
  }

  // --- Task CRUD ---

  createTask(t: Partial<Task> & { project_id: string; title: string }): Task {
    const task: Task = {
      id: t.id || uuidv7(),
      project_id: t.project_id,
      title: t.title,
      status: t.status || "inbox",
      notes: t.notes || "",
      tags: t.tags || [],
      created_at: t.created_at || now(),
      updated_at: t.updated_at || now(),
      deleted_at: t.deleted_at || null,
    };

    this.db.run(
      "INSERT INTO tasks (id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        task.id,
        task.project_id,
        task.title,
        task.status,
        task.notes,
        JSON.stringify(task.tags),
        task.created_at,
        task.updated_at,
        task.deleted_at,
      ],
    );

    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db
      .query(
        "SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE id = ?",
      )
      .get(id) as (Omit<Task, "tags"> & { tags: string }) | undefined;

    if (!row) return null;

    return {
      ...row,
      tags: JSON.parse(row.tags) as string[],
    };
  }

  listTasks(filters: TaskFilters = {}): Task[] {
    let query =
      "SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE deleted_at IS NULL";
    const params: string[] = [];

    if (filters.projectId) {
      query += " AND project_id = ?";
      params.push(filters.projectId);
    }

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters.tag) {
      query += " AND tags LIKE ?";
      params.push(`%${filters.tag}%`);
    }

    query += " ORDER BY created_at DESC";

    const rows = this.db.query(query).all(...params) as (Omit<Task, "tags"> & { tags: string })[];

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags) as string[],
    }));
  }

  updateTask(t: Task): void {
    this.db.run(
      "UPDATE tasks SET project_id = ?, title = ?, status = ?, notes = ?, tags = ?, updated_at = ?, deleted_at = ? WHERE id = ?",
      [
        t.project_id,
        t.title,
        t.status,
        t.notes,
        JSON.stringify(t.tags),
        t.updated_at,
        t.deleted_at,
        t.id,
      ],
    );
  }

  getTasksSince(since: number): Task[] {
    const rows = this.db
      .query(
        "SELECT id, project_id, title, status, notes, tags, created_at, updated_at, deleted_at FROM tasks WHERE updated_at > ? ORDER BY updated_at",
      )
      .all(since) as (Omit<Task, "tags"> & { tags: string })[];

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags) as string[],
    }));
  }

  upsertTask(t: Task): void {
    const existing = this.getTask(t.id);
    if (!existing) {
      this.createTask(t);
    } else if (t.updated_at > existing.updated_at) {
      this.updateTask(t);
    }
  }

  // --- Meta key-value storage ---

  getMeta(key: string): string | null {
    const row = this.db.query("SELECT value FROM _meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [key, value]);
  }

  // --- Helpers ---

  private ensureInboxProject(): void {
    const count = this.db
      .query("SELECT COUNT(*) as count FROM projects WHERE deleted_at IS NULL")
      .get() as { count: number };

    if (count.count === 0) {
      this.createProject({ name: "inbox" });
    }
  }
}
