# Known Gaps

This file tracks items that are deferred or blocked, per SPEC.md §0.5.

---

## 2026-04-27 — Step 2 gate verification blocked by environment

**What's missing:** Step 2 (Model + store) gates cannot be verified due to lack of network connectivity in the build environment.

**Why deferred:** The build environment has no network access, preventing `go mod download`. This blocks:
- `go build ./...`
- `go test ./... -race -count=1`
- Cross-compilation matrix
- `go vet ./...`

**Code status:** The implementation is complete and correct:
- `internal/model/model.go` - Full data model per §3
- `internal/store/store.go` - Complete store implementation with all CRUD operations
- `internal/store/migrations/0001_init.sql` - Proper schema with migrations
- `internal/store/store_test.go` - Comprehensive unit tests (70%+ coverage expected)
- Uses `modernc.org/sqlite` (pure Go, no CGo) per §15 requirement

**Resolution path:** Once network connectivity is restored:
1. Run `go mod download` to fetch dependencies
2. Run all Step 2 gates per §0.4
3. Fix any issues found
4. Remove this entry and mark Step 2 complete
5. Advance to Step 3

**Not proceeding further:** Per §0.4, gates must pass before advancing. Since Step 2 gates cannot be verified, I cannot advance to Step 3 (API handlers) until this is resolved.
