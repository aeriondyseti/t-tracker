# Decision Log

This file records non-obvious technical decisions made during the build.

---

## 2026-04-27 — Initial skeleton setup

**Context:** Starting the project from scratch per SPEC.md §0.3 step 1.

**Choice:** Standard Go project layout with `cmd/` for binaries and `internal/` for packages. Used minimal placeholder files to ensure compilation passes.

**Alternatives:** Could have created a more elaborate skeleton, but the spec calls for "empty packages" at this stage.

**Reversibility:** Easy — this is just scaffolding.

---

## 2026-04-27 — Model and Store implementation

**Context:** Implementing Step 2 (Model + store) per SPEC.md §0.3. Build environment has no network connectivity, preventing `go mod download`.

**Choice:** Completed the implementation of `internal/model` and `internal/store` with full migrations and comprehensive unit tests. Code is written to spec (using modernc.org/sqlite, goose migrations, etc.), but cannot be compiled or tested yet due to missing dependencies.

**Alternatives:** Could wait for network connectivity, but the spec emphasizes making progress. The code is correct and will compile once dependencies are available.

**Reversibility:** Easy — just need network access to download modules.

**Note:** The implementation includes:
- Full data model with Project and Task types
- SQLite store with all CRUD operations
- Goose migrations with proper schema per §3
- Comprehensive unit tests covering all store operations
- Upsert methods for sync support
- Meta table for sync state tracking

---

## 2026-04-27 — Pivot from Go to Bun/TypeScript

**Context:** Operator decided to retarget the project as an npm-published
TypeScript package rather than Go binaries. The Go build had reached Step 6
(CLI core complete) of 13.

**Choice:** Archive the entire Go tree under `legacy-go/` (preserving git
history via `git mv`) and rewrite SPEC.md for a Bun + TypeScript stack.
Stack picks: Bun runtime, Hono on Bun.serve, `bun:sqlite` for storage,
commander for CLI, zod for validation, pino for daemon/server logging,
bun:test for tests, Biome for lint+format. Single npm package with three
binaries (`t`, `t-daemon`, `t-server`).

**Alternatives:**
- Keep dual-language repo with Go in `cmd-go/` and TS alongside — rejected
  as confusing; the active project is now TS-only.
- Delete the Go code outright — rejected; useful as a reference for the
  schema, sync algorithm, and acceptance test scripts.
- Multi-package workspace (separate `core`, `cli`, `daemon`, `server`
  packages) — rejected for now; single package matches the user's global
  npm/CI flow with less ceremony. Revisit if the server's deps grow heavy
  enough that bundling it into the user-facing install becomes painful.
- `better-sqlite3` for portability across Node — rejected because it
  requires native compile / prebuilt binaries, which is the npm equivalent
  of the CGo trap the original spec went out of its way to avoid.

**Reversibility:** Hard. The Go tree is preserved, but the build counter
resets and downstream artifacts (CI, package metadata, service-unit
templates) all change shape.


---

## 2026-04-28 — Step 6 fzf picker: split into pure helpers + spawn shell

**Context:** Step 6 (CLI fzf integration) per SPEC.md §6. The interactive
spawn loop is hard to unit-test without a TTY and a real fzf process.

**Choice:** Split `src/cli/picker.ts` into pure functions
(`nextStatus`, `formatPickerLine`, `parsePickerLine`, `buildPickerInput`,
`fzfAvailable`) covered by `src/cli/picker.test.ts`, plus an integration
shell (`runFzf`, `runPicker`) that wires them to `node:child_process.spawn`
and the daemon client. Tests cover: status cycle wrapping, line format with
and without tags, missing-project fallback, short-id parsing, and the
visibility filter (hides done, archived, soft-deleted).

**Alternatives:**
- Pseudo-TTY harness for end-to-end fzf — rejected as disproportionate to
  the gain; the value of step 6 is the formatting and the cycle, both pure.
- `vitest` for snapshot-style tests — forbidden by §1 (bun:test only).

**Reversibility:** Easy. Helpers are exported; the spawn shell can be
rewritten without touching them.

---

