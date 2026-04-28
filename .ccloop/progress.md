# Build Progress

## Pivot: Go → Bun/TypeScript (current)

The earlier Go build (Steps 1–6 complete; sync/services/server/docker/docs
remaining) was archived under `legacy-go/`. Project re-targeted to Bun +
TypeScript per the rewritten SPEC.md. Counter resets to Step 1.

The legacy Go progress notes are intentionally not preserved here — they
described work against a different stack and would be misleading. See
`legacy-go/` if archaeology is needed; git history retains the rest.

---

## Step 1 — Skeleton (NOT STARTED)

Next: create `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`,
`.github/workflows/ci.yml`, repo layout per SPEC §2, empty source files.
Verify `bun install`, `bun run typecheck`, `bun test` all succeed.
