---
title: Development
description: Local development workflow for the Junior monorepo.
type: tutorial
summary: Set up Junior locally, run checks, and use isolated worktrees for parallel agent or contributor tasks.
prerequisites: []
related:
  - /contribute/testing/
  - /contribute/releasing/
  - /start-here/quickstart/
---

## Choose a setup

Use the checked-in devcontainer on Linux or WSL2 to run Node inside Docker.
Use native setup if you already have Node.js 24 and pnpm 11.8.0.
Local CLI chat does not require Slack credentials or a web server.

## Docker devcontainer

You need Docker Engine 25 or later, Docker Compose 2.24.4 or later, and a host
Node installation that can run the Dev Container CLI. Docker must expose
`/var/run/docker.sock`. This setup requires Linux host networking. Docker Desktop
on macOS and Windows is not supported by this configuration.

**Use this only for trusted local development.** Access to the Docker socket
grants root-equivalent control of your host. Junior's Docker sandboxes are
privileged containers. A non-root container user does not remove these risks.

From the repository root, set an explicit project name and start the container:

```bash
export COMPOSE_PROJECT_NAME=junior-devcontainer
npx --yes --package @devcontainers/cli devcontainer build --workspace-folder "$PWD"
npx --yes --package @devcontainers/cli devcontainer up --workspace-folder "$PWD"
npx --yes --package @devcontainers/cli devcontainer exec --workspace-folder "$PWD" bash
```

Keep this project name set for later Dev Container CLI commands. For another
checkout, choose another project name and unused ports before build and up:

```bash
export COMPOSE_PROJECT_NAME=junior-devcontainer-other
export JUNIOR_DEV_POSTGRES_PORT=55433 JUNIOR_DEV_REDIS_PORT=56380
export JUNIOR_DEV_S3_PORT=57071 JUNIOR_DEV_APP_PORT=3301
```

The default ports are private to host loopback:

| Surface                   | Host address      |
| ------------------------- | ----------------- |
| Postgres 17 with pgvector | `127.0.0.1:55432` |
| Redis                     | `127.0.0.1:56379` |
| S3-compatible storage     | `127.0.0.1:57070` |
| App, only when requested  | `127.0.0.1:3300`  |

The container uses Node.js 24, pnpm 11.8.0, Docker CLI and Compose. Source and
all `node_modules` directories share one bind-mounted filesystem. pnpm needs
this layout for injected workspace dependency hardlinks. Only the pnpm store
uses a separate Docker cache volume. Run the frozen install inside the
container before use. Do not mix host and container dependency installs in
one checkout; use a separate checkout if you also need native development.
The entrypoint does not change host workspace or dependency ownership.

Run Git on the host when a worktree points to Git metadata outside the mounted
checkout. Container installs use `SKIP_INSTALL_SIMPLE_GIT_HOOKS=1` to leave host
Git hooks unchanged.

Postgres, Redis and S3 reuse the root Compose service definitions in this
separate project. Their data volumes are separate from ordinary local
development. The container's `COMPOSE_FILE` includes only backing services.
Thus, a requested `pnpm dev` reuses these services without restarting its own
container. Keep `COMPOSE_FILE` and `COMPOSE_PROJECT_NAME` unchanged inside it.

### Add private configuration

Put credentials in the repository's gitignored `.env.local`. Edit this file
without printing its values or adding them to shell history. The source CLI
and dev server read it at runtime. Do not copy secrets into `.devcontainer`,
Docker build arguments, image layers, or checked-in examples.

Gateway-only setup needs `AI_GATEWAY_API_KEY`; leave `AI_COMPLETION_*` unset.
Gateway still handles embeddings, web search, image generation and image editing
when you select a custom completion endpoint. These operations need Gateway
configuration. Chat vision completions use the selected completion endpoint.
See [Local Agent Validation](/contribute/local-agent-validation/)
for the custom completion environment and model metadata.

Linux host networking lets `http://127.0.0.1:8317/v1` reach an existing host
proxy without changing its listener. It also lets sandbox traffic reach
Junior's local egress proxy. Do not change the proxy or expose it on all
interfaces. Host networking is not a network isolation boundary.

### Install and use the CLI

