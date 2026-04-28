# `t` — Personal Task Tracker (TypeScript / Bun)

A frictionless CLI task tracker with a local daemon and a remote sync backend. Designed for terminal-resident workflows. ADHD-tuned: capture in under 2 seconds, always visible via tmux/fzf integration, no executive function tax.

This document is the build spec for an autonomous coding agent. Every "MUST" is a hard requirement. Read §0 (Agent Operating Rules) before starting; it defines build order, gates, and self-honesty rules. Every acceptance test in §10 must pass before declaring the build complete.

> **Pivot note:** an earlier iteration of this project built `t` in Go. That code is preserved in `legacy-go/` for reference and is not part of the current build. Do not import from it, link against it, or compile it. The current target is Bun + TypeScript, published to npm.

---

## 0. Agent Operating Rules

### 0.1 Project-level CLAUDE.md

The agent's FIRST action MUST be to verify `CLAUDE.md` at the repo root contains the current TypeScript-targeted instructions. If it still references Go, replace it with the version pinned in §0.1 of this document.

### 0.2 Effort allocation

Rough relative effort, to prevent polishing one component while another goes unbuilt:

| Component | Relative effort |
|---|---|
| Store + sync engine | ~35% |
| CLI (commander + fzf integration) | ~20% |
| Service unit generation + golden tests | ~15% |
| Server (`t-server`) + Docker | ~15% |
| Init / daemon lifecycle commands | ~10% |
| Docs + CI | ~5% |

These are *relative*. If the agent finds itself spending the bulk of effort on lifecycle commands while the sync engine is untested, something is wrong.

### 0.3 Build order

Build in this exact order. Do NOT skip ahead. Each step has a gate (§0.4) that MUST pass before advancing. Tick each box as the gate clears; the harness uses these as its progress signal.

- [ ] **1. Skeleton.** `package.json` (workspace root, `private: false`, `bin` entries for `t`, `t-daemon`, `t-server`), `tsconfig.json` (strict), `biome.json`, `bunfig.toml`, `.github/workflows/ci.yml`, repo layout per §2, empty source files, `bun run typecheck` and `bun test` succeed.
- [ ] **2. Model + store.** `src/core/model.ts` (zod schemas), `src/core/store.ts` (bun:sqlite + hand-rolled migrations), unit tests against an in-memory SQLite (`":memory:"`).
- [ ] **3. API handlers.** `src/core/api.ts` Hono router over the store, handler unit tests using `app.request()`.
- [ ] **4. Daemon binary.** `src/daemon/main.ts` wiring API into `Bun.serve`, end-to-end test per §10.4.
- [ ] **5. CLI core.** `src/cli/main.ts` with commander setup and basic commands (`add`, `ls`, `done`, `start`, `block`, `archive`, `edit`, `projects`, `project add/rm`). Typed HTTP client at `src/cli/client.ts`. NOT yet the fzf picker, NOT yet `init`/`daemon`/`status`.
- [ ] **6. CLI fzf integration.** Default-no-args picker per §6.
- [ ] **7. Sync engine.** `src/core/sync.ts` with mock-server tests per §10.6. Mock the *remote*, never the local SQLite.
- [ ] **8. Service unit generation.** `src/core/service.ts` with golden-file tests per §10.8 covering all three platforms.
- [ ] **9. CLI lifecycle commands.** `t init`, `t daemon start/stop/restart/logs`, `t status`. Static check per §10.9.
- [ ] **10. Server binary.** `src/server/main.ts` reusing `src/core/api.ts`, plus auth middleware.
- [ ] **11. Docker artifacts.** `deploy/Dockerfile` + `deploy/docker-compose.yml`, build-test per §10.7.
- [ ] **12. Documentation + CI.** `README.md`, `docs/FIRST_RUN.md` per §13, `scripts/hotkey-snippets.md`. Verify CI workflow lints + typechecks + tests.

### 0.4 Per-step gates

Before advancing from step N to step N+1, the agent MUST verify:

- `bun run typecheck` (alias: `tsc --noEmit`) succeeds with zero errors.
- `bun run lint` (Biome) succeeds with zero errors.
- `bun test` succeeds with zero failures.
- Standalone-binary build still works: `bun build --compile --target=bun-linux-x64 ./src/cli/main.ts --outfile /tmp/t-linux` succeeds. (Run at every gate after step 4. Catches accidental Node-only API usage early.)
- New decisions are logged in `DECISIONS.md`.

