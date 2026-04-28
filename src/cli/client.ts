// Typed HTTP client to daemon
import type { Project, Task } from "../core/model.ts";

const DAEMON_ADDR = "http://127.0.0.1:9999";

export class DaemonClient {
  private baseURL: string;

  constructor(addr = DAEMON_ADDR) {
    this.baseURL = addr;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async createTask(req: {
    project?: string;
    title: string;
    tags?: string[];
  }): Promise<Task> {
    const res = await fetch(`${this.baseURL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async listTasks(): Promise<{ tasks: Task[]; projects: Project[] }> {
    const res = await fetch(`${this.baseURL}/tasks`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async updateTask(
    id: string,
    updates: {
      status?: string;
      title?: string;
      notes?: string;
      tags?: string[];
    },
  ): Promise<Task> {
    const res = await fetch(`${this.baseURL}/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async listProjects(): Promise<Project[]> {
    const res = await fetch(`${this.baseURL}/projects`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async createProject(name: string): Promise<Project> {
    const res = await fetch(`${this.baseURL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async updateProject(id: string, updates: { deleted_at?: number }): Promise<Project> {
    const res = await fetch(`${this.baseURL}/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  }
}

// Helper: resolve ID prefix to full ID
export async function resolveIDPrefix(client: DaemonClient, prefix: string): Promise<string> {
  const { tasks } = await client.listTasks();
  const matches = tasks.filter((t) => t.id.startsWith(prefix));

  if (matches.length === 0) {
    throw new Error(`no task found with prefix: ${prefix}`);
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous prefix ${prefix}: matches ${matches.length} tasks`);
  }

  return matches[0].id;
}
