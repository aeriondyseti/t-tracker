# Project: t

This project is **Bun + TypeScript only**. The published artifact is an npm
package (`t-tracker` or `@aerion/t-tracker` — see DECISIONS.md). Do NOT
suggest, scaffold, or fall back to Go, Python, or any other stack.

> An earlier iteration was built in Go and is preserved under `legacy-go/`
> for reference. Do not import from it, link against it, or compile it.
> The current build target is defined in SPEC.md.

This is a single-user personal tool. Do NOT integrate with Notion, Linear,
GitHub Issues, Asana, Trello, or any other external task system, even if
connectors are available in the environment.

Build order is defined in SPEC.md §0.3. Follow it strictly. Do not jump ahead.

When making non-obvious decisions, append to DECISIONS.md per SPEC.md §12.

When a step's gate (SPEC.md §0.4) fails, fix it before advancing. Do not
declare partial success.

## Stack constraints (non-negotiable)

- Runtime: Bun ≥ 1.1 (Node ≥ 20 tolerated for `src/cli/` and `src/core/`)
- Language: TypeScript strict mode
- HTTP: Hono on Bun.serve
- DB: `bun:sqlite` (confined to `src/core/store.ts`)
- CLI: commander
- Validation: zod at every external boundary
- Logging: pino (daemon, server) / `console.error` (CLI)
- Testing: `bun:test`
- Lint+format: Biome

No other dependencies without an entry in DECISIONS.md.

## Branching & Release Flow

Per the user's global rules:
- `main` is protected; PRs only, with reviews from Gemini Code Assist and Copilot.
- `dev` is the integration branch; direct pushes allowed.
- Feature branches from `dev` → `dev` → `main`.
- CI publishes `@dev` tag from `dev` and `@latest` tag from `main`.
