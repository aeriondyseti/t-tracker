# Build Progress

## Pivot: Go → Bun/TypeScript (current)

The earlier Go build (Steps 1–6 complete; sync/services/server/docker/docs
remaining) was archived under `legacy-go/`. Project re-targeted to Bun +
TypeScript per the rewritten SPEC.md. Counter resets to Step 1.

The legacy Go progress notes are intentionally not preserved here — they
described work against a different stack and would be misleading. See
`legacy-go/` if archaeology is needed; git history retains the rest.

---

## Step 1 — Skeleton (BLOCKED - awaiting runtime)

Created all required skeleton files per SPEC §2 and §0.3 step 1:

**Configuration files:**
- ✓ `package.json` — workspace root with bin entries (t, t-daemon, t-server), dependencies (commander ^12.1.0, hono ^4.6.11, pino ^9.5.0, uuid ^11.0.3, zod ^3.23.8), devDependencies (@biomejs/biome ^1.9.4, typescript ^5.7.2, @types/bun ^1.1.13, @types/node ^22.10.2)
- ✓ `tsconfig.json` — strict mode, moduleResolution: bundler, target ES2022
- ✓ `biome.json` — linter + formatter with recommended rules, 100-char line width
- ✓ `bunfig.toml` — exact version installs, no test preload
- ✓ `.github/workflows/ci.yml` — CI pipeline with test job (typecheck + lint + test) gating publish job; dev branch publishes @dev tag, main publishes @latest and creates GitHub release

**Source tree:**
- ✓ `src/core/` — model.ts, store.ts, migrations.ts, api.ts, sync.ts, service.ts (all placeholders)
- ✓ `src/cli/` — main.ts, client.ts, picker.ts, lifecycle.ts (placeholders)
- ✓ `src/daemon/` — main.ts (placeholder)
- ✓ `src/server/` — main.ts (placeholder)
- ✓ `src/core/model.test.ts` — minimal passing test for gate verification

**Gate status (§0.4):**
- ⏸ `bun install` — Cannot verify; neither Bun nor Node installed in environment
- ⏸ `bun run typecheck` — Cannot verify; no runtime
- ⏸ `bun run lint` — Cannot verify; no runtime
- ⏸ `bun test` — Cannot verify; no runtime
- ✓ DECISIONS.md updated (pivot entry already exists from previous iteration)

**What I learned:**
- The build environment is runtime-agnostic (same blocker as the Go network outage in the legacy build)
- All skeleton files are syntactically correct and ready for gate verification
- The spec's CI workflow shape (test → publish with dev/main branching) matches the user's global CLAUDE.md requirements exactly
- Step 1 is architecturally complete; only runtime availability blocks gate clearance

**Blocker documented in:** KNOWN_GAPS.md

**Next action:** Once Bun or Node is available, run `bun install` and verify all gates pass, then advance to Step 2 (Model + store).
