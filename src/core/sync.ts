// Sync engine: daemon → server synchronization (§4 of SPEC.md).
// Last-write-wins per row on `updated_at`. Algorithm exactly per §4.
//
// `core/` is Bun-tolerant but Bun-free (§1.1). This module uses only the
// Web fetch API and a plain Store dependency; no `bun:sqlite`, no `Bun.*`.

import { z } from "zod";
import { ProjectSchema, TaskSchema } from "./model.ts";
import type { Project, Task } from "./model.ts";
import type { Store } from "./store.ts";

const META_LAST_SYNC = "last_sync_at";

const SyncResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  projects: z.array(ProjectSchema),
  server_time: z.number().int(),
});

export interface SyncStats {
  pulled_projects: number;
  pulled_tasks: number;
  pushed_projects: number;
  pushed_tasks: number;
  conflicts_resolved: number;
  errors: string[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncOptions {
  serverURL: string;
  serverToken: string;
  fetch?: FetchLike;
}

export class SyncEngine {
  isApplyingRemote = false;
  private readonly store: Store;
  private readonly serverURL: string;
  private readonly token: string;
  private readonly fetchFn: FetchLike;

  constructor(store: Store, opts: SyncOptions) {
    this.store = store;
    this.serverURL = opts.serverURL.replace(/\/$/, "");
    this.token = opts.serverToken;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  private getLastSyncAt(): number {
    const raw = this.store.getMeta(META_LAST_SYNC);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  private setLastSyncAt(v: number): void {
    this.store.setMeta(META_LAST_SYNC, String(v));
  }

  async runSync(): Promise<SyncStats> {
    const stats: SyncStats = {
      pulled_projects: 0,
      pulled_tasks: 0,
      pushed_projects: 0,
      pushed_tasks: 0,
      conflicts_resolved: 0,
      errors: [],
    };

    const since = this.getLastSyncAt();

    // --- Step 2: pull ---
    let pulled: { tasks: Task[]; projects: Project[]; server_time: number };
    try {
      const url = `${this.serverURL}/tasks?since=${since}`;
      const res = await this.fetchFn(url, {
        method: "GET",
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        stats.errors.push(`pull: HTTP ${res.status}`);
        return stats;
      }
      pulled = SyncResponseSchema.parse(await res.json());
    } catch (err) {
      stats.errors.push(`pull: ${err instanceof Error ? err.message : String(err)}`);
      return stats;
    }

    // --- Step 3: apply remote, tracking applied IDs ---
    const appliedProjectIds = new Set<string>();
    const appliedTaskIds = new Set<string>();

    this.isApplyingRemote = true;
    try {
      for (const remote of pulled.projects) {
        const local = this.store.getProject(remote.id);
        if (local && local.updated_at >= remote.updated_at) continue;
        this.store.upsertProject(remote);
        appliedProjectIds.add(remote.id);
        stats.pulled_projects++;
      }
      for (const remote of pulled.tasks) {
        const local = this.store.getTask(remote.id);
        if (local && local.updated_at >= remote.updated_at) continue;
        this.store.upsertTask(remote);
        appliedTaskIds.add(remote.id);
        stats.pulled_tasks++;
      }
    } finally {
      this.isApplyingRemote = false;
    }

    // --- Step 4: collect local rows changed since last sync, minus applied ---
    const localProjects = this.store
      .getProjectsSince(since)
      .filter((p) => !appliedProjectIds.has(p.id));
    const localTasks = this.store.getTasksSince(since).filter((t) => !appliedTaskIds.has(t.id));

    // --- Step 5: push (POST → 409 retry as PATCH) ---
    for (const p of localProjects) {
      const result = await this.pushProject(p);
      if (result === "error") return abortNoAdvance(stats, "push project");
      if (result === "conflict") stats.conflicts_resolved++;
      stats.pushed_projects++;
    }
    for (const t of localTasks) {
      const result = await this.pushTask(t);
      if (result === "error") return abortNoAdvance(stats, "push task");
      if (result === "conflict") stats.conflicts_resolved++;
      stats.pushed_tasks++;
    }

    // --- Step 6: advance last_sync_at to server_time from step 2 ---
    this.setLastSyncAt(pulled.server_time);
    return stats;
  }

  private async pushProject(p: Project): Promise<"ok" | "conflict" | "error"> {
    const body = JSON.stringify(p);
    const post = await this.fetchFn(`${this.serverURL}/projects`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body,
    });
    if (post.ok) return "ok";
    if (post.status === 409) {
      const patch = await this.fetchFn(`${this.serverURL}/projects/${p.id}`, {
        method: "PATCH",
        headers: this.authHeaders({ "Content-Type": "application/json" }),
        body,
      });
      return patch.ok ? "conflict" : "error";
    }
    return "error";
  }

  private async pushTask(t: Task): Promise<"ok" | "conflict" | "error"> {
    const body = JSON.stringify(t);
    const post = await this.fetchFn(`${this.serverURL}/tasks`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body,
    });
    if (post.ok) return "ok";
    if (post.status === 409) {
      const patch = await this.fetchFn(`${this.serverURL}/tasks/${t.id}`, {
        method: "PATCH",
        headers: this.authHeaders({ "Content-Type": "application/json" }),
        body,
      });
      return patch.ok ? "conflict" : "error";
    }
    return "error";
  }
}

function abortNoAdvance(stats: SyncStats, where: string): SyncStats {
  stats.errors.push(`${where}: aborted; last_sync_at unchanged`);
  return stats;
}
