#!/usr/bin/env bun
// Daemon entry point - listens on loopback-only and serves the API

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { createAPI } from "../core/api.ts";
import { Store } from "../core/store.ts";

const log = pino({ level: "info" });

// Read config from env
const port = Number.parseInt(process.env.T_DAEMON_PORT || "9999", 10);
const dataDir =
  process.env.T_DAEMON_DATA_DIR ||
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "t")
    : process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "t")
      : join(homedir(), ".local", "share", "t"));

// Ensure data directory exists
try {
  mkdirSync(dataDir, { recursive: true });
} catch (err) {
  log.error({ err, dataDir }, "failed to create data directory");
  process.exit(1);
}

const dbPath = join(dataDir, "local.db");
log.info({ dbPath }, "opening database");

// Open store and create API
let store: Store;
try {
  store = new Store(dbPath);
} catch (err) {
  log.error({ err, dbPath }, "failed to open database");
  process.exit(1);
}

const app = createAPI(store);

// Start server on loopback-only
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
});

log.info({ hostname: server.hostname, port: server.port }, "daemon started");

// Write PID file for `t daemon stop` and `t status`
const pidPath = join(dataDir, "daemon.pid");
try {
  await Bun.write(pidPath, process.pid.toString());
} catch (err) {
  log.warn({ err, pidPath }, "failed to write PID file");
}

// Graceful shutdown on SIGTERM/SIGINT
const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");

  // Stop accepting new requests
  server.stop();

  // Close database
  try {
    store.close();
  } catch (err) {
    log.error({ err }, "error closing database");
  }

  // Remove PID file
  try {
    await Bun.write(pidPath, "");
    // Unlink would be better but Bun.write("") effectively clears it
  } catch (err) {
    log.warn({ err }, "failed to remove PID file");
  }

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
