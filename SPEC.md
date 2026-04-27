# `t` — Personal Task Tracker

A frictionless CLI task tracker with a local daemon and a remote sync backend. Designed for terminal-resident workflows. ADHD-tuned: capture in under 2 seconds, always visible via tmux/fzf integration, no executive function tax.

This document is the build spec for an autonomous coding agent (Claude Code with Opus 4.7). Treat every "MUST" as a hard requirement. Read §0 (Agent Operating Rules) before starting; it defines build order, gates, and self-honesty rules that govern the entire build. Every acceptance test in §10 must pass before declaring the build complete.

---

## 0. Agent Operating Rules

These rules govern how the agent executes the build. They override anything in the harness's global configuration.

### 0.1 Project-level CLAUDE.md

The agent's FIRST action MUST be to create `CLAUDE.md` at the repo root, containing:

```markdown
# Project: t

This project is Go-only. Ignore any global preferences for TypeScript, Bun, or
other languages. Do NOT suggest, scaffold, or fall back to those stacks.

This is a single-user personal tool. Do NOT integrate with Notion, Linear,
GitHub Issues, Asana, Trello, or any other external task system, even if
connectors are available in the environment.

Build order is defined in SPEC.md §0.3. Follow it strictly. Do not jump ahead.

When making non-obvious decisions, append to DECISIONS.md per SPEC.md §12.

When a step's gate (SPEC.md §0.4) fails, fix it before advancing. Do not
declare partial success.
```

This file supersedes any global `CLAUDE.md` for the duration of the build. If the agent's harness imports global preferences (TypeScript-first, Bun-first, etc.), this project file overrides them.

### 0.2 Effort allocation

Rough effort weighting across the build, to prevent the agent from polishing one component while another goes unbuilt:

| Component | Relative effort |
|---|---|
| Store + migrations + sync engine | ~40% |
| CLI (cobra commands + fzf integration) | ~20% |
| Service unit generation + golden tests | ~15% |
| Server (`cmd/t-server` + Dockerfile) | ~15% |
| Init / daemon lifecycle commands | ~10% |

These are not minutes — the agent cannot measure clock time reliably. They are *relative* — if the agent finds itself spending what feels like the bulk of its effort on init commands while the sync engine is untested, something is wrong.

### 0.3 Build order

Build in this exact order. Do NOT skip ahead. Each step has a gate (§0.4) that MUST pass before advancing. Tick each box as the gate clears; the harness uses these as its progress signal.

- [ ] **1. Skeleton.** `go.mod`, repo layout per §2, empty packages, Makefile with `build`/`test`/`help` targets.
- [ ] **2. Model + store.** `internal/model`, `internal/store` with migrations, store unit tests against real SQLite (`:memory:` or temp file).
- [ ] **3. API handlers.** `internal/api` HTTP handlers over the store, handler unit tests using `httptest.Server`.
- [ ] **4. Daemon binary.** `cmd/t-daemon` wiring the API handlers to a real HTTP server, end-to-end test per §10.4.
- [ ] **5. HTTP client.** `internal/client` for CLI → daemon communication.
- [ ] **6. CLI core.** `cmd/t` with cobra setup and basic commands (`add`, `ls`, `done`, etc.) — NOT yet the fzf picker, NOT yet `init`/`daemon`/`status`.
- [ ] **7. CLI fzf integration.** The default-no-args picker behavior per §6.
- [ ] **8. Sync engine.** `internal/sync` with mock-server tests per §10.6. Mock the *remote*, never the local SQLite.
- [ ] **9. Service unit generation.** `internal/service` with golden-file tests per §10.8 covering all three platforms.
- [ ] **10. CLI lifecycle commands.** `t init`, `t daemon start/stop/restart/logs`, `t status`. Static check per §10.9.
- [ ] **11. Server binary.** `cmd/t-server` reusing handlers from step 3, plus auth middleware.
- [ ] **12. Docker artifacts.** Dockerfile + docker-compose.yml, build-test per §10.7.
- [ ] **13. Documentation.** `README.md`, `docs/FIRST_RUN.md` per §13, `scripts/hotkey-snippets.md`.

### 0.4 Per-step gates

Before advancing from step N to step N+1, the agent MUST verify:

- All code compiles cleanly: `go build ./...` succeeds with zero warnings.
- All tests pass: `go test ./... -race -count=1` succeeds.
- Cross-compilation still works: §10.2's matrix succeeds. Run this at every gate, not just at the end. CGo creep is the canary — catch it early.
- `go vet ./...` produces no output.
- New decisions are logged in `DECISIONS.md`.

