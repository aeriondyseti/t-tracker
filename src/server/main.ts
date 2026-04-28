#!/usr/bin/env bun
// t-server entry point. Reuses src/core/api.ts and adds bearer-token auth.
//
// Per SPEC.md §7: requires `Authorization: Bearer <T_SERVER_TOKEN>` on
// every route except `/health`. Listens on :8080 (override via
// `T_SERVER_PORT`). SQLite at /data/t.db (override via `T_SERVER_DB`).

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pino } from "pino";
import { Store } from "../core/store.ts";
import { createServerApp } from "./app.ts";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const token = process.env.T_SERVER_TOKEN;
if (!token || token.trim() === "") {
  log.error("T_SERVER_TOKEN must be set and non-empty");
  process.exit(1);
}

const port = Number.parseInt(process.env.T_SERVER_PORT ?? "8080", 10);
const dbPath = process.env.T_SERVER_DB ?? "/data/t.db";

try {
  mkdirSync(dirname(dbPath), { recursive: true });
} catch (err) {
  log.error({ err, dbPath }, "failed to ensure db directory");
  process.exit(1);
}

let store: Store;
try {
  store = new Store(dbPath);
} catch (err) {
  log.error({ err, dbPath }, "failed to open database");
  process.exit(1);
}

const app = createServerApp(store, token);
const server = Bun.serve({ hostname: "0.0.0.0", port, fetch: app.fetch });

log.info({ hostname: server.hostname, port: server.port, dbPath }, "t-server listening");

const shutdown = (signal: string) => {
  log.info({ signal }, "shutting down");
  server.stop();
  try {
    store.close();
  } catch (err) {
    log.error({ err }, "error closing database");
  }
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
