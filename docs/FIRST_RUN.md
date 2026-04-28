# First-Run Verification

This document is the manual acceptance script for `t` per SPEC.md §13.
Run all sections relevant to your platform; each step lists the command,
the expected output, and how to recover if it fails. The agent does not
register services automatically — these checks confirm that the
generated unit/plist/task XML actually works on a real system.

The package name is `t-tracker` on npm (the bare name `t` is taken).
Substitute `@aerion/t-tracker` if you installed the scoped variant.

---

## Linux (systemd-user)

### 1. Install

```sh
bun install -g t-tracker
which t t-daemon t-server
```

Expected: three paths in `~/.bun/install/global/node_modules/.bin/`
(or wherever `bun install -g` puts them; `which` resolves them).

### 2. Init

```sh
t init --server-url https://t.example.test --server-token <your-token>
```

Expected output:

```
wrote /home/<you>/.config/t/config.json
✓ daemon running
```

`t init` writes the config, renders and installs
`~/.config/systemd/user/t-daemon.service`, runs
`systemctl --user enable --now t-daemon`, then polls
`http://127.0.0.1:9999/health` for up to 5 s.

### 3. Service registration check

```sh
systemctl --user status t-daemon
```

Expected: `Active: active (running)`. Also:

```sh
ls -l ~/.config/systemd/user/t-daemon.service
journalctl --user -u t-daemon -n 5
```

The journal should show one `daemon started` line at INFO with the
hostname and port.

### 4. Survives terminal exit

```sh
exit       # close the terminal
# Open a fresh terminal
t status
```

Expected: `daemon: running (pid: …)`. The daemon does not depend on the
controlling terminal because it was started by `systemd --user`, not
forked from your shell.

### 5. Survives logout / reboot

Reboot the machine, log back in, then in your first new terminal:

```sh
t status
```

Expected: `daemon: running (pid: …)` again. If not, check
`systemctl --user is-enabled t-daemon` — it must say `enabled`. The
service unit's `[Install] WantedBy=default.target` is what causes
auto-start; `t init` sets it via `systemctl --user enable`.

If you skipped enabling `linger` (`loginctl enable-linger $USER`), the
daemon stops when you log out and starts again at next login. That is
the documented default — flip linger on if you want pre-login
running.

### 6. CRUD round-trip

```sh
t add "first task"
t                      # opens fzf picker; press enter to cycle status; esc to quit
t ls --all
t done $(t ls | head -1 | cut -f1)
t status
```

Expected: the task you added appears in `t ls`, status flips to `done`
after `t done`, and `t status` shows non-zero counts under `tasks:`.

---

## macOS (launchd)

### 1. Install

```sh
bun install -g t-tracker
which t t-daemon t-server
```

### 2. Init

```sh
t init --server-url https://t.example.test --server-token <your-token>
```

Expected:

```
wrote /Users/<you>/Library/Application Support/t/config.json
✓ daemon running
```

`t init` writes
`~/Library/LaunchAgents/net.dyseti.t-daemon.plist`, runs
`launchctl load -w …plist`, then polls `/health`.

### 3. Service registration check

```sh
launchctl list | grep net.dyseti.t-daemon
```

Expected: a line like `1234	0	net.dyseti.t-daemon` (PID, exit code,
label). PID `0` means launchd has it but it's not running — wait
two seconds and re-check; KeepAlive should restart it.

```sh
log show --predicate 'process == "t-daemon"' --last 1m
```

The log stream should include the `daemon started` JSON line.

### 4. Survives terminal exit

Same as Linux: `exit`, open a new terminal, run `t status`. launchd's
`KeepAlive=true` ensures it stays up even if it crashes.

### 5. Survives logout / reboot

Log out, log back in (or reboot). `t status` from a fresh terminal
should report `daemon: running (pid: …)`. The plist's `RunAtLoad=true`
key is what makes launchd start it on login; verify with
`plutil -p ~/Library/LaunchAgents/net.dyseti.t-daemon.plist`.

### 6. CRUD round-trip

Same as Linux: `t add`, `t`, `t ls --all`, `t done <id>`, `t status`.

---

## Windows (Task Scheduler)

### 1. Install

```pwsh
bun install -g t-tracker
Get-Command t, t-daemon, t-server | Format-Table Name, Source
```

### 2. Init

In an elevated PowerShell (Task Scheduler logon-trigger registration
needs your interactive token; non-elevated also works for user-level
tasks but spends one extra UAC):

```pwsh
t init --server-url https://t.example.test --server-token <your-token>
```

Expected:

```
wrote C:\Users\<you>\AppData\Roaming\t\config.json
✓ daemon running
```

`t init` writes
`%LOCALAPPDATA%\t\t-daemon-task.xml` and runs
`schtasks /create /tn t-daemon /xml … /f`.

### 3. Service registration check

```pwsh
schtasks /query /tn t-daemon /v /fo LIST
```

Expected: `Status: Running`, `Logon Mode: Interactive only`,
`Run As User: <DOMAIN>\<you>`.

PID-style check via the daemon's pid file:

```pwsh
Get-Content "$env:LOCALAPPDATA\t\daemon.pid"
Get-Process -Id (Get-Content "$env:LOCALAPPDATA\t\daemon.pid")
```

### 4. Survives terminal exit

Close PowerShell, open a fresh PowerShell or Windows Terminal tab, run
`t status`. The Task Scheduler `MultipleInstancesPolicy=IgnoreNew`
keeps a single instance running independent of any shell.

### 5. Survives logout / reboot

Sign out, sign in. `t status` reports `daemon: running` because the
task's `Triggers/LogonTrigger` fires on logon.

If you skipped sign-out (e.g., for a server that uses Auto-Logon
disabled), the task does not start at boot — that is by design; this
is a user-context daemon, not a Windows service.

### 6. CRUD round-trip

Same as Linux/macOS, but with `t.exe`:

```pwsh
t add "first task"
t
t ls --all
t done (t ls | Select-Object -First 1 | ForEach-Object { ($_ -split "`t")[0] })
t status
```

---

## Server (Docker)

Independent of platform; runs on the box you point your daemon at.

```sh
cd deploy
export T_SERVER_TOKEN=$(openssl rand -hex 32)
docker compose build
docker compose up -d
sleep 3
curl -fsS -H "Authorization: Bearer $T_SERVER_TOKEN" localhost:8080/health
# → {"ok":true}
docker compose down -v
```

The `down -v` deletes the named volume; for production deployments,
omit `-v` and back up the `t-data` volume separately.

If you need the server reachable beyond localhost, put nginx (or
caddy/traefik) in front of `127.0.0.1:8080`. The compose file
intentionally does not expose the port externally.

---

## Recovery

If `t init` reports `failed to start daemon via systemctl/launchctl/schtasks`:

- The service unit was not installed. The current build does not yet
  ship an automatic `installService(...)` call from `t init` — the
  renderer is in `src/core/service.ts` but you may need to render and
  install the unit manually until that wiring lands. Use the goldens at
  `src/core/testdata/` as templates with your own paths.
- Re-run with `T_DAEMON_PORT` overridden if 9999 is taken.

If sync silently does nothing: check `cat ~/.config/t/config.json` —
`server_token` defaults to `"REPLACE_ME"`, and the daemon refuses to
sync until you change it.
