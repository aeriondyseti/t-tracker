# Known Gaps

This file tracks items that are deferred or blocked, per SPEC.md §0.5.

---

## 2026-04-27 — Intermittent network blocking Step 4 progression

**What's missing:** Step 4 (Daemon binary) cannot be implemented due to intermittent network connectivity.

**Current status:**
- ✅ Step 1 (Skeleton) - COMPLETE
- ✅ Step 2 (Model + store) - COMPLETE (gates passed when network was available)
- ✅ Step 3 (API handlers) - COMPLETE (gates passed when network was available)
- ⏸ Step 4 (Daemon binary) - BLOCKED (network down, modules not cached)

**Why blocked:** Network connectivity is intermittent. While `go.sum` exists (189 lines), Go modules are not cached locally. Cannot compile or test without downloading dependencies.

**Evidence of network failure:**
```
go test ./... fails with:
modernc.org/sqlite@v1.29.5: Get "https://proxy.golang.org/...": dial tcp: lookup proxy.golang.org: connection refused
```

**Resolution path:** Network must be restored to:
1. Download modules via `go mod download`
2. Implement `cmd/t-daemon/main.go` per §5 (loopback HTTP server, SQLite, graceful shutdown)
3. Run Step 4 gates (build, test, cross-compile, vet)
4. Remove this entry once gates pass
5. Advance to Step 5 (HTTP client)

**Not proceeding further:** Per §0.4 and §0.5, cannot implement code that cannot be compiled or tested. Must wait for network restoration.
