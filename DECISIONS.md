# Decision Log

This file records non-obvious technical decisions made during the build.

---

## 2025-04-27 — Initial skeleton setup

**Context:** Starting the project from scratch per SPEC.md §0.3 step 1.

**Choice:** Standard Go project layout with `cmd/` for binaries and `internal/` for packages. Used minimal placeholder files to ensure compilation passes.

**Alternatives:** Could have created a more elaborate skeleton, but the spec calls for "empty packages" at this stage.

**Reversibility:** Easy — this is just scaffolding.