If a gate fails, fix it before advancing. The "I'll come back to this" pattern is forbidden — it never happens, and the broken state compounds.

### 0.5 Self-honesty rules

- If a test is failing and the agent considers commenting it out, skipping it, or weakening its assertions: STOP. Either fix the underlying issue or document why the test was wrong in `DECISIONS.md` with the rationale.
- If the agent considers adding a `TODO` or `FIXME` comment: instead, either fix it now or add it to a `KNOWN_GAPS.md` file with a clear description of what's missing and why it was deferred.
- If the agent finds itself wanting to deviate from the spec: document the deviation in `DECISIONS.md` BEFORE making it, not after.
- "Mostly working" is not "working." A test that passes 9 times out of 10 is a failing test.

---

## 1. Stack (non-negotiable)

- **Language:** Go 1.22+
- **HTTP:** stdlib `net/http` + `chi` router (`github.com/go-chi/chi/v5`)
- **DB:** SQLite via `modernc.org/sqlite` (pure Go, no CGo — critical for cross-compilation)
- **Migrations:** `github.com/pressly/goose/v3` with embedded SQL files
- **CLI:** `github.com/spf13/cobra`
- **Config:** plain JSON at `~/.config/t/config.json`, no Viper
- **Logging:** `log/slog` (stdlib)
- **Testing:** stdlib `testing` + `github.com/stretchr/testify/assert` for readability

Do NOT introduce any other dependencies without an explicit reason recorded in `DECISIONS.md`. If a task seems to require a new library, prefer writing 20 lines of Go.

## 2. Repository Layout

```
t/
├── cmd/
│   ├── t/                    # CLI binary
│   │   └── main.go
│   ├── t-daemon/             # local daemon binary
│   │   └── main.go
│   └── t-server/             # remote sync backend (deploys to dyseti.net)
│       └── main.go
├── internal/
│   ├── store/                # SQLite layer, shared by daemon + server
│   │   ├── store.go
│   │   ├── migrations/
│   │   │   ├── 0001_init.sql
│   │   │   └── embed.go
│   │   └── store_test.go
│   ├── api/                  # HTTP handlers, shared by daemon + server
│   │   ├── handlers.go
│   │   └── handlers_test.go
│   ├── sync/                 # daemon → server sync engine
│   │   ├── sync.go
│   │   └── sync_test.go
│   ├── model/                # Task, Project, Tag types + JSON shapes
│   │   └── model.go
│   └── client/               # HTTP client used by CLI to talk to daemon
│       └── client.go
├── deploy/
│   ├── Dockerfile            # for t-server
│   ├── docker-compose.yml
│   └── systemd/
│       └── t-daemon.service  # user service unit
├── scripts/
│   ├── install.sh            # builds binaries, installs to ~/.local/bin
│   └── hotkey-snippets.md    # OS-specific hotkey one-liners (documentation only)
├── go.mod
├── go.sum
├── Makefile
├── README.md
├── DECISIONS.md              # agent appends every non-obvious decision here
└── SPEC.md                   # this document
```

## 3. Data Model

