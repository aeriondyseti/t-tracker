// Sync acceptance per SPEC.md §10.6.
// The remote server is mocked (in-process Hono app, fetch via app.fetch).
// Local store is the real bun:sqlite Store (`":memory:"`). The sync engine
// itself is real. Per §10.6 anti-mocking rule, deleting runSync() must
// break these tests.
import { beforeEach, describe, expect, test } from "bun:test";
import { createAPI } from "./api.ts";
import { Store } from "./store.ts";
import { type FetchLike, SyncEngine, type SyncStats } from "./sync.ts";

const SERVER_URL = "http://mock";
const TOKEN = "test-token";

function makeRemote() {
  const store = new Store(":memory:");
  const app = createAPI(store);
  let writeRequests = 0;
  const fetchFn: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" || method === "PATCH") writeRequests++;
    const url = input.startsWith("http") ? input : `${SERVER_URL}${input}`;
    return app.fetch(new Request(url, init));
  };
  return {
    store,
    fetchFn,
    writeCount: () => writeRequests,
    resetWriteCount: () => {
      writeRequests = 0;
    },
  };
}

function makeLocal() {
  return new Store(":memory:");
}

function makeEngine(local: Store, fetchFn: FetchLike): SyncEngine {
  return new SyncEngine(local, {
    serverURL: SERVER_URL,
    serverToken: TOKEN,
    fetch: fetchFn,
  });
}

function expectClean(stats: SyncStats) {
  expect(stats.errors).toEqual([]);
}

describe("sync engine (§10.6)", () => {
  let remote: ReturnType<typeof makeRemote>;
  let local: Store;
  let engine: SyncEngine;
  let inboxLocalId: string;
  let inboxRemoteId: string;

  beforeEach(async () => {
    remote = makeRemote();
    local = makeLocal();
    engine = makeEngine(local, remote.fetchFn);
    // Both stores auto-seed an "inbox" project with different ids. The
    // unique-name index on `projects(name) WHERE deleted_at IS NULL`
    // would collide on first sync, so soft-delete the local one and
    // let the engine pull remote's inbox as the live one.
    const localInbox = local.listProjects().find((p) => p.name === "inbox");
    const remoteInbox = remote.store.listProjects().find((p) => p.name === "inbox");
    if (!localInbox || !remoteInbox) throw new Error("missing inbox project");
    // Soft-delete with updated_at=0 so the engine does NOT pick this up
    // in step 4's `getProjectsSince(0)` push set — we only want to pull
    // the remote inbox, not push a stale delete.
    localInbox.deleted_at = 1;
    localInbox.updated_at = 0;
    local.updateProject(localInbox);
    const stats = await engine.runSync();
    if (stats.errors.length > 0) throw new Error(`setup sync failed: ${stats.errors.join(",")}`);
    // Reset last_sync_at so the tests start from since=0 and see their
    // own changes pushed/pulled.
    local.setMeta("last_sync_at", "0");
    remote.resetWriteCount();
    inboxLocalId = remoteInbox.id;
    inboxRemoteId = remoteInbox.id;
  });

  test("local-created task appears on remote after sync (push)", async () => {
    local.createTask({ project_id: inboxLocalId, title: "from local" });

    const stats = await engine.runSync();
    expectClean(stats);

    const remoteTasks = remote.store.listTasks();
    expect(remoteTasks.find((t) => t.title === "from local")).toBeDefined();
    expect(stats.pushed_tasks).toBeGreaterThanOrEqual(1);
  });

  test("remote-created task appears in local after sync (pull)", async () => {
    remote.store.createTask({ project_id: inboxRemoteId, title: "from remote" });

    const stats = await engine.runSync();
    expectClean(stats);

    const localTasks = local.listTasks();
    expect(localTasks.find((t) => t.title === "from remote")).toBeDefined();
    expect(stats.pulled_tasks).toBeGreaterThanOrEqual(1);
  });

  test("last-write-wins: newer updated_at wins on both sides", async () => {
    // Seed one task on both sides at t=1000.
    const id = "01000000-0000-7000-8000-000000000001";
    local.createTask({
      id,
      project_id: inboxLocalId,
      title: "original",
      created_at: 1000,
      updated_at: 1000,
    });
    remote.store.createTask({
      id,
      project_id: inboxRemoteId,
      title: "original",
      created_at: 1000,
      updated_at: 1000,
    });

    // Local edits at t=2000; remote edits at t=3000 — remote should win.
    const localTask = local.getTask(id);
    if (!localTask) throw new Error("local task missing");
    localTask.title = "local edit";
    localTask.updated_at = 2000;
    local.updateTask(localTask);

    const remoteTask = remote.store.getTask(id);
    if (!remoteTask) throw new Error("remote task missing");
    remoteTask.title = "remote edit";
    remoteTask.updated_at = 3000;
    remote.store.updateTask(remoteTask);

    const stats = await engine.runSync();
    expectClean(stats);

    const after = local.getTask(id);
    expect(after?.title).toBe("remote edit");
    expect(after?.updated_at).toBe(3000);
  });

  test("idempotency: a second sync with no changes issues zero writes", async () => {
    local.createTask({ project_id: inboxLocalId, title: "once" });

    const first = await engine.runSync();
    expectClean(first);

    remote.resetWriteCount();
    const second = await engine.runSync();
    expectClean(second);

    expect(remote.writeCount()).toBe(0);
    expect(second.pushed_tasks).toBe(0);
    expect(second.pushed_projects).toBe(0);
  });

  test("409 retry: POST collides on id, engine retries as PATCH", async () => {
    // Seed the SAME task on both sides with different titles and the
    // local row newer than remote — remote returns 409 to POST, engine
    // retries as PATCH which succeeds.
    const id = "01000000-0000-7000-8000-000000000002";
    remote.store.createTask({
      id,
      project_id: inboxRemoteId,
      title: "remote version",
      created_at: 100,
      updated_at: 100,
    });
    local.createTask({
      id,
      project_id: inboxLocalId,
      title: "local newer",
      created_at: 100,
      updated_at: 9999,
    });

    const stats = await engine.runSync();
    expectClean(stats);
    expect(stats.conflicts_resolved).toBeGreaterThanOrEqual(1);

    const after = remote.store.getTask(id);
    expect(after?.title).toBe("local newer");
  });

  test("isApplyingRemote flag is false outside of an active pull", async () => {
    expect(engine.isApplyingRemote).toBe(false);
    await engine.runSync();
    expect(engine.isApplyingRemote).toBe(false);
  });

  test("non-2xx pull aborts cycle without advancing last_sync_at", async () => {
    // Replace fetch with one that returns 500 for the GET /tasks call.
    const failingEngine = new SyncEngine(local, {
      serverURL: SERVER_URL,
      serverToken: TOKEN,
      fetch: async () => new Response("boom", { status: 500 }),
    });

    local.createTask({ project_id: inboxLocalId, title: "blocked" });
    const stats = await failingEngine.runSync();
    expect(stats.errors.length).toBeGreaterThan(0);
    // beforeEach resets last_sync_at to "0"; a failed pull must NOT advance it.
    expect(local.getMeta("last_sync_at")).toBe("0");
  });
});