If a gate fails, fix it before advancing. The "I'll come back to this" pattern is forbidden.

### 0.5 Self-honesty rules

- If a test is failing and the agent considers commenting it out, skipping it (`test.skip`), or weakening its assertions: STOP. Either fix the underlying issue or document why the test was wrong in `DECISIONS.md` with rationale.
- If the agent considers adding a `TODO`/`FIXME`: instead, fix it now or add to `KNOWN_GAPS.md` with a clear description and reason.
- If deviating from the spec: document the deviation in `DECISIONS.md` BEFORE making it, not after.
- "Mostly working" is not "working." A test that passes 9 of 10 runs is failing.
- The agent MUST NOT introduce `any`, `as unknown as`, or `// @ts-ignore` to silence type errors. If a type is genuinely unknowable at the boundary, parse it through zod.

---

## 1. Stack (non-negotiable)

- **Runtime:** Bun ≥ 1.1 (also runs under Node ≥ 20 where feasible — see §1.1).
- **Language:** TypeScript ≥ 5.4, strict mode, `"moduleResolution": "bundler"`.
- **HTTP:** [Hono](https://hono.dev) over `Bun.serve`. No Express, no Fastify.
- **DB:** `bun:sqlite` (built-in, no native compile, no prebuilt-binary footgun).
- **Migrations:** hand-rolled — a `_meta` row tracks `schema_version`, and `src/core/migrations.ts` exports an ordered array of `{ version, up: (db) => void }`. Goose-equivalent libraries are forbidden; the schema is small enough.
- **CLI:** `commander` ≥ 12.
- **Validation / parsing:** `zod` ≥ 3.23 for all external input (HTTP bodies, config file, CLI args where dynamic).
- **Logging:** `pino` (JSON to stderr) on the daemon and server. The CLI logs to stderr in plain text with no library — `console.error` is fine.
- **Testing:** `bun:test` (built-in). No Jest, no Vitest.
- **Lint + format:** Biome (single config, single command).
- **Config file:** plain JSON at `~/.config/t/config.json`. No cosmiconfig, no dotenv.

Do NOT introduce other dependencies without an entry in `DECISIONS.md`. Prefer 20 lines of TypeScript over a transitive dep.

### 1.1 Bun-first, Node-tolerant

The CLI and daemon MUST run under Bun. They SHOULD also run under Node 20+ where the cost is trivial — this means:

- Use `node:`-prefixed imports for stdlib (`node:fs`, `node:path`, `node:os`, `node:child_process`).
- For SQLite, the `bun:sqlite` import is unavoidable; isolate it behind `src/core/store.ts` and document the Bun-only constraint at the top of that file.
- Do NOT use Bun-only sugar (`Bun.file`, `Bun.spawn`, `Bun.serve`) in `src/core/`. Confine those to `src/daemon/` and `src/server/`.
- The CLI binary MUST work end-to-end under Bun; Node compatibility is a soft target.

This split keeps the published package usable in mixed environments without forcing a hard Bun dependency on `core/`.

---

## 2. Repository Layout

```
t/
├── src/
│   ├── core/                 # shared: model, store, api handlers, sync, service-unit gen
│   │   ├── model.ts
│   │   ├── store.ts
│   │   ├── migrations.ts
│   │   ├── api.ts
│   │   ├── sync.ts
│   │   └── service.ts
│   ├── cli/                  # `t` binary
│   │   ├── main.ts           # commander setup + entry point
│   │   ├── client.ts         # typed HTTP client to daemon
│   │   ├── picker.ts         # fzf integration
│   │   └── lifecycle.ts      # init / daemon start/stop/restart/logs / status
│   ├── daemon/               # `t-daemon` binary
│   │   └── main.ts
│   └── server/               # `t-server` binary
│       └── main.ts
├── tests/                    # tests live next to source as *.test.ts
├── deploy/
│   ├── Dockerfile            # for t-server
│   └── docker-compose.yml
├── scripts/
│   ├── install.sh            # builds standalone binaries via `bun build --compile`, drops in ~/.local/bin
│   └── hotkey-snippets.md    # OS-specific hotkey one-liners (documentation)
├── docs/
│   └── FIRST_RUN.md
├── .github/workflows/ci.yml
├── package.json
├── tsconfig.json
├── biome.json
├── bunfig.toml
├── README.md
├── DECISIONS.md
└── SPEC.md                   # this document
```

Tests use the `*.test.ts` convention and live alongside the file under test (e.g. `src/core/store.test.ts`). `bun:test` discovers them automatically.

### 2.1 `package.json` shape (mandatory)

```jsonc
{
  "name": "t-tracker",
  "version": "0.1.0",
  "description": "Frictionless CLI task tracker with daemon and sync",
  "type": "module",
  "bin": {
    "t": "./dist/cli/main.js",
    "t-daemon": "./dist/daemon/main.js",
    "t-server": "./dist/server/main.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "bun": ">=1.1.0", "node": ">=20" },
  "scripts": {
    "build": "bun build --target=node --outdir=dist --entrypoints src/cli/main.ts src/daemon/main.ts src/server/main.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "bun test",
    "compile:linux": "bun build --compile --target=bun-linux-x64 ./src/cli/main.ts --outfile bin/t-linux",
    "compile:darwin": "bun build --compile --target=bun-darwin-arm64 ./src/cli/main.ts --outfile bin/t-darwin",
    "compile:windows": "bun build --compile --target=bun-windows-x64 ./src/cli/main.ts --outfile bin/t.exe"
  },
  "publishConfig": { "access": "public" }
}
```

The `name` field is `t-tracker` (the unscoped `t` is taken on npm). Scoped publish under `@aerion/t-tracker` is also acceptable — record the choice in `DECISIONS.md`.

---

## 3. Data Model

Single SQLite schema, used identically by daemon (local cache) and server (source of truth).

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,           -- UUIDv7
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,           -- unix millis
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER                     -- soft delete; NULL = live
);
CREATE UNIQUE INDEX idx_projects_name_live
  ON projects(name) WHERE deleted_at IS NULL;

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,           -- UUIDv7
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('inbox','active','blocked','done','archived')),
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status  ON tasks(status);
CREATE INDEX idx_tasks_updated ON tasks(updated_at);

CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Rules:**
- IDs are UUIDv7 (time-ordered). Use `uuid` ≥ 9 (`uuidv7()`).
- Timestamps are unix millis, stored as `INTEGER`, typed as `number` in TS.
- `deleted_at` enables sync of deletions. Never hard-delete a synced row.
- Status enum is fixed; do not add a config table for statuses. Define it as `const STATUSES = ['inbox','active','blocked','done','archived'] as const` and derive a `Status` union type.
- Default project named `"inbox"` is created on first run if no projects exist.
- `idx_projects_name_live` is a *partial* unique index — it allows recreating a project after soft-delete. This is the resolution to the §15 "soft-delete + unique constraint" trap.

`src/core/model.ts` MUST export zod schemas (`ProjectSchema`, `TaskSchema`) and inferred types (`type Project = z.infer<typeof ProjectSchema>`). HTTP boundary code MUST parse incoming JSON through these.

---

## 4. Sync Protocol

**Last-write-wins, per-row, on `updated_at`.** No CRDTs. If two machines edit the same row in the same millisecond, one edit is silently lost. Acceptable.

**Endpoints (identical on daemon and server):**

```
GET    /health              → {"ok": true}
GET    /tasks?since=<ms>    → {"tasks":[...], "projects":[...], "server_time": <ms>}
POST   /tasks               → creates task, returns full task (409 on duplicate id)
PATCH  /tasks/:id           → updates task, returns full task (404 on unknown)
GET    /projects            → returns live projects (CLI list view)
POST   /projects            → creates project (409 on duplicate id, 400 on duplicate live name)
PATCH  /projects/:id        → updates project (soft-delete via {deleted_at})
POST   /sync                → daemon-only: triggers immediate sync, returns sync stats
```

**Sync algorithm (daemon → server, every `sync_interval_seconds` and after every local write):**

1. Read `last_sync_at` from `_meta` (default: `0`).
2. `GET {server}/tasks?since={last_sync_at}` — pull remote changes. Read `server_time` from response.
3. For each remote project, then each remote task: if `local.updated_at >= remote.updated_at`, skip. Else upsert. Track applied IDs.
4. Query local rows where `updated_at > last_sync_at`, excluding the IDs just applied in step 3.
5. For each local row: `POST` first; on `409`, retry as `PATCH /:id`. Both carry the full row including `updated_at`.
6. Set `last_sync_at = server_time` from step 2.
7. If any HTTP call fails non-2xx, abort the cycle WITHOUT advancing `last_sync_at` — log and let the next tick retry.