Single SQLite schema, used identically by daemon (local cache) and server (source of truth).

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,           -- UUIDv7
  name        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,           -- unix millis
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER                     -- soft delete; NULL = live
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,           -- UUIDv7
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('inbox','active','blocked','done','archived')),
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated ON tasks(updated_at);
```

**Rules:**
- IDs are UUIDv7 (time-ordered, no need for separate `created_at` indexing for sync). Use `github.com/google/uuid` v1.6+.
- Timestamps are unix milliseconds, `int64`.
- `deleted_at` enables sync of deletions. Never hard-delete from a synced row.
- Status enum is fixed; do not add a "config table" for statuses. Hardcoded.
- Default project named `"inbox"` is created on first run if no projects exist.

## 4. Sync Protocol

**Last-write-wins, per-row, on `updated_at`.** No CRDTs. No operational transforms. If two machines edit the same task in the same minute, one edit is silently lost. This is acceptable.

**Endpoints (identical on daemon and server):**

```
GET    /health              → {"ok": true}
GET    /tasks?since=<ms>    → {"tasks":[...], "projects":[...], "server_time": <ms>}
POST   /tasks               → creates task, returns full task
PATCH  /tasks/:id           → updates task, returns full task
POST   /projects            → creates project
PATCH  /projects/:id        → updates project
POST   /sync                → daemon-only: triggers immediate sync to server
```

**Sync algorithm (daemon → server, runs every 60s and on every local write):**

1. Read `last_sync_at` from a `_meta` table (key/value, single row).
2. `GET {server}/tasks?since={last_sync_at}` — pull remote changes.
3. For each remote row: if local `updated_at >= remote.updated_at`, skip. Else upsert.
4. Query local rows where `updated_at > last_sync_at`.
5. For each local row: `POST` if doesn't exist on server (best-effort: try POST, fall back to PATCH on 409), `PATCH` otherwise.
6. Update `last_sync_at = server_time` from step 2 response.
7. Wrap entire sync in a single transaction client-side; if any step fails, log and abort — `last_sync_at` is not advanced, will retry next cycle.

**Authentication:**
- Server requires `Authorization: Bearer <token>` on all endpoints except `/health`.
- Token is a single static string set via `T_SERVER_TOKEN` env var on the server.
- Daemon reads its copy from `~/.config/t/config.json` field `server_token`.
- No user accounts. Single-tenant. This is a personal tool.

## 5. Daemon (`cmd/t-daemon`)

- Listens on `127.0.0.1:9999` (configurable via `T_DAEMON_PORT`).
- Loopback-only. Bind to `127.0.0.1`, never `0.0.0.0`. Verify in tests.
- On startup: opens SQLite at `~/.local/share/t/local.db`, runs migrations, starts HTTP server, starts sync goroutine.
- Graceful shutdown on SIGTERM/SIGINT: stop accepting requests, finish in-flight, flush sync, close DB.
- No auth on daemon endpoints (loopback-only is the security boundary).
- Logs to stderr in JSON format via slog.

## 6. CLI (`cmd/t`)

The CLI is a thin client over the daemon's HTTP API. **It MUST NOT touch SQLite directly.** All state goes through the daemon. This invariant keeps the CLI snappy and the daemon as the single writer.

If the daemon isn't running, most commands print `daemon not running; run 't daemon start' or 't init'` and exit code 2. Exception: `t init`, `t daemon *`, and `t status` work without a running daemon.

**Critical invariant: the CLI process MUST NEVER become the daemon's parent process.** All daemon lifecycle operations go through the platform's service manager (systemd-user on Linux, launchd on macOS, Task Scheduler on Windows). The CLI's role in process management is to *invoke* the service manager, never to `fork()` or `exec()` the daemon binary directly. See §9 for platform specifics.

**Commands:**

```
t                              # default: open fzf picker over active+inbox tasks
t ls                           # list tasks (default: active+inbox), tab-separated
t ls --all                     # include done/archived
t ls --project <name>
t ls --status <status>
t ls --tag <tag>

t add "title" [--project foo] [--tag bar] [--tag baz]
                               # create task in <project> (default: inbox)
                               # prints new task id

t done <id-prefix>             # set status=done; id-prefix is short prefix of UUID
t block <id-prefix>            # set status=blocked
t start <id-prefix>            # set status=active
t archive <id-prefix>          # set status=archived
t edit <id-prefix>             # open notes in $EDITOR, save on close

t projects                     # list projects
t project add <name>
t project rm <name>            # soft delete; tasks become orphaned-but-visible

t sync                         # force immediate sync, print result
t status                       # show daemon health, last sync, task counts

t init                         # one-time per-machine setup (idempotent)
t daemon start                 # start daemon via platform service manager
t daemon stop                  # stop daemon via platform service manager
t daemon restart               # restart daemon via platform service manager
t daemon logs [--follow]       # tail daemon logs
```

**`t init` semantics (idempotent — safe to re-run):**

1. Detect platform via `runtime.GOOS`: `linux` → systemd-user, `darwin` → launchd, `windows` → Task Scheduler.
2. Create config and data directories using `os.UserConfigDir()` for config (`~/.config/t/` on Linux, `~/Library/Application Support/t/` on macOS, `%APPDATA%\t\` on Windows). Data directory follows XDG conventions on Linux (`~/.local/share/t/`) with platform equivalents elsewhere.
3. If `config.json` doesn't exist, write defaults. Prompt interactively for `server_url` and `server_token`. Honor `--server-url` and `--server-token` flags to skip prompts (useful for scripted setup).
4. Install platform-specific service unit (templates in §9):
   - **Linux:** write `~/.config/systemd/user/t-daemon.service`, run `systemctl --user daemon-reload`.
   - **macOS:** write `~/Library/LaunchAgents/net.dyseti.t-daemon.plist`, run `launchctl unload` (ignore errors) then `launchctl load`.
   - **Windows:** register a scheduled task that runs at logon via `schtasks /create /tn "t-daemon" /tr <path> /sc onlogon`. Scheduled task is preferred over a true Windows service — no admin rights required.
5. Invoke `t daemon start` to bring it up.
6. Poll `http://localhost:9999/health` every 250ms for up to 5 seconds. Success: print `✓ daemon running (pid: N)`. Timeout: print failure plus `t daemon logs` hint, exit code 2.

