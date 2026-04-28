// Service unit generation for systemd-user, launchd, and Task Scheduler.
// Templates per SPEC.md §9.1. No template engine — plain string interpolation.
//
// `core/` stays Bun-free (§1.1): this module imports no Bun-only APIs.

export interface ServiceConfig {
  /** Absolute path to the t-daemon binary. May contain spaces. */
  daemonPath: string;
  /** Optional arguments appended after the binary path. */
  daemonArgs?: string[];
  /** Directory for stdout/stderr logs (launchd only). */
  logDir: string;
  /** Windows user (e.g. "DOMAIN\\user" or "COMPUTER\\user"). */
  userId: string;
}

export type Platform = "linux" | "darwin" | "win32";

export interface ServiceManager {
  writeUnit(path: string, contents: string): void;
  activate(command: string, args: string[]): void;
}

// --- Escaping helpers ---

/** Backslash-escape spaces for systemd `ExecStart` per systemd.unit(5). */
export function systemdEscape(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/ /g, "\\ ");
}

/** XML-escape text content (`<`, `>`, `&`, `"`, `'`). */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- Renderers ---

export function renderSystemdUnit(cfg: ServiceConfig): string {
  const parts = [systemdEscape(cfg.daemonPath), ...(cfg.daemonArgs ?? []).map(systemdEscape)];
  const execStart = parts.join(" ");
  return `[Unit]
Description=t task tracker daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

export function renderLaunchdPlist(cfg: ServiceConfig): string {
  const args = [cfg.daemonPath, ...(cfg.daemonArgs ?? [])];
  const programArguments = args.map((a) => `        <string>${xmlEscape(a)}</string>`).join("\n");
  const logPath = xmlEscape(cfg.logDir);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>net.dyseti.t-daemon</string>
    <key>ProgramArguments</key>
    <array>
${programArguments}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}/t-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${logPath}/t-daemon.err</string>
</dict>
</plist>
`;
}

export function renderWindowsTask(cfg: ServiceConfig): string {
  const command = xmlEscape(cfg.daemonPath);
  const args = xmlEscape((cfg.daemonArgs ?? []).join(" "));
  const userId = xmlEscape(cfg.userId);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>t task tracker daemon</Description>
    <URI>\\t-daemon</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${userId}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${userId}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT5S</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${command}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// --- Platform dispatch ---

export interface InstallResult {
  unitPath: string;
  contents: string;
  activation: { command: string; args: string[] };
}

export function installService(
  cfg: ServiceConfig,
  platform: Platform,
  manager: ServiceManager,
  homeDir: string,
): InstallResult {
  let result: InstallResult;
  switch (platform) {
    case "linux": {
      const unitPath = `${homeDir}/.config/systemd/user/t-daemon.service`;
      result = {
        unitPath,
        contents: renderSystemdUnit(cfg),
        activation: { command: "systemctl", args: ["--user", "enable", "--now", "t-daemon"] },
      };
      break;
    }
    case "darwin": {
      const unitPath = `${homeDir}/Library/LaunchAgents/net.dyseti.t-daemon.plist`;
      result = {
        unitPath,
        contents: renderLaunchdPlist(cfg),
        activation: { command: "launchctl", args: ["load", "-w", unitPath] },
      };
      break;
    }
    case "win32": {
      const unitPath = `${homeDir}\\AppData\\Local\\t\\t-daemon-task.xml`;
      result = {
        unitPath,
        contents: renderWindowsTask(cfg),
        activation: {
          command: "schtasks",
          args: ["/create", "/tn", "t-daemon", "/xml", unitPath, "/f"],
        },
      };
      break;
    }
  }
  manager.writeUnit(result.unitPath, result.contents);
  manager.activate(result.activation.command, result.activation.args);
  return result;
}