**Re-entry guard:** during step 3, the engine sets an `isApplyingRemote` flag. The daemon's "sync after every write" hook MUST check this flag and skip if true, to prevent the local upsert triggering another sync.

**Authentication:**
- Server requires `Authorization: Bearer <token>` on all endpoints except `/health`.
- Token is a single static string set via `T_SERVER_TOKEN` env var on the server.
- Daemon reads its copy from `~/.config/t/config.json` field `server_token`.
- Single-tenant. No user accounts.
- The daemon itself is loopback-only and runs unauthenticated — the network boundary is the security boundary.

---

## 5. Daemon (`t-daemon`)

- Listens on `127.0.0.1:9999` (configurable via `T_DAEMON_PORT`).
- Loopback-only. `Bun.serve({ hostname: "127.0.0.1", ... })`. NEVER `0.0.0.0`. Verify in tests.
- On startup: opens SQLite at `~/.local/share/t/local.db` (Linux) / `~/Library/Application Support/t/local.db` (macOS) / `%LOCALAPPDATA%\t\local.db` (Windows). Override via `T_DAEMON_DATA_DIR`. Runs migrations. Starts HTTP server. Starts sync interval.
- Graceful shutdown on `SIGTERM` / `SIGINT`: stop accepting requests, finish in-flight, run one final sync best-effort, close DB, remove PID file.
- No auth on daemon endpoints.
- Logs to stderr in JSON via pino.
- Writes its PID to `${data_dir}/daemon.pid` on startup. Uses an exclusive-create open; if the file exists, checks whether the PID is alive, exits if so, overwrites if not.

---

## 6. CLI (`t`)

The CLI is a thin client over the daemon's HTTP API. **It MUST NEVER touch SQLite directly.** All state goes through the daemon. This invariant keeps the CLI snappy and the daemon as the single writer.

If the daemon isn't running, most commands print `daemon not running; run 't daemon start' or 't init'` and exit code 2. Exception: `t init`, `t daemon *`, and `t status` work without a running daemon.

**Critical invariant: the CLI process MUST NEVER become the daemon's parent process.** All daemon lifecycle operations go through the platform service manager (systemd-user on Linux, launchd on macOS, Task Scheduler on Windows). The CLI's role is to *invoke* the service manager, never to spawn the daemon binary. See §9 for platform specifics.

**Commands:**

```
t                              # default: open fzf picker over inbox+active+blocked tasks
t ls                           # list tasks (default: inbox+active+blocked), tab-separated
t ls --all
t ls --project <name>
t ls --status <status>
t ls --tag <tag>

t add "title" [--project foo] [--tag bar] [--tag baz]

t done <id-prefix>
t block <id-prefix>
t start <id-prefix>
t archive <id-prefix>
t edit <id-prefix>             # open notes in $EDITOR

t projects
t project add <name>
t project rm <name>            # soft delete

t sync                         # force immediate sync, print stats
t status                       # daemon health, last sync, task counts

t init                         # one-time per-machine setup (idempotent)
t daemon start
t daemon stop
t daemon restart
t daemon logs [--follow]
```

**`t init` semantics (idempotent):**