Inside the container, run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- upgrade
pnpm cli -- check
pnpm cli -- chat
```

The configuration check must pass. Chat must produce a response. These commands
do not start Slack, a tunnel, or the dashboard. Run `pnpm dev` only when you
need the web app. The app listens on `127.0.0.1:3300`; the container disables
automatic tunnels and browser opening. Do not forward private dashboard or
diagnostic ports to a public address.

The example app installs BullMQ and Redis as development dependencies. Other
apps that select BullMQ must install both optional peers. Node bundles load
these packages at runtime; keep their `node_modules` available.

### Run tests

Run the standard suite inside the container:

```bash
pnpm test
```

Core tests ignore local completion endpoint and model overrides. They use
in-memory state and attachment storage, with Vercel queue and sandbox fixtures.
Service tests still use the container's Postgres, Redis and `JUNIOR_S3_ENDPOINT`.
The Postgres harness creates separate test databases; it does not reset the
application database. CLI chat and live evals keep your local configuration.

On a shared host, reduce test concurrency if the default run reaches
test timeouts. Keep the existing time limits:

```bash
VITEST_MAX_WORKERS=2 pnpm test
```

The real Docker sandbox test is opt-in and needs network access:

```bash
JUNIOR_DOCKER_SANDBOX_TEST=1 pnpm --filter @sentry/junior exec vitest run tests/integration/docker-sandbox-provider.test.ts
```

This test calls the Docker provider directly. Normal tests do not change the
application's Docker sandbox or BullMQ queue defaults.

### Stop services

To stop this project's services without removing its data, run on the host:

```bash
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yaml \
  -f .devcontainer/backing.compose.yaml -f .devcontainer/compose.yaml stop
```

Dependencies remain in the checkout when the container is removed. Do not run
`down -v` unless you intend to delete this project's database, storage and
pnpm cache volumes.

## Native prerequisites

- Node.js 24 and pnpm 11.8.0
- Docker for the backing services
- Gateway credentials, or a configured custom completion endpoint
- Vercel CLI and Slack credentials only for workflows that need them

## Native setup

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest switch
pnpm dlx vercel@latest link --yes
pnpm dlx vercel@latest env pull .env --environment=development
```

If your team account requires an explicit Vercel scope, add `--scope <team-slug>` to the `link` and `env pull` commands.

## Run the native web app

```bash
pnpm dev
```

This starts the example app on `http://localhost:3000` by default. It also rebuilds and watches the workspace packages that the example app consumes, so dashboard and runtime package edits are reflected without manually rebuilding first.

Before the app starts, `pnpm dev` runs `docker compose up -d --wait`. This starts Postgres, Redis and S3 from `compose.yaml` and waits until they are healthy. Docker must be running. Services that already run are left as they are. Then `pnpm dev` runs `junior upgrade` to apply missing database migrations to `DATABASE_URL`. Migrations that already ran are skipped. If either step fails, `pnpm dev` stops.

`pnpm dev` delivers background work through BullMQ on the Redis in `compose.yaml` (`redis://localhost:6382`), which `pnpm dev` starts. Local work then needs no Vercel Queues access. To use Vercel Queues, set `JUNIOR_QUEUE_PROVIDER=vercel` and run `pnpm dev:env` for the Vercel token. To use another Redis, set `JUNIOR_QUEUE_REDIS_URL`.

With BullMQ, `pnpm dev` starts one queue worker process next to Nitro. Nitro accepts requests and sends jobs. The worker runs them. A new Junior build restarts both processes. A change to `apps/example/server.ts`, `plugins.ts`, `dashboard.ts` or `apps/example/app/` restarts only the worker. The worker and Nitro must share state, so `pnpm dev` keeps state in that Redis unless you set `JUNIOR_STATE_ADAPTER`. `JUNIOR_STATE_ADAPTER=memory` does not work with BullMQ. Each queue topic runs up to 4 jobs at the same time. Set `JUNIOR_QUEUE_WORKER_CONCURRENCY` to change that number.

To also open the Sentry Local UI in your browser, set `OPEN_SPOTLIGHT_WEB=1`:

```bash
OPEN_SPOTLIGHT_WEB=1 pnpm dev
```

For dashboard visual QA without generating real Slack traffic, replace conversation API responses with sample fixtures:

```bash
JUNIOR_DASHBOARD_MOCK_CONVERSATIONS=true pnpm dev
```

The fixtures are read-only dashboard data; mock mode does not query or merge real conversation records.

## Run sandboxes in local Docker

By default, Junior runs agent sandboxes in Vercel Sandbox. To run them in a local Docker daemon instead, set the provider in `.env`:

```bash
JUNIOR_SANDBOX_PROVIDER=docker
```

