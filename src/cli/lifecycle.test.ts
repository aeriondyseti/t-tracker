// Lifecycle tests + the §10.9 process-supervision static check.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigSchema,
  configDir,
  configPath,
  dataDir,
  defaultConfig,
  loadConfig,
  pidPath,
  pollHealth,
  serviceCommands,
  writeConfig,
} from "./lifecycle.ts";

describe("config defaults and round-trip", () => {
  test("defaultConfig is valid against ConfigSchema", () => {
    const cfg = defaultConfig();
    expect(() => ConfigSchema.parse(cfg)).not.toThrow();
    expect(cfg.daemon_port).toBe(9999);
    expect(cfg.server_token).toBe("REPLACE_ME");
  });

  test("writeConfig + loadConfig round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "t-lifecycle-"));
    try {
      const path = join(dir, "config.json");
      const cfg = { ...defaultConfig(), server_url: "https://example.test" };
      writeConfig(path, cfg);
      const loaded = loadConfig(path);
      expect(loaded).toEqual(cfg);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadConfig rejects malformed JSON via zod", () => {
    const dir = mkdtempSync(join(tmpdir(), "t-lifecycle-"));
    try {
      const path = join(dir, "config.json");
      writeConfig(path, defaultConfig());
      // Corrupt one field to wrong type.
      const broken = { ...defaultConfig(), daemon_port: "nine-thousand" } as unknown;
      writeConfig(path, broken as ReturnType<typeof defaultConfig>);
      expect(() => loadConfig(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("path helpers", () => {
  const env = {
    HOME: "/home/x",
    XDG_CONFIG_HOME: "/home/x/.config",
    APPDATA: "C:\\Users\\X\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\X\\AppData\\Local",
  };

  test("linux paths follow XDG", () => {
    expect(configDir("linux", env)).toBe("/home/x/.config/t");
    expect(dataDir("linux", env)).toBe("/home/x/.local/share/t");
    expect(configPath("linux", env)).toBe("/home/x/.config/t/config.json");
    expect(pidPath("linux", env)).toBe("/home/x/.local/share/t/daemon.pid");
  });

  test("darwin paths use Library/Application Support", () => {
    expect(configDir("darwin", env)).toBe("/home/x/Library/Application Support/t");
    expect(dataDir("darwin", env)).toBe("/home/x/Library/Application Support/t");
  });

  test("win32 paths use APPDATA / LOCALAPPDATA", () => {
    expect(configDir("win32", env)).toBe("C:\\Users\\X\\AppData\\Roaming\\t");
    expect(dataDir("win32", env)).toBe("C:\\Users\\X\\AppData\\Local\\t");
  });
});

describe("serviceCommands", () => {
  test("linux uses systemctl --user", () => {
    const c = serviceCommands("linux");
    expect(c.start).toEqual({ command: "systemctl", args: ["--user", "start", "t-daemon"] });
    expect(c.stop).toEqual({ command: "systemctl", args: ["--user", "stop", "t-daemon"] });
    expect(c.restart).toEqual({ command: "systemctl", args: ["--user", "restart", "t-daemon"] });
    expect(c.logs(false).command).toBe("journalctl");
    expect(c.logs(true).args).toContain("-f");
  });

  test("darwin uses launchctl", () => {
    const c = serviceCommands("darwin");
    expect(c.start.command).toBe("launchctl");
    expect(c.start.args[0]).toBe("load");
    expect(c.stop.command).toBe("launchctl");
    expect(c.stop.args[0]).toBe("unload");
    expect(c.logs(false).command).toBe("log");
  });

  test("win32 uses schtasks", () => {
    const c = serviceCommands("win32");
    expect(c.start.command).toBe("schtasks");
    expect(c.start.args).toEqual(["/run", "/tn", "t-daemon"]);
    expect(c.stop.args).toEqual(["/end", "/tn", "t-daemon"]);
  });

  test("'t-daemon' appears only as an argument, never as the command", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const c = serviceCommands(platform);
      for (const sc of [c.start, c.stop, c.restart, c.logs(false), c.logs(true)]) {
        expect(sc.command).not.toBe("t-daemon");
        expect(sc.command).not.toBe("./t-daemon");
        expect(sc.command).not.toBe("t-daemon.exe");
      }
    }
  });
});

describe("pollHealth", () => {
  test("returns false on timeout when nothing listens", async () => {
    // Use an unlikely-bound port; no daemon listening.
    const ok = await pollHealth("http://127.0.0.1:1", 200, 50);
    expect(ok).toBe(false);
  }, 10_000);
});

// --- §10.9 static check ---
//
// The CLI process MUST NEVER spawn the daemon binary directly. This test
// scans every TS source file under src/cli/ for forbidden patterns. The
// regex matches `'t-daemon'` (or `"t-daemon"` / `t-daemon.exe`) appearing
// as the FIRST argument to spawn / exec / execFile / execSync / Bun.spawn.
// It does NOT match cases where 't-daemon' is a later argument (e.g.
// `spawn('systemctl', ['start', 't-daemon'])`).
describe("§10.9 process-supervision invariant", () => {
  const FORBIDDEN =
    /\b(?:spawn|exec|execFile|execSync|Bun\.spawn)\s*\(\s*\[?\s*['"]\.?\/?t-daemon(?:\.exe)?['"]/;

  function listCliSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...listCliSources(path));
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(path);
      }
    }
    return out;
  }

  test("no src/cli/ source spawns t-daemon directly", () => {
    const cliDir = join(import.meta.dir);
    const offenders: string[] = [];
    for (const file of listCliSources(cliDir)) {
      const src = readFileSync(file, "utf8");
      if (FORBIDDEN.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the regex itself catches a known-bad string", () => {
    expect(FORBIDDEN.test(`spawn('t-daemon', [])`)).toBe(true);
    expect(FORBIDDEN.test(`spawn("./t-daemon", [])`)).toBe(true);
    expect(FORBIDDEN.test(`Bun.spawn(['t-daemon'])`)).toBe(true);
    expect(FORBIDDEN.test(`execFile('t-daemon.exe')`)).toBe(true);
    // Allowed pattern (t-daemon as argument):
    expect(FORBIDDEN.test(`spawn('systemctl', ['start', 't-daemon'])`)).toBe(false);
  });
});