**`t daemon start/stop/restart` semantics:**

These are thin shellouts to the platform service manager. They do NOT exec the daemon binary directly under any circumstances. Implementation:

- **Linux:** `systemctl --user start|stop|restart t-daemon`
- **macOS:** `launchctl kickstart gui/$(id -u)/net.dyseti.t-daemon` (start), `launchctl bootout gui/$(id -u)/net.dyseti.t-daemon` (stop)
- **Windows:** `schtasks /run /tn t-daemon` (start). Stop signals via PID file written by daemon at startup; the CLI reads the PID and sends a graceful stop signal. Windows scheduled tasks have no clean stop verb — the PID file is the contract.

If the underlying command fails, print its stderr verbatim. Don't try to interpret it.

**`t status` semantics:**

- Pings `http://localhost:9999/health`. If it responds: print `daemon: running`, last sync timestamp, task count by status, server URL, and server reachability (separate ping to `${server_url}/health`).
- If daemon doesn't respond: print `daemon: not running` and exit 0. Status reporting is not a failure.

**fzf picker behavior (the `t` command with no args):**

- Pipes tasks to fzf, format: `<short-id> [<status>] <project>: <title>  #<tags>`
- `--preview` shows full task notes
- Keybinds inside fzf:
  - `enter` → cycle status (inbox → active → blocked → done → archived → inbox)
  - `ctrl-e` → exit fzf, run `t edit <id>`, re-enter picker
  - `ctrl-n` → exit fzf, prompt for new task title via `read`, create, re-enter picker
  - `ctrl-d` → archive
  - `esc` → exit
- Picker re-fetches from daemon between actions (no caching in CLI process).
- Use `fzf` via `os/exec` with stdin piping. Detect missing fzf and print install hint.

**Exit codes:** 0 success, 1 user error (bad args, not found), 2 system error (daemon down, network).

## 7. Server (`cmd/t-server`)

- Same HTTP handlers as daemon, plus auth middleware.
- Listens on `:8080` (configurable via `T_SERVER_PORT`).
- SQLite at `/data/t.db` (volume-mounted in Docker).
- Designed to run behind nginx on dyseti.net at `https://t.dyseti.net`.
- Dockerfile MUST produce a multi-stage image, final stage is `gcr.io/distroless/static-debian12` or `scratch`.
- `docker-compose.yml` MUST mount `/data` as a named volume and expose port 8080 to localhost only (nginx proxies in).

**Do NOT deploy.** Build the artifacts. The user deploys manually.

## 8. Config File

`~/.config/t/config.json`:

```json
{
  "server_url": "https://t.dyseti.net",
  "server_token": "REPLACE_ME",
  "daemon_port": 9999,
  "sync_interval_seconds": 60
}
```

Created with sensible defaults on first daemon run if missing. Token left as `REPLACE_ME` — daemon logs a warning and skips sync until it's set to something else.

## 9. Service Units & Hotkey Integration

### 9.1 Service Unit Templates (the agent generates and installs these)

The daemon binary embeds these templates via `embed.FS`. `t init` writes them to the appropriate platform location with the daemon's absolute path substituted in.

**Linux — `~/.config/systemd/user/t-daemon.service`:**

```ini
[Unit]
Description=t task tracker daemon
After=network-online.target

[Service]
Type=simple
ExecStart={{.DaemonPath}}
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

**macOS — `~/Library/LaunchAgents/net.dyseti.t-daemon.plist`:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>net.dyseti.t-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.DaemonPath}}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{.LogPath}}/t-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>{{.LogPath}}/t-daemon.err</string>
</dict>
</plist>
```

**Windows — Scheduled Task XML (registered via `schtasks /create /xml`):**

The agent generates this `.xml` task definition and registers it with `schtasks /create /tn t-daemon /xml <file> /f`. The `/f` flag overwrites an existing task with the same name, making `t init` idempotent.

```xml
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>t task tracker daemon</Description>
    <URI>\t-daemon</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{{.UserId}}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{{.UserId}}</UserId>
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
      <Command>{{.DaemonPath}}</Command>
    </Exec>
  </Actions>
</Task>
```

