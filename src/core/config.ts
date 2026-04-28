// Config schema and on-disk paths (§8). Pure node, no Bun-only APIs;
// safely importable from `core/`, `cli/`, `daemon/`, and `server/`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { z } from "zod";

export type Platform = NodeJS.Platform;
export type PathEnv = Record<string, string | undefined>;

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

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  return ConfigSchema.parse(JSON.parse(raw));
}

export function writeConfig(path: string, cfg: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

/** True when the config still has the placeholder token. */
export function isConfigured(cfg: Config): boolean {
  return cfg.server_token.length > 0 && cfg.server_token !== "REPLACE_ME";
}
