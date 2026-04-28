// Hono HTTP handlers
import { Hono } from "hono";
import { z } from "zod";
import { isValidStatus, now } from "./model.ts";
import type { Status, Task } from "./model.ts";
import type { Store } from "./store.ts";

// Request schemas
const CreateTaskRequestSchema = z.object({
  id: z.string().optional(),
  project: z.string().optional(),
  project_id: z.string().optional(),
  title: z.string(),
  status: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.number().int().optional(),
  updated_at: z.number().int().optional(),
});

const UpdateTaskRequestSchema = z.object({
  project_id: z.string().optional(),
  project: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  updated_at: z.number().int().optional(),
  deleted_at: z.number().int().nullable().optional(),
});

const CreateProjectRequestSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  created_at: z.number().int().optional(),
  updated_at: z.number().int().optional(),
});

const UpdateProjectRequestSchema = z.object({
  name: z.string().optional(),
  updated_at: z.number().int().optional(),
  deleted_at: z.number().int().nullable().optional(),
});

export function createAPI(store: Store) {
  const app = new Hono();

  // Health check
  app.get("/health", (c) => {
    return c.json({ ok: true });
  });

  // List tasks - returns {tasks, projects, server_time} per SPEC §4
  app.get("/tasks", (c) => {
    const sinceParam = c.req.query("since");
    let tasks: Task[];

    if (sinceParam) {
      const since = Number.parseInt(sinceParam, 10);
      if (Number.isNaN(since)) {
        return c.json({ error: "invalid since parameter" }, 400);
      }
      tasks = store.getTasksSince(since);
    } else {
      tasks = store.listTasks();
    }

    const projects = sinceParam
      ? store.getProjectsSince(Number.parseInt(sinceParam, 10))
      : store.listProjects();

    return c.json({
      tasks,
      projects,
      server_time: now(),
    });
  });

  // Create task
  app.post("/tasks", async (c) => {
    const body = await c.req.json();
    const parsed = CreateTaskRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const req = parsed.data;

    if (!req.title) {
      return c.json({ error: "title required" }, 400);
    }

    // Resolve project_id from project name if needed
    let projectId = req.project_id;
    if (!projectId) {
      const projectName = req.project || "inbox";
      const project = store.getProjectByName(projectName);
      if (!project) {
        return c.json({ error: `project not found: ${projectName}` }, 400);
      }
      projectId = project.id;
    }

    // Check if task with this id already exists (for sync)
    if (req.id) {
      const existing = store.getTask(req.id);
      if (existing) {
        return c.json({ error: "task exists" }, 409);
      }
    }

    // Validate status if provided
    let status: Status | undefined = undefined;
    if (req.status) {
      if (!isValidStatus(req.status)) {
        return c.json({ error: "invalid status" }, 400);
      }
      status = req.status;
    }

    const task = store.createTask({
      id: req.id,
      project_id: projectId,
      title: req.title,
      status,
      notes: req.notes,
      tags: req.tags,
      created_at: req.created_at,
      updated_at: req.updated_at,
    });

    return c.json(task);
  });

  // Update task
  app.patch("/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const task = store.getTask(id);

    if (!task) {
      return c.json({ error: "task not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = UpdateTaskRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const req = parsed.data;

    // Resolve project if project name provided
    if (req.project) {
      const project = store.getProjectByName(req.project);
      if (!project) {
        return c.json({ error: "project not found" }, 400);
      }
      task.project_id = project.id;
    } else if (req.project_id) {
      task.project_id = req.project_id;
    }

    if (req.title !== undefined) task.title = req.title;
    if (req.status !== undefined) {
      if (!isValidStatus(req.status)) {
        return c.json({ error: "invalid status" }, 400);
      }
      task.status = req.status;
    }
    if (req.notes !== undefined) task.notes = req.notes;
    if (req.tags !== undefined) task.tags = req.tags;
    if (req.deleted_at !== undefined) task.deleted_at = req.deleted_at;

    task.updated_at = req.updated_at !== undefined ? req.updated_at : now();

    store.updateTask(task);
    return c.json(task);
  });

  // List projects
  app.get("/projects", (c) => {
    const projects = store.listProjects();
    return c.json(projects);
  });

  // Create project
  app.post("/projects", async (c) => {
    const body = await c.req.json();
    const parsed = CreateProjectRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const req = parsed.data;

    if (!req.name) {
      return c.json({ error: "name required" }, 400);
    }

    // Check if project with this id already exists (for sync)
    if (req.id) {
      const existing = store.getProject(req.id);
      if (existing) {
        return c.json({ error: "project exists" }, 409);
      }
    }

    // Check for duplicate name among live projects
    const existingByName = store.getProjectByName(req.name);
    if (existingByName) {
      return c.json({ error: "project with this name already exists" }, 400);
    }

    const project = store.createProject({
      id: req.id,
      name: req.name,
      created_at: req.created_at,
      updated_at: req.updated_at,
    });

    return c.json(project);
  });

  // Update project
  app.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const project = store.getProject(id);

    if (!project) {
      return c.json({ error: "project not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = UpdateProjectRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const req = parsed.data;

    if (req.name !== undefined) project.name = req.name;
    if (req.deleted_at !== undefined) project.deleted_at = req.deleted_at;

    project.updated_at = req.updated_at !== undefined ? req.updated_at : now();

    store.updateProject(project);
    return c.json(project);
  });

  return app;
}