The Docker provider needs Docker Engine 25 or later (API 1.44) on a unix socket. It uses `/var/run/docker.sock`, or the unix socket in `DOCKER_HOST`. On macOS, the daemon runs in a VM, so each sandbox sends its web traffic through an egress relay container. Each sandbox is a privileged container, so do not run untrusted workloads with it.

The first sandbox builds the `junior-sandbox-runtime` image. This takes a few minutes. Later sandboxes start in seconds. `pnpm dev` and `pnpm cli -- chat ...` both use the provider. Each process runs its own egress proxy, and the process that last acquired a sandbox carries its web traffic.

Docker sandboxes have a small toolset: `gh`, `jq`, and `ripgrep`. They do not include other plugin CLIs, browsers, or Docker. The agent installs other tools with `sudo` when it needs them. Vercel sandboxes still include every tool that the plugins declare.

Optional settings:

- `JUNIOR_DOCKER_SANDBOX_DIR` sets the directory of the local egress CA. The default is `~/.cache/junior/docker-sandbox`.
- `JUNIOR_DOCKER_SANDBOX_EXTRA_CA_CERTS` names a PEM file that each sandbox also trusts. Set it when your machine is behind a TLS proxy.

To remove all Docker sandboxes and snapshots:

```bash
docker rm -f -v $(docker ps -aq --filter label=dev.junior.sandbox)
docker network prune -f --filter label=dev.junior.sandbox
docker image prune -a -f --filter label=dev.junior.sandbox=snapshot
```

This provider is for local development and QA only. Do not run untrusted workloads with it.

## Work in isolated branches

Worktrees are development-only contributor tooling. Use them when you want to keep your main checkout stable while reviewing a PR, testing a fix, or running a coding agent such as Codex on a task. The repo helper creates the Git worktree, copies local development files, and installs dependencies in the new checkout.

```bash
pnpm worktree new codex/fix-slack-retry --agent "codex"
```

Use `--open "code ."` instead of `--agent "codex"` when you want to open the worktree in an editor first:

```bash
pnpm worktree new review/pr-123 --open "code ."
```

New worktrees are created under `../junior-worktrees` by default. They start from `origin/main` when available, then copy matching local files from the primary checkout using `scripts/worktree.include`, including env files and Vercel project links.

Codex app worktrees are separate from this repo helper. When you choose **Worktree** in Codex, Codex creates managed, disposable worktrees under `$CODEX_HOME/worktrees`; do not point `JUNIOR_WORKTREE_DIR` there or rely on that directory for long-lived branch work. Use the repo helper when you want a named local worktree you can keep, inspect, and remove yourself.

Make sure Codex trusts the main checkout before starting agent work. In Codex, trust the project from the app prompt, or add the checkout to `~/.codex/config.toml`:

```toml
[projects."/absolute/path/to/junior"]
trust_level = "trusted"
```

If you create a long-lived helper worktree and open it as its own Codex project, trust that worktree path too. Shared repo instructions stay in `AGENTS.md`; personal Codex defaults such as model, sandbox, approvals, and MCP servers stay in `~/.codex/config.toml` or your personal `.codex/config.toml` layers, not in these dev-only helper files.

Run commands inside a worktree without changing directories:

```bash
pnpm worktree exec codex/fix-slack-retry -- pnpm typecheck
```

List active worktrees before switching contexts. The checkout running the helper is marked with `*`:

```bash
pnpm worktree list
```

After the branch is merged or no longer needed, remove the clean worktree:

```bash
pnpm worktree remove codex/fix-slack-retry
```

Set `JUNIOR_WORKTREE_DIR` to change the parent directory, set `JUNIOR_WORKTREE_BASE` to change the default base ref, set `JUNIOR_WORKTREE_SOURCE` to change the checkout copied into new worktrees and `setup` runs, or pass `--path`, `--from`, `--source`, or `--no-install` for one-off overrides. Relative `JUNIOR_WORKTREE_DIR` values resolve from the primary checkout root. `--from` and `JUNIOR_WORKTREE_BASE` only apply when creating a new branch; existing branches open at their current tip.

## Common checks

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm skills:check
pnpm docs:check
```

## Slack tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Set Event Subscriptions and Interactivity URL to:

```text
https://<tunnel-host>/api/webhooks/slack
```

## Next step

Run focused checks from [Testing](/contribute/testing/), then verify behavior in [Verify & Troubleshoot](/start-here/verify-and-troubleshoot/).