Template substitutions: `{{.UserId}}` is the current user (resolve via `os/user.Current().Username`, format as `DOMAIN\user` or `COMPUTER\user`); `{{.DaemonPath}}` is the absolute path to `t-daemon.exe`.

Critical settings for our use case: `Hidden=true` keeps it out of the user-facing task list to reduce visual clutter. `MultipleInstancesPolicy=IgnoreNew` prevents duplicate daemons if the user logs out and back in — combined with the daemon's `O_EXCL` PID file (§9.2), this is belt-and-suspenders. `RestartOnFailure` mirrors systemd's `Restart=on-failure`. `LeastPrivilege` ensures no admin elevation. `ExecutionTimeLimit=PT0S` means no timeout (the daemon should run as long as the user is logged in).

### 9.2 PID File

The daemon writes its PID to `${data_dir}/daemon.pid` on startup (using `O_CREAT|O_EXCL` to detect a stale duplicate; if exclusive create fails, check whether the existing PID is alive via `kill -0` / `OpenProcess`, exit if so, overwrite if not). Removes the file on graceful shutdown. Used by `t daemon stop` on Windows and by `t status` for the `pid: N` line.

### 9.3 Hotkey Integration (documentation only)

`scripts/hotkey-snippets.md` MUST contain working copy-paste snippets for:

- **KDE (Linux):** `kwriteconfig5` snippet wiring a custom shortcut to a script that runs `kdialog --inputbox "Quick capture:" | xargs -I{} t add "{}"`.
- **macOS:** Hammerspoon Lua snippet binding ⌘⌥Space to an `hs.dialog.textPrompt` that calls `t add`.
- **Windows:** AutoHotkey v2 script binding Win+Space to an InputBox that calls `t add`.

The agent does NOT install or configure these — they require user-specific keyboard preferences. Just document them clearly.

## 10. Acceptance Tests

These MUST all pass before the agent declares completion. Each is a script the agent runs itself.

### 10.1 Build acceptance

```bash
make build
test -x bin/t
test -x bin/t-daemon
test -x bin/t-server
```

### 10.2 Cross-compilation acceptance

```bash
GOOS=darwin  GOARCH=arm64 go build -o /tmp/t-darwin     ./cmd/t
GOOS=darwin  GOARCH=arm64 go build -o /tmp/td-darwin    ./cmd/t-daemon
GOOS=windows GOARCH=amd64 go build -o /tmp/t.exe        ./cmd/t
GOOS=windows GOARCH=amd64 go build -o /tmp/td.exe       ./cmd/t-daemon
GOOS=linux   GOARCH=amd64 go build -o /tmp/t-linux      ./cmd/t
```

If any cross-compile fails, you have CGo dependencies and must fix them. This is why the spec mandates `modernc.org/sqlite`.

### 10.3 Unit test acceptance

```bash
go test ./... -race -count=1
# Must pass with zero failures, zero data races.
# Coverage MUST be ≥70% on internal/store, internal/sync, internal/api.
```

### 10.4 Daemon end-to-end acceptance

The agent runs this script and verifies output:

```bash
# Start daemon in background, write to clean temp dirs
export T_DAEMON_DATA_DIR=$(mktemp -d)
export T_CONFIG_DIR=$(mktemp -d)
./bin/t-daemon &
DAEMON_PID=$!
sleep 1

# Health check
curl -fsS localhost:9999/health | grep -q '"ok":true'

# Create project
curl -fsS -X POST localhost:9999/projects \
  -H 'content-type: application/json' \
  -d '{"name":"test-project"}'

# Create task
TASK_JSON=$(curl -fsS -X POST localhost:9999/tasks \
  -H 'content-type: application/json' \
  -d '{"project":"test-project","title":"buy milk","tags":["errand"]}')
TASK_ID=$(echo $TASK_JSON | grep -oE '"id":"[^"]+' | head -1 | cut -d'"' -f4)
test -n "$TASK_ID"

# Update task via PATCH
curl -fsS -X PATCH localhost:9999/tasks/$TASK_ID \
  -H 'content-type: application/json' \
  -d '{"status":"active"}'

# List tasks, verify our task is there with status=active
curl -fsS localhost:9999/tasks | grep -q '"status":"active"'

# Loopback verification — must REFUSE external bind
! nc -z $(hostname -I | awk '{print $1}') 9999 2>/dev/null

kill $DAEMON_PID
```

### 10.5 CLI end-to-end acceptance

With daemon running:

