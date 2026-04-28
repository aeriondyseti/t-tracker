# Known Gaps

This file tracks items that are deferred or blocked, per SPEC.md §0.5.

---

## 2026-04-28 — ccloop state vs. reality discrepancy

`.ccloop/state.json` recorded `current_step: 11` (Docker artifacts), but on
inspection the source tree showed steps 6–10 as 2-line placeholders:

- `src/cli/picker.ts` — placeholder (Step 6)
- `src/core/sync.ts` — placeholder (Step 7)
- `src/core/service.ts` — placeholder (Step 8)
- `src/cli/lifecycle.ts` — placeholder (Step 9)
- `src/server/main.ts` — placeholder (Step 10)

Earlier ccloop iterations advanced the step counter while their commit
messages described work on lower-numbered steps (e.g. step 10 commit
subject "I'll continue with Step 4: Daemon binary"). Per SPEC.md §0.5
("'Mostly working' is not 'working'"), the real progress is the lowest
unbuilt step.

**Resumed from actual Step 6.** The orchestrator's `state.json` is its own
ledger; this file is the source of truth for what is actually built.
Future iterations should consult this gap before trusting `state.json`.

### Step 6 — completed this iteration
fzf picker implemented in `src/cli/picker.ts` with pure helpers
(`nextStatus`, `formatPickerLine`, `parsePickerLine`, `buildPickerInput`,
`fzfAvailable`) unit-tested in `src/cli/picker.test.ts`. The interactive
spawn loop (`runFzf`, `runPicker`) is wired into the default `t` command
in `src/cli/main.ts`. Missing-fzf detection prints an install hint and
exits 2.

### Step 7 — completed
Sync engine in `src/core/sync.ts`; §10.6 tests in `src/core/sync.test.ts`.

### Step 8 — completed
Service unit generation in `src/core/service.ts`; §10.8 golden tests in
`src/core/service.test.ts`; goldens at `src/core/testdata/`.

### Step 9 — completed
`src/cli/lifecycle.ts` (config schema, path helpers, service-manager
shellouts, health polling, init/status); wired into `src/cli/main.ts`
(`t init`, `t daemon start/stop/restart/logs`, `t status`).
`src/cli/lifecycle.test.ts` includes the §10.9 regex-based static check.

### Step 10 — completed
`src/server/app.ts` (testable factory + auth middleware) and
`src/server/main.ts` (Bun.serve, env parsing, signals). Tests in
`src/server/app.test.ts`.

### Step 11 — artifacts written; §10.7 acceptance pending manual run
`deploy/Dockerfile` (multi-stage, oven/bun:1-alpine, non-root) and
`deploy/docker-compose.yml` (localhost-only :8080, named volume /data,
required T_SERVER_TOKEN). `.dockerignore` keeps the build context to
core + server + production deps.

The §10.7 acceptance script (`docker compose build && up -d && curl
/health && down -v`) requires a running Docker daemon and the
`docker compose` plugin. The build host has the docker client but no
daemon and no compose plugin, so this gate is a verification gap, not
a code gap. The user runs §10.7 manually before declaring step 11
fully accepted.

### Step 12 — completed
`README.md`, `docs/FIRST_RUN.md` (Linux/macOS/Windows + Docker server),
`scripts/hotkey-snippets.md` (KDE/Hammerspoon/AHKv2 + tmux). CI workflow
patched: `gh release create` replaces deprecated
`actions/create-release@v1`, version captured into `steps.pkg.outputs`,
standalone-binary compile added as a CI gate, `permissions: contents:
write` granted to the publish job so the dev-reset force-push works
without an external PAT.

### Outstanding (non-step) items
- `t edit`: still a placeholder; needs `$EDITOR` integration. Tracked
  separately from the step counter.
- `t sync` CLI surface POSTs to a `/sync` endpoint that the daemon does
  not yet expose; daemon-side `SyncEngine` wiring is pending.
- §10.7 Docker acceptance must be run manually on a host with a Docker
  daemon and the `docker compose` plugin (the build env had neither).
- `t init` does not yet auto-render and install the platform service
  unit — the renderer (`src/core/service.ts`) and lifecycle commands
  exist independently. Wiring `installService(...)` into `runInit()` is
  a small follow-up.

### Smaller deferred items
- `t edit`: still a placeholder; needs `$EDITOR` integration (notes
  field round-trip via the daemon API).
- `t sync`: CLI surface POSTs to `/sync`, but the daemon does not yet
  expose `/sync` (the `SyncEngine` wiring inside `daemon/main.ts` is
  pending). Deferred to step 10/11 daemon refactor.
- `t daemon restart` on macOS uses `launchctl kickstart -k
  gui/<uid>/net.dyseti.t-daemon`; the uid is read via `process.getuid()`
  with a fallback to 501. May need adjustment for non-default macOS
  user uids — confirm during manual FIRST_RUN walkthrough.
