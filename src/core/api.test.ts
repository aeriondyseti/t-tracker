// API handler tests using Hono's app.request()
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAPI } from "./api.ts";
import { now } from "./model.ts";
import { Store } from "./store.ts";

// Helper to type-assert JSON responses
function asJSON<T>(value: unknown): T {
  return value as T;
}

describe("API", () => {
  let store: Store;
  let app: ReturnType<typeof createAPI>;

  beforeEach(() => {
    store = new Store(":memory:");
    app = createAPI(store);
  });

  afterEach(() => {
    store.close();
  });

  describe("GET /health", () => {
    test("returns ok", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body).toEqual({ ok: true });
    });
  });

  describe("GET /tasks", () => {
    test("returns tasks, projects, and server_time", async () => {
      const inbox = store.listProjects()[0];
      store.createTask({ project_id: inbox.id, title: "test task" });

      const res = await app.request("/tasks");
      expect(res.status).toBe(200);
      const body = asJSON<{
        tasks: Array<{ title: string }>;
        projects: unknown[];
        server_time: number;
      }>(await res.json());
      expect(body).toHaveProperty("tasks");
      expect(body).toHaveProperty("projects");
      expect(body).toHaveProperty("server_time");
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].title).toBe("test task");
    });

    test("filters by since parameter", async () => {
      const inbox = store.listProjects()[0];
      const before = now();
      Bun.sleepSync(5);
      store.createTask({ project_id: inbox.id, title: "recent" });

      const res = await app.request(`/tasks?since=${before}`);
      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].title).toBe("recent");
    });

    test("returns 400 for invalid since", async () => {
      const res = await app.request("/tasks?since=invalid");
      expect(res.status).toBe(400);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("invalid since");
    });
  });

  describe("POST /tasks", () => {
    test("creates a task", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "inbox",
          title: "new task",
          tags: ["urgent"],
        }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.title).toBe("new task");
      expect(body.tags).toEqual(["urgent"]);
      expect(body.status).toBe("inbox");
    });

    test("returns 400 for missing title", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: "inbox" }),
      });

      expect(res.status).toBe(400);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("invalid request body");
    });

    test("returns 400 for unknown project", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: "nonexistent",
          title: "test",
        }),
      });

      expect(res.status).toBe(400);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("project not found");
    });

    test("returns 409 for duplicate id", async () => {
      const inbox = store.listProjects()[0];
      const task = store.createTask({ project_id: inbox.id, title: "existing" });

      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          project: "inbox",
          title: "duplicate",
        }),
      });

      expect(res.status).toBe(409);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("task exists");
    });
  });

  describe("PATCH /tasks/:id", () => {
    test("updates a task", async () => {
      const inbox = store.listProjects()[0];
      const task = store.createTask({ project_id: inbox.id, title: "old" });

      const res = await app.request(`/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "new",
          status: "active",
        }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.title).toBe("new");
      expect(body.status).toBe("active");
    });

    test("returns 404 for unknown task", async () => {
      const res = await app.request("/tasks/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "new" }),
      });

      expect(res.status).toBe(404);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("not found");
    });

    test("soft-deletes a task via deleted_at", async () => {
      const inbox = store.listProjects()[0];
      const task = store.createTask({ project_id: inbox.id, title: "to-delete" });

      const res = await app.request(`/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted_at: now() }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.deleted_at).not.toBeNull();

      // Verify it doesn't appear in list
      const listRes = await app.request("/tasks");
      const listBody = asJSON<any>(await listRes.json());
      expect(listBody.tasks.find((t: { id: string }) => t.id === task.id)).toBeUndefined();
    });
  });

  describe("GET /projects", () => {
    test("returns live projects", async () => {
      store.createProject({ name: "work" });

      const res = await app.request("/projects");
      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body).toHaveLength(2); // inbox + work
      expect(body.map((p: { name: string }) => p.name)).toContain("inbox");
      expect(body.map((p: { name: string }) => p.name)).toContain("work");
    });
  });

  describe("POST /projects", () => {
    test("creates a project", async () => {
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "work" }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.name).toBe("work");
      expect(body.id).toBeTruthy();
    });

    test("returns 400 for missing name", async () => {
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("invalid request body");
    });

    test("returns 400 for duplicate live name", async () => {
      store.createProject({ name: "work" });

      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "work" }),
      });

      expect(res.status).toBe(400);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("already exists");
    });

    test("returns 409 for duplicate id", async () => {
      const project = store.createProject({ name: "work" });

      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          name: "duplicate",
        }),
      });

      expect(res.status).toBe(409);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("project exists");
    });
  });

  describe("PATCH /projects/:id", () => {
    test("updates a project", async () => {
      const project = store.createProject({ name: "old" });

      const res = await app.request(`/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new" }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.name).toBe("new");
    });

    test("returns 404 for unknown project", async () => {
      const res = await app.request("/projects/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new" }),
      });

      expect(res.status).toBe(404);
      const body = asJSON<any>(await res.json());
      expect(body.error).toContain("not found");
    });

    test("soft-deletes a project via deleted_at", async () => {
      const project = store.createProject({ name: "to-delete" });

      const res = await app.request(`/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted_at: now() }),
      });

      expect(res.status).toBe(200);
      const body = asJSON<any>(await res.json());
      expect(body.deleted_at).not.toBeNull();

      // Verify it doesn't appear in list
      const listRes = await app.request("/projects");
      const listBody = asJSON<any>(await listRes.json());
      expect(listBody.find((p: { id: string }) => p.id === project.id)).toBeUndefined();
    });
  });
});