```bash
./bin/t add "test task" --project test-project
./bin/t ls | grep -q "test task"
TASK_ID=$(./bin/t ls | grep "test task" | awk '{print $1}')
./bin/t start $TASK_ID
./bin/t ls --status active | grep -q "test task"
./bin/t done $TASK_ID
./bin/t ls --status done | grep -q "test task"
```

### 10.6 Sync acceptance (mock server, real local DB)

`internal/sync/sync_test.go` MUST contain a test that:
1. Spins up an in-process mock server using `httptest.NewServer`. The mock implements the real HTTP API surface (§4) — it is NOT a stub that just returns `nil`.
2. Creates a real local SQLite store (in `:memory:` or a `t.TempDir()` file). The local DB MUST be the real `internal/store` implementation, NOT a mock.
3. Creates tasks via the local store, runs sync, verifies they appear on mock server's state.
4. Pushes tasks via mock server's API, runs sync, verifies they appear in local DB by querying the real store.
5. Modifies a task locally AND remotely with different `updated_at`, runs sync, verifies last-write-wins.
6. Verifies sync is idempotent: run sync twice in a row with no intervening changes; the second run MUST produce zero writes (verify by counting HTTP calls received by the mock, or by checking an updated-row counter).
7. Verifies sync handles a 409 conflict on POST by retrying as PATCH.

**Anti-mocking rule:** the only thing mocked in this test is the remote server. The local store, the local HTTP client, the SQLite driver, the sync engine itself — all real. If a test passes by stubbing out so much that it doesn't exercise actual SQL queries or actual HTTP marshaling, it's not a real test. The agent's self-check: if the test would still pass after deleting the body of `sync.Run()`, the test is wrong.

### 10.7 Docker acceptance

```bash
cd deploy && docker compose build
docker compose up -d
sleep 3
curl -fsS -H "Authorization: Bearer test-token" localhost:8080/health | grep -q '"ok":true'
docker compose down -v
```

(Agent must `export T_SERVER_TOKEN=test-token` before `up`.)

### 10.8 Service unit generation (cross-platform unit tests)

The agent cannot run `systemctl`, `launchctl`, or `schtasks` in its build environment, so end-to-end service registration is verified manually by the human (see §13). What the agent CAN and MUST verify is that the service unit *files* are generated correctly on every platform.

`internal/service/service_test.go` MUST contain golden-file tests covering all three platforms. The pattern:

```go
func TestSystemdUnitGeneration(t *testing.T) {
    cfg := ServiceConfig{
        DaemonPath: "/home/testuser/.local/bin/t-daemon",
        UserId:     "testuser",
        LogPath:    "/home/testuser/.local/share/t",
    }
    got, err := RenderSystemdUnit(cfg)
    require.NoError(t, err)

    want, err := os.ReadFile("testdata/golden/t-daemon.service")
    require.NoError(t, err)
    assert.Equal(t, string(want), got)
}
```

Required golden files in `internal/service/testdata/golden/`:

- `t-daemon.service` — systemd unit, exact bytes
- `net.dyseti.t-daemon.plist` — launchd plist, exact bytes
- `t-daemon-task.xml` — Windows scheduled task XML, exact bytes

**Required test coverage for each platform:**

1. **Happy-path render** — given a known config, output matches the golden file byte-for-byte.
2. **Path escaping** — daemon path containing spaces (`/Users/Kevin Whiteside/...`) is correctly escaped or quoted per platform conventions. systemd: backslash-escape spaces in `ExecStart`. plist: XML-escape. Task Scheduler XML: XML-escape inside `<Command>`.
3. **Schema validity:**
   - **plist:** parse the rendered output with `howett.net/plist` and verify it round-trips. Don't add this dep just for testing — write a 30-line minimal plist parser if needed, or shell out to `plutil -lint` only if available (`t.Skip()` if not).
   - **Task Scheduler XML:** parse with `encoding/xml` against a struct mirroring the schema. Verify required elements are present (`Triggers/LogonTrigger`, `Principals/Principal/UserId`, `Actions/Exec/Command`, `Settings/MultipleInstancesPolicy`).
   - **systemd unit:** parse line-by-line, verify required `[Unit]`, `[Service]`, `[Install]` sections exist, `Type=simple`, `Restart=on-failure`, `ExecStart` is non-empty.
4. **Platform dispatch** — `InstallService(cfg, runtime.GOOS)` with `goos="linux"|"darwin"|"windows"` invokes the correct renderer. Use a fake `ServiceManager` interface so the test doesn't actually call `systemctl`/`launchctl`/`schtasks`.

**Update golden files via `go test ./internal/service -update`** — wire a `-update` flag that overwrites goldens with current output. Standard Go pattern. Document in `README.md`.

