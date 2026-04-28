// Daemon lifecycle: t init, t daemon start/stop/restart/logs, t status.
//
// Per SPEC.md §6, "the CLI process MUST NEVER become the daemon's parent
// process." All start/stop/restart calls go through the platform service
// manager (systemctl --user / launchctl / schtasks). The §10.9 static
// check enforces this invariant by scanning src/cli/ for forbidden
// "spawn(t-daemon, ...)" patterns (see lifecycle.test.ts).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { z } from "zod";

export type Platform = NodeJS.Platform;

export const ConfigSchema = z.object({
  server_url: z.string(),
  server_token: z.string(),
  daemon_port: z.number().int().positive(),
  sync_interval_seconds: z.number().int().positive(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return {
    server_url: "https://t.dyseti.net",
    server_token: "REPLACE_ME",
    daemon_port: 9999,
    sync_interval_seconds: 60,
  };
}

// --- Path helpers (pure) ---

export type PathEnv = Record<string, string | undefined>;

export function configDir(platform: Platform, env: PathEnv = process.env): string {
  const home = env.HOME ?? homedir();
  switch (platform) {
    case "darwin":
      return posix.join(home, "Library", "Application Support", "t");
    case "win32":
      return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "t");
    default:
      return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "t");
  }
}

export function dataDir(platform: Platform, env: PathEnv = process.env): string {
  const home = env.HOME ?? homedir();
  switch (platform) {
    case "darwin":
      return posix.join(home, "Library", "Application Support", "t");
    case "win32":
      return win32.join(env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"), "t");
    default:
      return posix.join(home, ".local", "share", "t");
  }
}

export function configPath(platform: Platform, env: PathEnv = process.env): string {
  return join(configDir(platform, env), "config.json");
}

export function pidPath(platform: Platform, env: PathEnv = process.env): string {
  return join(dataDir(platform, env), "daemon.pid");
}

// --- Config I/O ---

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export function writeConfig(path: string, cfg: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

// --- Platform service-manager commands ---

export interface ShellCommand {
  command: string;
  args: string[];
}

export interface ServiceCommands {
  start: ShellCommand;
  stop: ShellCommand;
  restart: ShellCommand;
  logs: (follow: boolean) => ShellCommand;
}

export function serviceCommands(platform: Platform): ServiceCommands {
  switch (platform) {
    case "linux":
      return {
        start: { command: "systemctl", args: ["--user", "start", "t-daemon"] },
        stop: { command: "systemctl", args: ["--user", "stop", "t-daemon"] },
        restart: { command: "systemctl", args: ["--user", "restart", "t-daemon"] },
        logs: (follow) => ({
          command: "journalctl",
          args: ["--user", "-u", "t-daemon", ...(follow ? ["-f"] : ["-n", "200"])],
        }),
      };
    case "darwin": {
      const plistPath = join(homedir(), "Library", "LaunchAgents", "net.dyseti.t-daemon.plist");
      return {
        start: { command: "launchctl", args: ["load", "-w", plistPath] },
        stop: { command: "launchctl", args: ["unload", "-w", plistPath] },
        restart: {
          command: "launchctl",
          args: ["kickstart", "-k", `gui/${process.getuid?.() ?? 501}/net.dyseti.t-daemon`],
        },
        logs: (follow) => ({
          command: "log",
          args: [
            follow ? "stream" : "show",
            "--predicate",
            'process == "t-daemon"',
            ...(follow ? [] : ["--last", "1h"]),
          ],
        }),
      };
    }
    case "win32":
      return {
        start: { command: "schtasks", args: ["/run", "/tn", "t-daemon"] },
        stop: { command: "schtasks", args: ["/end", "/tn", "t-daemon"] },
        restart: { command: "schtasks", args: ["/end", "/tn", "t-daemon"] },
        logs: () => ({
          command: "powershell",
          args: [
            "-Command",
            "Get-WinEvent -LogName Application | Where-Object { $_.ProviderName -like '*t-daemon*' }",
          ],
        }),
      };
    default:
      throw new Error(`unsupported platform: ${platform}`);
  }
}

export function runShellCommand(cmd: ShellCommand): { status: number; stderr: string } {
  const r = spawnSync(cmd.command, cmd.args, { encoding: "utf8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

// --- Health polling ---

export async function pollHealth(
  url: string,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      // ignore; will retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function readPid(platform: Platform, env: PathEnv = process.env): number | null {
  const path = pidPath(platform, env);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

// --- High-level commands ---

export interface DaemonClientLike {
  health(): Promise<boolean>;
  listTasks(): Promise<{ tasks: { status: string }[] }>;
}

export interface StatusReport {
  daemon: "running" | "not_running";
  pid: number | null;
  daemonPort: number;
  serverURL: string;
  serverReachable: boolean;
  taskCounts: Record<string, number>;
  lastSyncAt: number | null;
}

export async function runStatus(
  platform: Platform,
  client: DaemonClientLike,
  cfg: Config,
): Promise<StatusReport> {
  const running = await client.health();
  if (!running) {
    return {
      daemon: "not_running",
      pid: null,
      daemonPort: cfg.daemon_port,
      serverURL: cfg.server_url,
      serverReachable: false,
      taskCounts: {},
      lastSyncAt: null,
    };
  }

  const { tasks } = await client.listTasks();
  const taskCounts: Record<string, number> = {};
  for (const t of tasks) {
    taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1;
  }

  let serverReachable = false;
  if (cfg.server_url && cfg.server_url !== "https://t.dyseti.net") {
    try {
      const res = await fetch(`${cfg.server_url}/health`);
      serverReachable = res.ok;
    } catch {
      serverReachable = false;
    }
  } else {
    try {
      const res = await fetch(`${cfg.server_url}/health`);
      serverReachable = res.ok;
    } catch {
      serverReachable = false;
    }
  }

  return {
    daemon: "running",
    pid: readPid(platform),
    daemonPort: cfg.daemon_port,
    serverURL: cfg.server_url,
    serverReachable,
    taskCounts,
    lastSyncAt: null,
  };
}

export interface InitOptions {
  serverUrl?: string;
  serverToken?: string;
}

export async function runInit(
  platform: Platform,
  opts: InitOptions,
  env: PathEnv = process.env,
): Promise<{ wroteConfig: boolean; configPath: string }> {
  const cfgPath = configPath(platform, env);
  let wroteConfig = false;
  if (!existsSync(cfgPath)) {
    const cfg = defaultConfig();
    if (opts.serverUrl) cfg.server_url = opts.serverUrl;
    if (opts.serverToken) cfg.server_token = opts.serverToken;
    writeConfig(cfgPath, cfg);
    wroteConfig = true;
  }
  mkdirSync(dataDir(platform, env), { recursive: true });
  return { wroteConfig, configPath: cfgPath };
}

export function execLogs(platform: Platform, follow: boolean): never {
  const cmds = serviceCommands(platform);
  const { command, args } = cmds.logs(follow);
  // Replace this CLI process so the user gets a live tail.
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Type-only assertion: we never return.
  return undefined as never;
}
