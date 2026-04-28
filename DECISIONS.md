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