### 10.9 CLI process supervision invariant (code-level, not runtime)

The original concern — CLI accidentally `exec`-ing the daemon as a child process — cannot be runtime-tested in the agent's environment. Enforce at the code level instead:

`internal/service/service_test.go` MUST contain a test that scans the CLI source code (`cmd/t/`) and fails if it finds any of these patterns:

```go
func TestCLINeverExecsDaemon(t *testing.T) {
    // Walk cmd/t/ source files
    // Fail if any file imports "os/exec" AND references "t-daemon" string literal
    // The CLI is allowed to exec systemctl/launchctl/schtasks but never t-daemon directly
}
```

Forbidden patterns the test must catch:
- `exec.Command("t-daemon", ...)`
- `exec.Command("./t-daemon", ...)`
- `exec.Command(filepath.Join(..., "t-daemon"), ...)`
- Any string literal `"t-daemon"` or `"t-daemon.exe"` appearing in `cmd/t/` source

Allowed: `exec.Command("systemctl", "start", "t-daemon")` — here `"t-daemon"` is an *argument* to systemctl, which is fine. The test should check the first argument of `exec.Command` calls, not all string literals.

This is a static check, not a runtime test, but it's robust enough to catch the failure mode at the only point where it matters: when the agent writes the code.

## 11. Out of Scope (do NOT build these)

- User accounts / multi-tenancy
- OAuth / OIDC / anything beyond a static bearer token
- A web UI of any kind
- Mobile clients
- Push notifications
- Plugin system
- Configurable status workflows
- Themes / colors beyond what fzf gives us for free
- Encryption at rest
- Backup / restore commands
- Any TUI beyond fzf integration
- Telemetry of any kind
- **Integration with Notion, Linear, GitHub Issues, Asana, Trello, Jira, Todoist, or any other external task management system.** This is a standalone tool. Even if connectors for these services are available in the agent's harness, they MUST NOT be used. The agent MUST NOT call MCP tools, web APIs, or any external service during the build other than: the public Go module proxy for dependencies, Docker Hub for base images, and Microsoft/systemd documentation if needed for reference.
- LLM features of any kind (no "smart" task suggestions, no auto-categorization, no natural-language parsing of `t add` input beyond simple flag parsing)

If the agent finds itself building any of the above, STOP and re-read this section.

## 12. Decision Log

`DECISIONS.md` MUST be created and appended to whenever the agent makes a non-obvious choice. Format:

```
## YYYY-MM-DD — <decision title>
**Context:** what forced the decision
**Choice:** what was picked
**Alternatives:** what was rejected and why
**Reversibility:** easy / medium / hard
```

Examples of decisions worth logging: choice between `chi` vs `gorilla/mux` if chi has issues; how to handle fzf preview formatting; whether to use `database/sql` directly vs an ORM.

NOT worth logging: variable names, formatting choices, obvious refactors.

## 13. Manual First-Run Verification (the human's job)

The agent runs in an environment without `systemctl --user`, `launchctl`, or `schtasks`, so end-to-end service registration cannot be tested by the agent. The agent MUST produce `docs/FIRST_RUN.md` containing the checklist below, so the human can verify each platform on first install.

`docs/FIRST_RUN.md` MUST contain three sections (one per platform), each with concrete commands to run and expected outputs. Template:

### Linux (KDE/Kubuntu — Terra)

```bash
# 1. Install binaries
make install                                    # copies to ~/.local/bin

# 2. Run init
t init --server-url https://t.dyseti.net --server-token <your-token>
# Expected: ✓ daemon running (pid: N)

# 3. Verify systemd registration
systemctl --user status t-daemon
# Expected: active (running)

# 4. Verify daemon survives shell exit
exit            # close terminal
# Open new terminal
t status
# Expected: daemon: running

# 5. Verify daemon survives reboot
sudo reboot
# After login:
t status
# Expected: daemon: running

# 6. Verify CRUD round-trip
t add "first-run smoke test"
t ls | grep "first-run smoke test"
t sync
# Visit https://t.dyseti.net/tasks (with auth header) — task should appear
```

### macOS (Work MacBook)

```bash
# 1. Install binaries
make install

# 2. Run init
t init --server-url https://t.dyseti.net --server-token <your-token>
# Expected: ✓ daemon running (pid: N)

# 3. Verify launchd registration
launchctl list | grep net.dyseti.t-daemon
# Expected: a line with the PID and label

# 4. Verify daemon survives terminal exit and laptop sleep
# Close terminal, sleep laptop, wake, open new terminal
t status
# Expected: daemon: running

# 5. Verify daemon restarts after login
# Log out, log back in
t status
# Expected: daemon: running

# 6. CRUD round-trip (same as Linux step 6)

# Known macOS quirks to watch for:
# - First run may prompt for permissions (file access). Grant them.
# - If launchctl reports "service exited with error", check ~/.local/share/t/t-daemon.err
```

