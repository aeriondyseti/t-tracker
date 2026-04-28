// Service unit golden-file tests per SPEC.md §10.8.
// Goldens regenerated via `UPDATE_GOLDENS=1 bun test src/core/service.test.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Platform,
  type ServiceConfig,
  type ServiceManager,
  installService,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTask,
  systemdEscape,
  xmlEscape,
} from "./service.ts";

const FIXED_CFG: ServiceConfig = {
  daemonPath: "/home/testuser/.local/bin/t-daemon",
  daemonArgs: [],
  logDir: "/home/testuser/.local/share/t/logs",
  userId: "TESTHOST\\testuser",
};

const TESTDATA = join(import.meta.dir, "testdata");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

function golden(name: string, actual: string): string {
  const path = join(TESTDATA, name);
  if (UPDATE) {
    writeFileSync(path, actual);
    return actual;
  }
  return readFileSync(path, "utf8");
}

describe("renderSystemdUnit", () => {
  test("happy-path render matches golden byte-for-byte", () => {
    const actual = renderSystemdUnit(FIXED_CFG);
    expect(actual).toBe(golden("t-daemon.service", actual));
  });

  test("escapes spaces in daemon path", () => {
    const out = renderSystemdUnit({
      ...FIXED_CFG,
      daemonPath: "/Users/Kevin Whiteside/.local/bin/t-daemon",
    });
    // Per systemd.unit(5): backslash-escape spaces in ExecStart.
    expect(out).toContain("ExecStart=/Users/Kevin\\ Whiteside/.local/bin/t-daemon");
  });

  test("schema validity: required sections and directives present", () => {
    const out = renderSystemdUnit(FIXED_CFG);
    const lines = out.split("\n");
    expect(lines).toContain("[Unit]");
    expect(lines).toContain("[Service]");
    expect(lines).toContain("[Install]");
    expect(out).toMatch(/^Type=simple$/m);
    expect(out).toMatch(/^Restart=on-failure$/m);
    expect(out).toMatch(/^ExecStart=.+\S/m); // non-empty
  });
});

describe("renderLaunchdPlist", () => {
  test("happy-path render matches golden byte-for-byte", () => {
    const actual = renderLaunchdPlist(FIXED_CFG);
    expect(actual).toBe(golden("net.dyseti.t-daemon.plist", actual));
  });

  test("XML-escapes paths inside <string> elements", () => {
    const out = renderLaunchdPlist({
      ...FIXED_CFG,
      daemonPath: "/Users/Kevin & Co/.local/bin/t-daemon",
    });
    expect(out).toContain("<string>/Users/Kevin &amp; Co/.local/bin/t-daemon</string>");
    expect(out).not.toContain("Kevin & Co</string>");
  });

  test("schema validity: required keys present", () => {
    const out = renderLaunchdPlist(FIXED_CFG);
    expect(out).toMatch(/<key>Label<\/key>\s*\n\s*<string>net\.dyseti\.t-daemon<\/string>/);
    expect(out).toMatch(/<key>ProgramArguments<\/key>\s*\n\s*<array>/);
    expect(out).toMatch(/<key>RunAtLoad<\/key>\s*\n\s*<true\/>/);
    expect(out).toMatch(/<key>KeepAlive<\/key>\s*\n\s*<true\/>/);
  });
});

