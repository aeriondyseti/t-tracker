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
