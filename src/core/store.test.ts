// Store unit tests using bun:test and in-memory SQLite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project, Task } from "./model.ts";
import { now } from "./model.ts";
import { Store } from "./store.ts";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("Project CRUD", () => {
    test("creates inbox project on init", () => {
      const projects = store.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("inbox");
    });

    test("creates a project", () => {
      const p = store.createProject({ name: "work" });
      expect(p.id).toBeTruthy();
      expect(p.name).toBe("work");
      expect(p.created_at).toBeGreaterThan(0);
      expect(p.updated_at).toEqual(p.created_at);
      expect(p.deleted_at).toBeNull();
    });

    test("gets a project by id", () => {
      const p = store.createProject({ name: "work" });
      const fetched = store.getProject(p.id);
      expect(fetched).toEqual(p);
    });

    test("gets a project by name", () => {
      const p = store.createProject({ name: "work" });
      const fetched = store.getProjectByName("work");
      expect(fetched).toEqual(p);
    });

    test("lists only non-deleted projects", () => {
      store.createProject({ name: "work" });
      const p2 = store.createProject({ name: "archived" });
      p2.deleted_at = now();
      store.updateProject(p2);

      const projects = store.listProjects();
      expect(projects).toHaveLength(2); // inbox + work
      expect(projects.map((p) => p.name)).toContain("inbox");
      expect(projects.map((p) => p.name)).toContain("work");
      expect(projects.map((p) => p.name)).not.toContain("archived");
    });

    test("updates a project", () => {
      const p = store.createProject({ name: "work" });
      p.name = "work-renamed";
      p.updated_at = now();
      store.updateProject(p);

      const fetched = store.getProject(p.id);
      expect(fetched?.name).toBe("work-renamed");
    });

    test("soft-deletes a project", () => {
      const p = store.createProject({ name: "work" });
      p.deleted_at = now();
      p.updated_at = now();
      store.updateProject(p);

      const projects = store.listProjects();
      expect(projects.map((p) => p.name)).not.toContain("work");

      const fetched = store.getProject(p.id);
      expect(fetched?.deleted_at).not.toBeNull();
    });

    test("getProjectsSince returns projects updated after timestamp", () => {
      const before = now();
      Bun.sleepSync(5); // Ensure timestamp advances
      const p1 = store.createProject({ name: "recent" });
      const p2 = store.createProject({ name: "also-recent" });

      const since = store.getProjectsSince(before);
      expect(since).toHaveLength(2);
      expect(since.map((p) => p.name)).toContain("recent");
    });

    test("upsertProject creates if not exists", () => {
      const p: Project = {
        id: "uuid-1",
        name: "new-project",
        created_at: now(),
        updated_at: now(),
        deleted_at: null,
      };

      store.upsertProject(p);
      const fetched = store.getProject("uuid-1");
      expect(fetched?.name).toBe("new-project");
    });

    test("upsertProject updates if remote is newer", () => {
      const p = store.createProject({ name: "old" });
      const remote: Project = {
        ...p,
        name: "new",
        updated_at: p.updated_at + 1000,
      };

      store.upsertProject(remote);
      const fetched = store.getProject(p.id);
      expect(fetched?.name).toBe("new");
    });

    test("upsertProject skips if local is newer", () => {
      const local = store.createProject({ name: "local" });
      const remote: Project = {
        ...local,
        name: "remote",
        updated_at: local.updated_at - 1000,
      };

      store.upsertProject(remote);
      const fetched = store.getProject(local.id);
      expect(fetched?.name).toBe("local");
    });
  });

  describe("Task CRUD", () => {
    let inbox: Project;

    beforeEach(() => {
      inbox = store.listProjects()[0]; // inbox is auto-created
    });

    test("creates a task", () => {
      const t = store.createTask({ project_id: inbox.id, title: "test task" });
      expect(t.id).toBeTruthy();
      expect(t.title).toBe("test task");
      expect(t.status).toBe("inbox");
      expect(t.notes).toBe("");
      expect(t.tags).toEqual([]);
      expect(t.created_at).toBeGreaterThan(0);
      expect(t.deleted_at).toBeNull();
    });

    test("creates a task with tags", () => {
      const t = store.createTask({
        project_id: inbox.id,
        title: "tagged",
        tags: ["urgent", "bug"],
      });
      expect(t.tags).toEqual(["urgent", "bug"]);
    });

    test("gets a task by id", () => {
      const t = store.createTask({ project_id: inbox.id, title: "test" });
      const fetched = store.getTask(t.id);
      expect(fetched).toEqual(t);
    });

    test("lists tasks with filters", () => {
      const work = store.createProject({ name: "work" });
      store.createTask({ project_id: inbox.id, title: "inbox task", status: "inbox" });
      store.createTask({ project_id: work.id, title: "work task", status: "active" });
      store.createTask({
        project_id: inbox.id,
        title: "urgent task",
        tags: ["urgent"],
      });

      // Filter by project
      const workTasks = store.listTasks({ projectId: work.id });
      expect(workTasks).toHaveLength(1);
      expect(workTasks[0].title).toBe("work task");

      // Filter by status
      const activeTasks = store.listTasks({ status: "active" });
      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0].title).toBe("work task");

      // Filter by tag
      const urgentTasks = store.listTasks({ tag: "urgent" });
      expect(urgentTasks).toHaveLength(1);
      expect(urgentTasks[0].title).toBe("urgent task");
    });

    test("updates a task", () => {
      const t = store.createTask({ project_id: inbox.id, title: "old" });
      t.title = "new";
      t.status = "active";
      t.updated_at = now();
      store.updateTask(t);

      const fetched = store.getTask(t.id);
      expect(fetched?.title).toBe("new");
      expect(fetched?.status).toBe("active");
    });

    test("soft-deletes a task", () => {
      const t = store.createTask({ project_id: inbox.id, title: "to-delete" });
      t.deleted_at = now();
      t.updated_at = now();
      store.updateTask(t);

      const tasks = store.listTasks();
      expect(tasks.map((t) => t.title)).not.toContain("to-delete");

      const fetched = store.getTask(t.id);
      expect(fetched?.deleted_at).not.toBeNull();
    });

    test("getTasksSince returns tasks updated after timestamp", () => {
      const before = now();
      Bun.sleepSync(5);
      store.createTask({ project_id: inbox.id, title: "recent" });

      const since = store.getTasksSince(before);
      expect(since).toHaveLength(1);
      expect(since[0].title).toBe("recent");
    });

    test("upsertTask creates if not exists", () => {
      const t: Task = {
        id: "uuid-task-1",
        project_id: inbox.id,
        title: "new task",
        status: "inbox",
        notes: "",
        tags: [],
        created_at: now(),
        updated_at: now(),
        deleted_at: null,
      };

      store.upsertTask(t);
      const fetched = store.getTask("uuid-task-1");
      expect(fetched?.title).toBe("new task");
    });

    test("upsertTask updates if remote is newer", () => {
      const local = store.createTask({ project_id: inbox.id, title: "old" });
      const remote: Task = {
        ...local,
        title: "new",
        updated_at: local.updated_at + 1000,
      };

      store.upsertTask(remote);
      const fetched = store.getTask(local.id);
      expect(fetched?.title).toBe("new");
    });

    test("upsertTask skips if local is newer", () => {
      const local = store.createTask({ project_id: inbox.id, title: "local" });
      const remote: Task = {
        ...local,
        title: "remote",
        updated_at: local.updated_at - 1000,
      };

      store.upsertTask(remote);
      const fetched = store.getTask(local.id);
      expect(fetched?.title).toBe("local");
    });
  });

  describe("Meta storage", () => {
    test("sets and gets meta values", () => {
      store.setMeta("last_sync_at", "12345");
      const val = store.getMeta("last_sync_at");
      expect(val).toBe("12345");
    });

    test("returns null for missing meta key", () => {
      const val = store.getMeta("nonexistent");
      expect(val).toBeNull();
    });

    test("replaces existing meta value", () => {
      store.setMeta("key", "old");
      store.setMeta("key", "new");
      expect(store.getMeta("key")).toBe("new");
    });
  });
});