describe("renderWindowsTask", () => {
  test("happy-path render matches golden byte-for-byte", () => {
    const actual = renderWindowsTask(FIXED_CFG);
    expect(actual).toBe(golden("t-daemon-task.xml", actual));
  });

  test("XML-escapes daemon path with spaces and ampersands", () => {
    const out = renderWindowsTask({
      ...FIXED_CFG,
      daemonPath: "C:\\Users\\Kevin & Co\\t-daemon.exe",
    });
    expect(out).toContain("<Command>C:\\Users\\Kevin &amp; Co\\t-daemon.exe</Command>");
  });

  test("schema validity: required nodes present", () => {
    const out = renderWindowsTask(FIXED_CFG);
    expect(out).toMatch(
      /<Triggers>[\s\S]*<LogonTrigger>[\s\S]*<\/LogonTrigger>[\s\S]*<\/Triggers>/,
    );
    expect(out).toMatch(/<Principals>[\s\S]*<Principal[^>]*>[\s\S]*<UserId>[\s\S]*<\/UserId>/);
    expect(out).toMatch(/<Actions[^>]*>[\s\S]*<Exec>[\s\S]*<Command>[\s\S]*<\/Command>/);
    expect(out).toMatch(/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  });
});

describe("escape helpers", () => {
  test("systemdEscape: backslashes first, then spaces", () => {
    expect(systemdEscape("/a b/c")).toBe("/a\\ b/c");
    expect(systemdEscape("/a\\b")).toBe("/a\\\\b");
    expect(systemdEscape("/a\\b c")).toBe("/a\\\\b\\ c");
  });

  test("xmlEscape: handles all five XML entities", () => {
    expect(xmlEscape("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&apos;");
    expect(xmlEscape("plain")).toBe("plain");
  });
});

describe("installService dispatch", () => {
  function fakeManager() {
    const calls: Array<{ kind: "writeUnit" | "activate"; args: unknown[] }> = [];
    const mgr: ServiceManager = {
      writeUnit: (path, contents) => calls.push({ kind: "writeUnit", args: [path, contents] }),
      activate: (cmd, args) => calls.push({ kind: "activate", args: [cmd, args] }),
    };
    return { mgr, calls };
  }

  test("linux dispatches to systemd renderer and systemctl", () => {
    const { mgr, calls } = fakeManager();
    const out = installService(FIXED_CFG, "linux", mgr, "/home/testuser");
    expect(out.unitPath).toBe("/home/testuser/.config/systemd/user/t-daemon.service");
    expect(out.contents).toContain("[Service]");
    expect(out.activation).toEqual({
      command: "systemctl",
      args: ["--user", "enable", "--now", "t-daemon"],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].kind).toBe("writeUnit");
    expect(calls[1].kind).toBe("activate");
  });

  test("darwin dispatches to launchd renderer and launchctl", () => {
    const { mgr, calls } = fakeManager();
    const out = installService(FIXED_CFG, "darwin", mgr, "/Users/testuser");
    expect(out.unitPath).toBe("/Users/testuser/Library/LaunchAgents/net.dyseti.t-daemon.plist");
    expect(out.contents).toContain("net.dyseti.t-daemon");
    expect(out.activation.command).toBe("launchctl");
    expect(out.activation.args).toEqual(["load", "-w", out.unitPath]);
    expect(calls).toHaveLength(2);
  });

  test("win32 dispatches to Task Scheduler renderer and schtasks", () => {
    const { mgr, calls } = fakeManager();
    const out = installService(FIXED_CFG, "win32", mgr, "C:\\Users\\testuser");
    expect(out.unitPath).toBe("C:\\Users\\testuser\\AppData\\Local\\t\\t-daemon-task.xml");
    expect(out.contents).toContain("<Task ");
    expect(out.activation.command).toBe("schtasks");
    expect(out.activation.args).toEqual(["/create", "/tn", "t-daemon", "/xml", out.unitPath, "/f"]);
    expect(calls).toHaveLength(2);
  });

  function platforms(): Platform[] {
    return ["linux", "darwin", "win32"];
  }
  test("every platform writes then activates exactly once", () => {
    for (const p of platforms()) {
      const { mgr, calls } = fakeManager();
      installService(FIXED_CFG, p, mgr, "/home/x");
      const writes = calls.filter((c) => c.kind === "writeUnit");
      const acts = calls.filter((c) => c.kind === "activate");
      expect(writes).toHaveLength(1);
      expect(acts).toHaveLength(1);
    }
  });
});
