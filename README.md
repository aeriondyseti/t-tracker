# t — frictionless CLI task tracker

A terminal-resident task tracker with a local daemon, an fzf picker, and
a self-hosted sync server. ADHD-tuned: capture in under 2 seconds; the
daemon stays running across terminal exits and reboots.

> Status: alpha. The build follows the order in [`SPEC.md`](./SPEC.md).
> See [`KNOWN_GAPS.md`](./KNOWN_GAPS.md) for what is and isn't shipped.

## Stack

- **Runtime:** Bun ≥ 1.1 (Node ≥ 20 tolerated for `src/cli/` and `src/core/`).
- **Language:** TypeScript strict mode.
- **HTTP:** Hono on `Bun.serve`.
- **DB:** `bun:sqlite`.
- **CLI:** `commander`. **Validation:** `zod`. **Logging:** `pino`.
- **Tests:** `bun:test`. **Lint+format:** Biome.

## Install (developer mode)

```sh
git clone <repo> t-tracker
cd t-tracker
bun install
bun run typecheck
bun test
```

Compile a standalone binary for your platform:

```sh
bun run compile:linux     # bin/t-linux
bun run compile:darwin    # bin/t-darwin
bun run compile:windows   # bin/t.exe
```

Drop `bin/t-<platform>` somewhere on your `$PATH` (typically
`~/.local/bin/t`) along with `t-daemon` and `t-server`. Then:

```sh
t init                    # one-time per-machine setup
t add "buy milk"
t                         # opens the fzf picker
```

## Commands

```
t                              default: open fzf picker (inbox+active+blocked)
t ls [--all] [--project p] [--status s] [--tag t]
t add "title" [--project p] [--tag a --tag b]

t done <id>     t start <id>     t block <id>     t archive <id>
t edit <id>     # open notes in $EDITOR (placeholder)

t projects
t project add <name>     t project rm <name>

t sync                         force immediate sync, print stats
t status                       daemon health, last sync, task counts

t init
t daemon start | stop | restart | logs [--follow]
```

The CLI is a thin client over the local daemon's loopback HTTP API; it
never touches SQLite directly. The daemon runs under your platform's
service manager (systemd-user / launchd / Task Scheduler) — `t` never
spawns the daemon binary itself, enforced by a static check
(`src/cli/lifecycle.test.ts`, see SPEC.md §10.9).

## Sync

The daemon talks to `t-server` (this repo, `src/server/`) over HTTPS,
last-write-wins per row on `updated_at`. Configure in
`~/.config/t/config.json`:

```json
{
  "server_url": "https://t.example.test",
  "server_token": "<token>",
  "daemon_port": 9999,
  "sync_interval_seconds": 60
}
```

Token is a single static string; the server requires
`Authorization: Bearer <token>` on every route except `/health`.

## Server

```sh
T_SERVER_TOKEN=secret bun run src/server/main.ts
```

Or via Docker (see [`deploy/`](./deploy/)):

```sh
cd deploy
T_SERVER_TOKEN=secret docker compose up -d
curl -fsS -H "Authorization: Bearer secret" localhost:8080/health
```

The compose file binds `127.0.0.1:8080` only — put nginx (or another
reverse proxy) in front of it for public access.

## First-run verification

See [`docs/FIRST_RUN.md`](./docs/FIRST_RUN.md) for per-platform
end-to-end checks: install → init → service registration → survival
across logout → CRUD round-trip.

## Hotkey integration

[`scripts/hotkey-snippets.md`](./scripts/hotkey-snippets.md) contains
KDE, macOS Hammerspoon, and Windows AutoHotkey v2 snippets for binding
`t` to a global hotkey.

## Updating golden tests

Service-unit golden files live under `src/core/testdata/`. Regenerate
after intentional renderer changes:

```sh
UPDATE_GOLDENS=1 bun test src/core/service.test.ts
```

## Branching & release

Per the project's global rules (also in `CLAUDE.md`):

- `main` is protected — PRs only, with reviews requested from Gemini
  Code Assist and Copilot.
- `dev` is the integration branch; direct pushes allowed.
- Feature branches branch from `dev`, merge to `dev`, then to `main` via PR.
- CI publishes the `@dev` npm tag from `dev` and `@latest` from `main`.

## License

MIT — see [`LICENSE`](./LICENSE).