1. Detect platform via `process.platform`: `linux` → systemd-user, `darwin` → launchd, `win32` → Task Scheduler.
2. Create config (`~/.config/t/`, `~/Library/Application Support/t/`, `%APPDATA%\t\`) and data directories.
3. If `config.json` doesn't exist, write defaults. Prompt interactively for `server_url` and `server_token`. Honor `--server-url` and `--server-token` flags to skip prompts (scripted setup).
4. Render and install platform-specific service unit per §9.
5. Invoke `t daemon start`.
6. Poll `http://127.0.0.1:9999/health` every 250ms for up to 5s. On success: `✓ daemon running (pid: N)`. On timeout: print failure plus a `t daemon logs` hint, exit 2.

**`t daemon start/stop/restart`:** thin shellouts to the platform service manager (see §9). They MUST NOT spawn the daemon binary directly.

**`t status`:**
- Pings `http://127.0.0.1:9999/health`. Responds: print `daemon: running`, last sync timestamp, task counts by status, server URL, server reachability (separate ping).
- No response: print `daemon: not running` and exit 0.

**fzf picker (the `t` command with no args):**
- Pipes tasks to fzf as `<short-id> [<status>] <project>: <title>  #<tags>`.
- `--preview` shows full task notes.
- Keybinds inside fzf:
  - `enter` → cycle status (inbox → active → blocked → done → archived → inbox)
  - `ctrl-e` → exit, run `t edit <id>`, re-enter picker
  - `ctrl-n` → exit, prompt for new title via stdin, create, re-enter picker
  - `ctrl-d` → archive
  - `esc` → exit
- Picker re-fetches between actions (no caching in CLI process).
- Use `node:child_process.spawn` with proper stdio wiring. Detect missing fzf and print install hint.

**Exit codes:** 0 success, 1 user error (bad args, not found), 2 system error (daemon down, network).

---

## 7. Server (`t-server`)

- Same Hono app from `src/core/api.ts`, plus auth middleware that requires `Authorization: Bearer <T_SERVER_TOKEN>` on every route except `/health`.
- Listens on `:8080` (configurable via `T_SERVER_PORT`).
- SQLite at `/data/t.db` (volume-mounted in Docker).
- Designed to run behind nginx at `https://t.dyseti.net`.
- Dockerfile MUST be multi-stage. Final stage: `oven/bun:1-alpine` (or `oven/bun:1-distroless` if it exists at build time). Image MUST run as non-root.
- `docker-compose.yml` MUST mount a named volume at `/data` and expose port 8080 to localhost only.

**Do NOT deploy.** Build the artifacts. The user deploys manually.

---

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

Created with sensible defaults on first daemon run if missing. Token left as `REPLACE_ME` — daemon logs a warning and skips sync until changed.

Parse the file through a zod schema. Refuse to start with a clear error message if the file is malformed.

---

## 9. Service Units & Hotkey Integration

### 9.1 Service Unit Templates

`src/core/service.ts` exports `renderSystemdUnit(cfg)`, `renderLaunchdPlist(cfg)`, `renderWindowsTask(cfg)`, plus an `installService(cfg, platform, manager)` dispatcher where `manager` is a `ServiceManager` interface (so tests can substitute a fake instead of calling `systemctl`).

Templates use Bun's standard string templates (no Mustache/Handlebars).

**Linux — `~/.config/systemd/user/t-daemon.service`:**

```ini
[Unit]
Description=t task tracker daemon
After=network-online.target

[Service]
Type=simple
ExecStart={{daemonCommand}}
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

`{{daemonCommand}}` resolves to either `${HOME}/.local/bin/t-daemon` (compiled binary) or `bun run ${path-to-daemon-entry.js}` (Node/Bun-script install). The agent picks one form and documents the choice in `DECISIONS.md`.

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
{{programArguments}}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{logPath}}/t-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>{{logPath}}/t-daemon.err</string>
</dict>
</plist>
```

**Windows — Scheduled Task XML, registered via `schtasks /create /tn t-daemon /xml <file> /f`:**

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
      <UserId>{{userId}}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{{userId}}</UserId>
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
      <Command>{{daemonCommand}}</Command>
      <Arguments>{{daemonArguments}}</Arguments>
    </Exec>
  </Actions>
</Task>
```

`{{userId}}` resolves to `os.userInfo().username` (format as `DOMAIN\user` or `COMPUTER\user`). XML-escape all template substitutions.

### 9.2 PID file

The daemon writes its PID to `${data_dir}/daemon.pid` on startup using `fs.openSync(path, 'wx')`. If exclusive create fails, it reads the existing PID, tests liveness with `process.kill(pid, 0)`; if alive, exits, otherwise overwrites. Removes the file on graceful shutdown. Used by `t daemon stop` on Windows and by `t status` for `pid: N`.

### 9.3 Hotkey integration (documentation only)

`scripts/hotkey-snippets.md` MUST contain working snippets for KDE (`kwriteconfig5` + `kdialog`), macOS (Hammerspoon Lua), and Windows (AutoHotkey v2). The agent does NOT install or run these.

---

## 10. Acceptance Tests

### 10.1 Build acceptance

```bash
bun install
bun run build
test -f dist/cli/main.js
test -f dist/daemon/main.js
test -f dist/server/main.js
```

### 10.2 Standalone-binary acceptance

```bash
bun run compile:linux
bun run compile:darwin
bun run compile:windows
test -x bin/t-linux
test -x bin/t-darwin
test -f bin/t.exe
```

If any compile step fails, fix it before advancing. Bun's `--compile` is the equivalent of Go's cross-compile guarantee here — it catches accidental Node-only API usage and platform leaks.

### 10.3 Unit test acceptance

```bash
bun test
# Must pass with zero failures.
# Coverage MUST be ≥70% on src/core/. Verify via `bun test --coverage`.
```

### 10.4 Daemon end-to-end acceptance

```bash
export T_DAEMON_DATA_DIR=$(mktemp -d)
export T_CONFIG_DIR=$(mktemp -d)
bun run src/daemon/main.ts &
DAEMON_PID=$!
sleep 1

curl -fsS localhost:9999/health | grep -q '"ok":true'

curl -fsS -X POST localhost:9999/projects \
  -H 'content-type: application/json' \
  -d '{"name":"test-project"}'

TASK_JSON=$(curl -fsS -X POST localhost:9999/tasks \
  -H 'content-type: application/json' \
  -d '{"project":"test-project","title":"buy milk","tags":["errand"]}')
TASK_ID=$(echo "$TASK_JSON" | grep -oE '"id":"[^"]+' | head -1 | cut -d'"' -f4)
test -n "$TASK_ID"

curl -fsS -X PATCH "localhost:9999/tasks/$TASK_ID" \
  -H 'content-type: application/json' \
  -d '{"status":"active"}'

curl -fsS localhost:9999/tasks | grep -q '"status":"active"'

# Loopback check — must REFUSE external bind
! nc -z "$(hostname -I | awk '{print $1}')" 9999 2>/dev/null

kill "$DAEMON_PID"
```

### 10.5 CLI end-to-end acceptance

With daemon running:

```bash
bun run dist/cli/main.js add "test task" --project test-project
bun run dist/cli/main.js ls | grep -q "test task"
TASK_ID=$(bun run dist/cli/main.js ls | grep "test task" | awk '{print $1}')
bun run dist/cli/main.js start "$TASK_ID"
bun run dist/cli/main.js ls --status active | grep -q "test task"
bun run dist/cli/main.js done "$TASK_ID"
bun run dist/cli/main.js ls --status done | grep -q "test task"
```

### 10.6 Sync acceptance (mock server, real local DB)

`src/core/sync.test.ts` MUST contain a test that:
1. Spins up an in-process mock server using Hono's `app.fetch` (no HTTP socket needed — pass it to the sync engine via a `fetch`-compatible function). The mock implements the real HTTP API surface (§4); it is NOT a stub that returns `null`.
2. Creates a real local SQLite store (`":memory:"` or `tmpdir`). The local DB MUST be the real `Store`, NOT a mock.
3. Creates tasks via the local store, runs sync, asserts they appear in the mock server's state.
4. Pushes tasks via the mock server's API, runs sync, asserts they appear in local DB by querying the real store.
5. Modifies a task locally AND remotely with different `updated_at`; runs sync; asserts last-write-wins.
6. Sync idempotency: run sync twice with no intervening changes; the second run MUST issue zero write requests (verify via a counter on the mock).
7. 409 retry: the mock returns 409 to a POST whose id collides; the engine retries as PATCH and the test passes.

**Anti-mocking rule:** the only mocked thing is the remote server. Local store, local HTTP client, SQLite driver, sync engine itself — all real. Self-check: if the test would still pass after deleting the body of `runSync()`, the test is wrong.

### 10.7 Docker acceptance

```bash
cd deploy
export T_SERVER_TOKEN=test-token
docker compose build
docker compose up -d
sleep 3
curl -fsS -H "Authorization: Bearer test-token" localhost:8080/health | grep -q '"ok":true'
docker compose down -v
```

### 10.8 Service unit generation (golden-file tests)

`src/core/service.test.ts` MUST contain golden-file tests covering all three platforms.

Required goldens in `src/core/testdata/`:
- `t-daemon.service`
- `net.dyseti.t-daemon.plist`
- `t-daemon-task.xml`

Required coverage per platform:

1. **Happy-path render** — given a fixed config, output matches the golden byte-for-byte.
2. **Path escaping** — daemon path with spaces (`/Users/Kevin Whiteside/...`) is correctly escaped per platform conventions. systemd: backslash-escape spaces in `ExecStart`. plist + Task Scheduler XML: XML-escape inside the relevant elements.
3. **Schema validity:**
   - **plist:** parse the rendered output with `fast-xml-parser` (allowed dependency for testing only — note in `DECISIONS.md`) or a hand-rolled regex check that verifies `Label`, `ProgramArguments`, `RunAtLoad`, `KeepAlive` exist.
   - **Task XML:** parse with `fast-xml-parser`, verify required nodes (`Triggers/LogonTrigger`, `Principals/Principal/UserId`, `Actions/Exec/Command`, `Settings/MultipleInstancesPolicy`).
   - **systemd:** parse line-by-line, verify required `[Unit]`, `[Service]`, `[Install]` sections exist, `Type=simple`, `Restart=on-failure`, non-empty `ExecStart`.
4. **Platform dispatch** — `installService(cfg, platform, fakeManager)` with `platform` of `'linux'|'darwin'|'win32'` invokes the correct renderer and the expected `fakeManager` calls. The fake records every call; the test asserts the recording matches expectations.

**Update goldens via `bun test --update-snapshots`** if using bun:test snapshots, OR support a `UPDATE_GOLDENS=1` env var that overwrites the goldens with current output. Document the chosen mechanism in `README.md`.

### 10.9 CLI process-supervision invariant (static check)

`src/cli/lifecycle.test.ts` MUST contain a test that scans `src/cli/` source for forbidden patterns:

- `spawn('t-daemon', ...)`
- `spawn('./t-daemon', ...)`
- `spawn(path.join(..., 't-daemon'), ...)`
- Any string literal `'t-daemon'` or `'t-daemon.exe'` appearing as the first argument to `spawn`/`exec`/`execFile`/`execSync`/`Bun.spawn`.

Allowed: `spawn('systemctl', ['start', 't-daemon'])` — `'t-daemon'` is an *argument*, not the command. The test inspects the AST (use `@babel/parser` if a parser is needed — note dep in `DECISIONS.md`) or, more simply, regexes the source text for `spawn\(\s*['"]t-daemon` and rejects matches.

This is static, not runtime, but catches the failure at the only point that matters: when the agent writes the code.

---

## 11. Out of Scope (do NOT build these)

- User accounts / multi-tenancy
- OAuth / OIDC / anything beyond a static bearer token
- A web UI of any kind
- Mobile clients
- Push notifications
- Plugin system
- Configurable status workflows
- Themes beyond what fzf gives for free
- Encryption at rest
- Backup / restore commands
- Any TUI beyond fzf integration
- Telemetry of any kind
- **Integration with Notion, Linear, GitHub Issues, Asana, Trello, Jira, Todoist, or any other external task system.** Standalone tool. Do NOT call MCP tools, web APIs, or any external service during the build other than: the public npm registry for dependencies, Docker Hub for base images, and Microsoft/systemd/Apple documentation if needed for reference.
- LLM features (no "smart" suggestions, auto-categorization, NLP parsing of `t add`)

If the agent finds itself building any of the above, STOP and re-read this section.

---

## 12. Decision Log

`DECISIONS.md` MUST be appended to whenever the agent makes a non-obvious choice. Format:

```
## YYYY-MM-DD — <decision title>
**Context:** what forced the decision
**Choice:** what was picked
**Alternatives:** what was rejected and why
**Reversibility:** easy / medium / hard
```

Worth logging: choice between Hono vs `Bun.serve` raw routing if Hono is dropped; whether to bundle vs ship raw `.ts`; how fzf preview formatting works; the package name (`t-tracker` vs `@aerion/t-tracker`); the daemon-command form chosen for §9.1.

NOT worth logging: variable names, formatting, obvious refactors.

---

## 13. Manual First-Run Verification

The agent runs without `systemctl --user`, `launchctl`, or `schtasks`, so end-to-end service registration is verified manually. The agent MUST produce `docs/FIRST_RUN.md` with three platform sections (Linux, macOS, Windows), each with concrete commands and expected outputs covering: install, init, service registration check, survival across terminal exit, survival across logout/reboot, and a CRUD round-trip.

Use the Go spec's §13 template as a structural guide; replace `make install` with `bun install -g t-tracker` (or the chosen package name) and Go-binary paths with their TS equivalents.

---

## 14. CI / Publish Flow

Single workflow `.github/workflows/ci.yml` with a `test` job gating a `publish` job, per the user's global branching model:

- **`main`** is protected. Changes reach `main` only via PR with reviews requested from Gemini Code Assist and Copilot.
- **`dev`** is the integration branch. Direct pushes allowed.
- **Feature branches** are branched from `dev`, merged into `dev` for testing, then to `main` via PR once validated.
- Pushes to `dev` publish with the `@dev` npm tag (version auto-suffixed `-dev.<run_number>`).
- Pushes to `main` publish with the `@latest` tag, create a git tag and GitHub Release, then reset `dev` to match `main`.
- PRs and pushes run `bun run typecheck`, `bun run lint`, `bun test`. Publish runs only on push to `main`/`dev` (not PRs).

The workflow MUST use `oven-sh/setup-bun@v2`. NPM publish requires `NPM_TOKEN` in repo secrets — document in `README.md`, do not embed.

---

## 15. Failure Mode Anticipation

Known traps:

- **Native SQLite drivers.** `better-sqlite3` requires native compile / prebuilt binaries and creates platform headaches. The spec mandates `bun:sqlite`. If a future need forces switching, log it in `DECISIONS.md` and re-verify §10.2 across all three targets.
- **Daemon "works" but doesn't survive restart.** §10.4 and the systemd unit address this. Unit MUST have `Restart=on-failure`.
- **CLI accidentally parents the daemon.** Tempting failure: `t daemon start` runs `Bun.spawn(['t-daemon'])` instead of going through the service manager. Result: daemon dies when the CLI's terminal closes. §10.9's static check catches this.
- **CLI directly opens the SQLite file.** Two writers = corruption. The CLI MUST go through the daemon. The architectural rule: nothing under `src/cli/` may import `src/core/store.ts`.
- **Sync infinite loop.** Local write triggers sync; sync writes to local triggers another sync. Guard via `isApplyingRemote` flag (§4) AND the daemon hook checks it before scheduling a new sync.
- **fzf process hangs the CLI.** Use `node:child_process.spawn` with `stdio: ['pipe','inherit','inherit']` and write task list to stdin. Don't reinvent.
- **Soft-delete + unique constraint.** Resolved by the partial unique index `idx_projects_name_live`. The schema in §3 already encodes this; do not add an unconditional `UNIQUE` to `projects.name`.
- **`bun:sqlite` import in shipped client code that runs under Node.** Confine the import to `src/core/store.ts` with a top-of-file comment marking it Bun-only. The CLI `src/cli/` MUST NOT transitively import it.
- **Top-level await in published bins.** Bun handles it; Node ESM also handles it; CommonJS does not. Since `package.json` declares `"type": "module"`, top-level await is safe — but never bundle to CommonJS for the published artifacts.

---

## Verification Requirements

When all of the following are satisfied, create `DONE.md` at the repo root with a short paragraph for each requirement explaining how it's met. Until then, keep working — partial completion is not completion.

1. **All §0.3 build-order checkboxes are ticked.** Every gate in §0.4 cleared for every step; nothing skipped.
2. **All §10 acceptance tests pass on the build host.** `bun test` green; §10.2's compile matrix succeeds; `bun run typecheck` and `bun run lint` silent.
3. **`README.md` documents:** install (`bun install -g <name>` + manual `bun build` path), first-run setup (config, server token), daemon start, common commands, hotkey wiring (linking to `scripts/hotkey-snippets.md`), and how to update service-unit goldens.
4. **`docs/FIRST_RUN.md` exists per §13**, with platform-specific verification steps for Linux, macOS, Windows.
5. **`DECISIONS.md` exists** with at least: the Go→TS pivot, the package name, the daemon-command form for service units, and any other non-obvious choices.
6. **CI workflow is green** on at least one push to `dev` (typecheck + lint + test all passing).
7. **Repo is committable.** `.gitignore` covers `node_modules/`, `dist/`, `bin/`, `*.db`, `.env`, `coverage/`. No untracked build artifacts. No secrets.

If any acceptance test fails, the job is to fix it. If something is genuinely deferred, it goes in `KNOWN_GAPS.md` with rationale per §0.5 — and `DONE.md` is not created until the deferred set is empty or explicitly accepted by the operator.