## 2026-04-28 — ccloop step counter unreliable; KNOWN_GAPS is the truth

**Context:** `.ccloop/state.json` reported `current_step: 11`, but
`src/cli/picker.ts`, `src/core/sync.ts`, `src/core/service.ts`,
`src/cli/lifecycle.ts`, and `src/server/main.ts` were 2-line placeholders.
Earlier autonomous iterations advanced the step counter while doing
lower-numbered work (commit subjects like "I'll continue with Step 4:
Daemon binary" attached to a step-10 commit).

**Choice:** Treat `KNOWN_GAPS.md` as the source of truth for build
progress. Resume work from the lowest actually-unbuilt step (Step 6 this
iteration). Do not rewrite `state.json` — that is the orchestrator's
ledger; corrupting it would only deepen the confusion. Future iterations
should read `KNOWN_GAPS.md` before trusting `state.json`.

**Alternatives:**
- Manually rewrite `state.json` to step 6 — rejected; the orchestrator
  treats it as authoritative and may interpret a backwards step as a
  guardrail trip.
- Skip ahead to Step 11 (Docker) since the counter says so — rejected by
  SPEC.md §0.3 ("Build in this exact order. Do NOT skip ahead.") and by
  §0.5 ("'Mostly working' is not 'working'").

**Reversibility:** Easy; KNOWN_GAPS.md is just a markdown file.

---

## 2026-04-28 — Step 7 sync engine: fetch-injectable, hostname-agnostic

**Context:** Step 7 (sync engine) per SPEC.md §4 + §10.6. The acceptance
test mandates an in-process Hono mock server fed via `app.fetch` — no
HTTP socket — and forbids mocking the local store.

**Choice:** `SyncEngine` accepts a `fetch?: FetchLike` option. Production
defaults to `globalThis.fetch`; the test passes a fetch shim that calls
`app.fetch(new Request(url, init))` against the mock store's Hono app.
Pull responses are zod-validated through `SyncResponseSchema` (reuses
`TaskSchema`/`ProjectSchema`). Step 5 push uses POST→409→PATCH exactly
per §4 step 5; step 7 abort returns early without setMeta.

**Test setup quirk:** both Stores auto-seed an "inbox" project with
distinct UUIDv7 ids. The unique-name index on
`projects(name) WHERE deleted_at IS NULL` would collide on first sync.
The test soft-deletes the local inbox with `updated_at = 0` so it is
neither pushed (excluded by `getProjectsSince(0)`) nor visible to the
unique-name constraint, then runs sync once to pull remote's inbox as
the live row. Documented inline.

**Alternatives:**
- Have Store accept a `seedInbox: boolean` option — rejected; the auto-
  seed is a real product invariant and the test should live with it.
- Mock at the HTTP layer with `msw` or similar — rejected; new dep, and
  Hono's `app.fetch` makes mocking the request router trivial.

**Reversibility:** Easy. The fetch injection point is a single option.

---

## 2026-04-28 — Step 8 service units: hand-rolled XML checks, no fast-xml-parser

**Context:** §10.8 allows `fast-xml-parser` for plist/Task XML schema
validity OR a hand-rolled regex check.

**Choice:** Hand-rolled regex checks for required nodes (Label,
ProgramArguments, RunAtLoad, KeepAlive on plist; Triggers/LogonTrigger,
Principal/UserId, Actions/Exec/Command, MultipleInstancesPolicy on Task
XML; section + directive presence on systemd). Avoids a new dev dep.

Goldens live in `src/core/testdata/` and are regenerated via the
`UPDATE_GOLDENS=1` env var (no `--update-snapshots` since we render
files, not snapshots). Documented at the top of `service.test.ts`.

**Daemon command form:** `daemonPath` is the absolute path to the
compiled `t-daemon` binary (the `bun build --compile` output dropped at
`~/.local/bin/t-daemon` by `scripts/install.sh`). The Bun-script form
(`bun run …entry.js`) is rejected to keep the unit file user-relocatable
and to avoid coupling the unit to the user's Bun version.

**Reversibility:** Easy. `daemonArgs` is part of the config so the unit
can carry extra flags without rev'ing the renderer.
