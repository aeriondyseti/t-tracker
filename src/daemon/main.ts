#!/usr/bin/env bun
// Daemon entry point - listens on loopback-only and serves the API.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pino } from "pino";
import {
  type Config,
  configPath,
  dataDir,
  defaultConfig,
  isConfigured,
  loadConfig,
} from "../core/config.ts";
import { Store } from "../core/store.ts";
import { createDaemonApp } from "./app.ts";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const platform = process.platform;
const port = Number.parseInt(process.env.T_DAEMON_PORT ?? "9999", 10);
const dataDirPath = process.env.T_DAEMON_DATA_DIR ?? dataDir(platform);

try {
  mkdirSync(dataDirPath, { recursive: true });
} catch (err) {
  log.error({ err, dataDir: dataDirPath }, "failed to create data directory");
  process.exit(1);
}

// Load config; if missing, run with defaults (sync stays disabled until
// the user creates ~/.config/t/config.json with a real token).
let cfg: Config;
const cfgPath = configPath(platform);
if (existsSync(cfgPath)) {
  try {
    cfg = loadConfig(cfgPath);
  } catch (err) {
    log.error({ err, cfgPath }, "config.json is malformed; refusing to start");
    process.exit(1);
  }
} else {
  log.warn({ cfgPath }, "config.json not found; sync disabled until 't init' runs");
  cfg = defaultConfig();
}

const dbPath = join(dataDirPath, "local.db");
log.info({ dbPath }, "opening database");

let store: Store;
try {
  store = new Store(dbPath);
} catch (err) {
  log.error({ err, dbPath }, "failed to open database");
  process.exit(1);
}

const daemon = createDaemonApp(store, { config: cfg, log });

const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: daemon.app.fetch });
log.info({ hostname: server.hostname, port: server.port }, "daemon started");

// Periodic sync per §4: every `sync_interval_seconds`. A successful run
// also clears any pending debounced trigger inside syncNow().
let intervalHandle: ReturnType<typeof setInterval> | null = null;
if (daemon.engine && isConfigured(cfg)) {
  intervalHandle = setInterval(() => {
    daemon.syncNow().catch((err) => log.error({ err }, "periodic sync threw"));
  }, cfg.sync_interval_seconds * 1000);
  // Run one sync at startup to catch up on anything missed while offline.
  daemon.syncNow().catch((err) => log.warn({ err }, "startup sync failed"));
}

// PID file.
const pidPathStr = join(dataDirPath, "daemon.pid");
try {
  await Bun.write(pidPathStr, process.pid.toString());
} catch (err) {
  log.warn({ err, pidPath: pidPathStr }, "failed to write PID file");
}

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  if (intervalHandle !== null) clearInterval(intervalHandle);
  daemon.cancelPendingSync();
  server.stop();
  try {
    store.close();
  } catch (err) {
    log.error({ err }, "error closing database");
  }
  try {
    await Bun.write(pidPathStr, "");
  } catch (err) {
    log.warn({ err }, "failed to remove PID file");
  }
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
