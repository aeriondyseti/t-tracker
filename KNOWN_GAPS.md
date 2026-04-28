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

### Still unbuilt (in order)
- Step 7 — Sync engine (`src/core/sync.ts` + tests per §10.6)
- Step 8 — Service unit generation (`src/core/service.ts` + golden tests per §10.8)
- Step 9 — CLI lifecycle commands (`t init`, `t daemon *`, `t status`)
- Step 10 — Server binary with auth middleware (§7)
- Step 11 — Docker artifacts (`deploy/Dockerfile`, `deploy/docker-compose.yml`) — gated on Step 10
- Step 12 — Docs + CI verification

The `t edit`, `t sync`, `t status`, `t init`, `t daemon *` commands in
`src/cli/main.ts` remain placeholders that exit non-zero with a clear
message. They will be filled in by Steps 7 and 9.
