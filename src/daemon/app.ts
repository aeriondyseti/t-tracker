// Daemon Hono app: core API + post-write debounced sync + POST /sync.
// Pulled out of `main.ts` so the wiring is unit-testable without
// `Bun.serve`. No Bun-only APIs here.

import { Hono } from "hono";
import { createAPI } from "../core/api.ts";
import type { Config } from "../core/config.ts";
import { isConfigured } from "../core/config.ts";
import { type Debounced, debounce } from "../core/debounce.ts";
import type { Store } from "../core/store.ts";
import { type FetchLike, SyncEngine, type SyncStats } from "../core/sync.ts";

export interface DaemonAppOptions {
  config: Config;
  /** Override fetch (e.g. in tests, point at an in-process mock server). */
  fetch?: FetchLike;
  /**
   * Trailing-edge debounce window for the post-write sync trigger.
   * Defaults to 1000 ms. A short window coalesces bursty edits without
   * delaying lone writes too long.
   */
  syncDebounceMs?: number;
  /** Optional logger; structured fields per call. */
  log?: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
}

export interface DaemonApp {
  app: Hono;
  /** SyncEngine if the config has a non-placeholder token; else null. */
  engine: SyncEngine | null;
  /** Trigger an immediate (non-debounced) sync. Resolves with stats. */
  syncNow(): Promise<SyncStats>;
  /** Cancel any pending debounced sync (call on shutdown). */
  cancelPendingSync(): void;
}

export function createDaemonApp(store: Store, opts: DaemonAppOptions): DaemonApp {
  const log = opts.log;
  const debounceMs = opts.syncDebounceMs ?? 1000;

  let engine: SyncEngine | null = null;
  let debouncedSync: Debounced | null = null;

  if (isConfigured(opts.config)) {
    engine = new SyncEngine(store, {
      serverURL: opts.config.server_url,
      serverToken: opts.config.server_token,
      fetch: opts.fetch,
    });
    const fire = () => {
      if (!engine) return;
      engine.runSync().then(
        (stats) => {
          if (stats.errors.length > 0) log?.warn({ stats }, "sync completed with errors");
          else if (stats.pulled_tasks + stats.pushed_tasks > 0) log?.info({ stats }, "sync ok");
        },
        (err) => log?.error({ err }, "sync threw"),
      );
    };
    debouncedSync = debounce(fire, debounceMs);
  } else {
    log?.warn({ token: "REPLACE_ME" }, "sync disabled until server_token is set");
  }

  const app = new Hono();

  // Post-write hook: after every successful POST/PATCH on the API
  // (excluding /health and /sync itself), schedule a debounced sync.
  // The re-entry guard via SyncEngine.isApplyingRemote prevents the
  // upserts inside step 3 of runSync from re-arming the timer.
  app.use("*", async (c, next) => {
    await next();
    if (!engine || !debouncedSync) return;
    const path = c.req.path;
    const method = c.req.method;
    if (path === "/sync" || path === "/health") return;
    if ((method !== "POST" && method !== "PATCH") || c.res.status >= 400) return;
    if (engine.isApplyingRemote) return;
    debouncedSync();
  });

  // Daemon-only /sync endpoint: forces an immediate sync, returns stats.
  app.post("/sync", async (c) => {
    if (!engine) {
      return c.json({ error: "sync disabled: set server_token in config.json" }, 503);
    }
    debouncedSync?.cancel();
    const stats = await engine.runSync();
    return c.json(stats);
  });

  app.route("/", createAPI(store));

  return {
    app,
    engine,
    syncNow: async () => {
      if (!engine) throw new Error("sync engine not initialised");
      debouncedSync?.cancel();
      return engine.runSync();
    },
    cancelPendingSync: () => debouncedSync?.cancel(),
  };
}
