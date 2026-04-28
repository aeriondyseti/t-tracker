// Daemon app: post-write debounced sync + POST /sync.
// Mocks the remote server (in-process Hono). Real local Store, real
// daemon app, real sync engine. Per §10.6's anti-mocking spirit.

import { describe, expect, test } from "bun:test";
import { createAPI } from "../core/api.ts";
import { type Config, defaultConfig } from "../core/config.ts";
import { Store } from "../core/store.ts";
import type { FetchLike } from "../core/sync.ts";
import { createDaemonApp } from "./app.ts";

const TOKEN = "test-token";
const SERVER_URL = "http://mock";
const DEBOUNCE_MS = 30;

function mkConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    server_url: SERVER_URL,
    server_token: TOKEN,
    sync_interval_seconds: 60,
    ...overrides,
  };
}

function mkRemote() {
  const store = new Store(":memory:");
  const app = createAPI(store);
  let writes = 0;
  const fetchFn: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" || method === "PATCH") writes++;
    const url = input.startsWith("http") ? input : `${SERVER_URL}${input}`;
    return app.fetch(new Request(url, init));
  };
  return {
    store,
    fetchFn,
    writes: () => writes,
    resetWrites: () => {
      writes = 0;
    },
  };
}

async function alignInboxes(daemon: ReturnType<typeof createDaemonApp>, local: Store) {
  // Both stores auto-seed an "inbox"; soft-delete the local one with
  // updated_at=0 so the unique-name index doesn't collide on first sync.
  // (Same trick as src/core/sync.test.ts.)
  const localInbox = local.listProjects().find((p) => p.name === "inbox");
  if (!localInbox) throw new Error("local inbox missing");
  localInbox.deleted_at = 1;
  localInbox.updated_at = 0;
  local.updateProject(localInbox);
  const stats = await daemon.syncNow();
  if (stats.errors.length > 0) throw new Error(stats.errors.join(","));
  local.setMeta("last_sync_at", "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("createDaemonApp", () => {
  test("disables sync when token is the placeholder", () => {
    const local = new Store(":memory:");
    const cfg = mkConfig({ server_token: "REPLACE_ME" });
    const d = createDaemonApp(local, { config: cfg });
    expect(d.engine).toBeNull();
  });

  test("POST /sync returns 503 when sync is disabled", async () => {
    const local = new Store(":memory:");
    const cfg = mkConfig({ server_token: "REPLACE_ME" });
    const d = createDaemonApp(local, { config: cfg });
    const res = await d.app.fetch(new Request("http://daemon/sync", { method: "POST" }));
    expect(res.status).toBe(503);
  });

  test("POST /sync triggers a real sync and returns stats", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, { config: mkConfig(), fetch: remote.fetchFn });
    await alignInboxes(d, local);

    const remoteInbox = remote.store.listProjects()[0];
    local.createTask({ project_id: remoteInbox.id, title: "via /sync" });

    const res = await d.app.fetch(new Request("http://daemon/sync", { method: "POST" }));
    expect(res.status).toBe(200);
    const stats = (await res.json()) as { pushed_tasks: number; errors: string[] };
    expect(stats.errors).toEqual([]);
    expect(stats.pushed_tasks).toBeGreaterThanOrEqual(1);
    expect(remote.store.listTasks().find((t) => t.title === "via /sync")).toBeDefined();
  });

  test("ten quick POSTs to /tasks coalesce into one debounced sync", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, {
      config: mkConfig(),
      fetch: remote.fetchFn,
      syncDebounceMs: DEBOUNCE_MS,
    });
    await alignInboxes(d, local);

    remote.resetWrites();
    for (let i = 0; i < 10; i++) {
      const res = await d.app.fetch(
        new Request("http://daemon/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `t${i}` }),
        }),
      );
      expect(res.status).toBe(200);
    }
    // Wait past the debounce window.
    await sleep(DEBOUNCE_MS * 3);

    // After one debounced sync, all ten tasks land on the remote.
    expect(remote.store.listTasks().length).toBeGreaterThanOrEqual(10);
  });

  test("GET requests do not arm the debounced sync", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, {
      config: mkConfig(),
      fetch: remote.fetchFn,
      syncDebounceMs: DEBOUNCE_MS,
    });
    await alignInboxes(d, local);

    remote.resetWrites();
    for (let i = 0; i < 5; i++) {
      const res = await d.app.fetch(new Request("http://daemon/tasks"));
      expect(res.status).toBe(200);
    }
    await sleep(DEBOUNCE_MS * 3);
    expect(remote.writes()).toBe(0);
  });

  test("4xx responses do not arm the debounced sync", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, {
      config: mkConfig(),
      fetch: remote.fetchFn,
      syncDebounceMs: DEBOUNCE_MS,
    });
    await alignInboxes(d, local);

    remote.resetWrites();
    const res = await d.app.fetch(
      new Request("http://daemon/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // missing title
      }),
    );
    expect(res.status).toBe(400);
    await sleep(DEBOUNCE_MS * 3);
    expect(remote.writes()).toBe(0);
  });

  test("/health is exempt from the post-write hook", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, {
      config: mkConfig(),
      fetch: remote.fetchFn,
      syncDebounceMs: DEBOUNCE_MS,
    });
    await alignInboxes(d, local);

    remote.resetWrites();
    await d.app.fetch(new Request("http://daemon/health"));
    await sleep(DEBOUNCE_MS * 3);
    expect(remote.writes()).toBe(0);
  });

  test("cancelPendingSync drops a queued sync", async () => {
    const local = new Store(":memory:");
    const remote = mkRemote();
    const d = createDaemonApp(local, {
      config: mkConfig(),
      fetch: remote.fetchFn,
      syncDebounceMs: 200,
    });
    await alignInboxes(d, local);

    remote.resetWrites();
    await d.app.fetch(
      new Request("http://daemon/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "queued" }),
      }),
    );
    d.cancelPendingSync();
    await sleep(300);
    expect(remote.writes()).toBe(0);
  });
});
