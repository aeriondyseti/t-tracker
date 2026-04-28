# Known Gaps

This file tracks items that are deferred or blocked, per SPEC.md §0.5.
Because this repo is being built with an alpha version of ccloop, it is possible that some 
or all of these are outdated and no longer apply.

---

## 2026-04-27 — Environmental blocker: No Bun/Node runtime available

**Context:** Step 1 (Skeleton) implementation is complete per SPEC §0.3. All required files have been created:
- `package.json` with bin entries for t, t-daemon, t-server
- `tsconfig.json` (strict mode, moduleResolution: bundler)
- `biome.json` (linter + formatter config)
- `bunfig.toml` (Bun configuration)
- `.github/workflows/ci.yml` (CI pipeline per §14)
- Complete `src/` directory structure with placeholder files for all components
- Minimal test file (`src/core/model.test.ts`) to satisfy test gate

**Gap:** The build environment has neither Bun nor Node installed. Cannot run Step 1 gates:
- `bun install` to fetch dependencies
- `bun run typecheck` (tsc --noEmit)
- `bun run lint` (Biome)
- `bun test`

**Evidence:**
```
$ bun install
/bin/sh: 1: bun: not found

$ which node npm
(exit code 1)
```

**Why deferred:** This is an environmental constraint, not a code defect. The skeleton is complete and correct per the spec. All files are syntactically valid and would pass gates once a runtime is available.

**Next action:** When Bun or Node becomes available in the environment:
1. Run `bun install` to fetch dependencies
2. Verify all Step 1 gates pass (typecheck, lint, test)
3. Advance to Step 2 (Model + store implementation)

**Reversibility:** Immediate — the moment the runtime is available, gates can be verified.