### Windows (Windows Laptop)

```powershell
# 1. Install binaries
.\install.ps1                                   # copies to %LOCALAPPDATA%\t\bin

# 2. Run init
t init --server-url https://t.dyseti.net --server-token <your-token>
# Expected: ✓ daemon running (pid: N)

# 3. Verify scheduled task registration
schtasks /query /tn t-daemon
# Expected: shows the task with status Ready or Running

# 4. Verify daemon survives terminal exit and logoff/logon
# Sign out of Windows, sign back in
t status
# Expected: daemon: running (auto-started by scheduled task)

# 5. CRUD round-trip (same as Linux step 6)

# Known Windows quirks to watch for:
# - schtasks may fail if antivirus blocks the binary; whitelist t-daemon.exe
# - PowerShell execution policy may need: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# - PID file permissions: %LOCALAPPDATA%\t\daemon.pid must be writable
```

### What to do when something fails

- **`t init` succeeds but `t status` says "daemon: not running":** check the platform-specific log location (`journalctl --user -u t-daemon` on Linux; `~/.local/share/t/t-daemon.err` on macOS; Event Viewer on Windows).
- **Daemon dies when terminal closes:** the CLI is parenting the daemon — this is a code-level violation of the §10.9 invariant. File a bug; do not ship.
- **Sync fails silently:** check `t status` for last sync timestamp. Run `t sync` manually and read its output. Verify server token in `~/.config/t/config.json`.

## Verification Requirements

When all of these are satisfied, create `DONE.md` at the repo root with a short paragraph for each requirement explaining how it's met. Until then, keep working — partial completion is not completion.

1. **All §0.3 build-order checkboxes are ticked.** Every gate in §0.4 has been cleared for every step; nothing was skipped.
2. **All §10 acceptance tests pass on the build host.** `go test ./... -race -count=1` is green; §10.2's cross-compilation matrix succeeds; `go vet ./...` is silent.
3. **`README.md` documents:** install, first-run setup (config file, server token), daemon start, common commands, and hotkey wiring (linking to `scripts/hotkey-snippets.md`).
4. **`docs/FIRST_RUN.md` exists per §13**, with platform-specific verification steps for Linux, macOS, and Windows.
5. **`DECISIONS.md` exists** with at least the initial entries explaining any deviation from this spec, plus the soft-delete-vs-unique-constraint resolution called out in §15.
6. **Repo is committable.** No untracked binaries; `.gitignore` covers `bin/`, `*.db`, `.env`. `make help` lists all available targets with descriptions.

If any acceptance test fails, the job is to fix it, not to declare partial success. If something is genuinely deferred, it goes in `KNOWN_GAPS.md` with rationale per §0.5 — and `DONE.md` is not created until the deferred set is empty or explicitly accepted by the operator.

## 15. Failure Mode Anticipation

Things that have killed similar projects. The agent should treat these as known traps:

- **CGo SQLite bindings.** Will silently work locally and fail on cross-compile. The spec mandates `modernc.org/sqlite`. Verify §10.2 passes — it's the canary.
- **Daemon "works" but doesn't survive restart.** §10.4 and the systemd unit address this. The unit file MUST have `Restart=on-failure`.
- **CLI accidentally parents the daemon.** Tempting failure mode: `t daemon start` shells out to the binary directly via `exec.Command("./bin/t-daemon").Start()` instead of going through systemd/launchd/schtasks. Result: daemon dies when the CLI's terminal closes. §10.9's static check catches this at code level. The CLI MUST always go through the platform service manager.
- **CLI directly opens the SQLite file.** Two writers = corruption. The CLI MUST go through the daemon. Enforce in code review (the agent's own self-review).
- **Sync infinite loop.** Local write triggers sync, sync write to local triggers another sync. Guard with a flag during sync application (`isApplyingRemote bool` or similar).
- **fzf process hangs the CLI.** Use `exec.Cmd` with proper stdin/stdout/stderr wiring; don't reinvent it.
- **Soft-delete + unique constraint.** `projects.name UNIQUE` will conflict with re-creating a deleted project. Either drop the unique constraint or filter by `deleted_at IS NULL` in the index. Pick one in `DECISIONS.md`.
