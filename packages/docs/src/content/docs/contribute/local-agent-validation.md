---
title: Local Agent Validation
description: Use junior chat to validate non-Slack behavior from a terminal.
type: tutorial
summary: Verify agent behavior locally before using Slack-specific test paths.
prerequisites:
  - /contribute/development/
  - /cli/chat/
related:
  - /contribute/testing/
  - /cli/check/
  - /start-here/verify-and-troubleshoot/
---

Use this runbook for changes to the product, runtime, prompts, skills, plugins,
tools, sandbox, or credentials. Do not use it first for Slack input, message
format, retries, or OAuth screens. For all other changes, test the local agent
first.

In this monorepo, `pnpm cli -- ...` runs Junior from `apps/example`. Use this
app for local tests. It loads the example SOUL, WORLD, local skills, plugin
skills, and normal development environment. It does not require Slack.

## Select the completion endpoint

The [Docker devcontainer](/contribute/development/#docker-devcontainer) provides
Node, dependencies, backing services and local Docker sandboxes. It does not
provide model credentials. Use the repository's gitignored `.env.local` for
private values. Do not print that file or commit it.

For Gateway-only use, set `AI_GATEWAY_API_KEY` and leave `AI_COMPLETION_*` unset.
To use an existing local proxy, add this non-secret configuration:

```dotenv title=".env.local"
AI_COMPLETION_BASE_URL=http://127.0.0.1:8317/v1
AI_COMPLETION_API=chat-completions
AI_COMPLETION_MODELS='{"gpt-6.1-sol":{"contextWindow":500000,"maxTokens":65536,"input":["text"],"reasoning":true,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}}'
AI_MODEL=gpt-6.1-sol
AI_HANDOFF_MODEL=gpt-6.1-sol
AI_FAST_MODEL=gpt-6.1-sol
AI_GUARDIAN_MODEL=gpt-6.1-sol
AI_MODEL_CONTEXT_WINDOW_TOKENS=500000
AI_REASONING_LEVEL=low
AI_MODEL_PROFILES='{"standard":{"modelId":"gpt-6.1-sol","reasoningLevel":"low"},"handoff":{"modelId":"gpt-6.1-sol","reasoningLevel":"low"}}'
AI_VISION_MODEL=
```

Add `AI_COMPLETION_API_KEY` privately to the same file. It must contain the key
for this endpoint, not a Gateway key. The URL and key must be set together, with
model metadata. This example assumes the proxy serves the exact wire model ID
`gpt-6.1-sol`. Change the ID in all places if your proxy uses another ID.
The zero cost values are test accounting estimates, not provider prices.
Replace them with operator-declared USD per million tokens for real accounting.
No Gateway tariff is applied to custom models.

Set `AI_COMPLETION_API=responses` only if your endpoint supports Responses.
The runtime does not retry through another protocol or provider. Settings are
read once for each process; restart the CLI or dev server after an edit.
Model metadata must be strict JSON, with all shown fields. Add each selected
completion model to the map. The text-only input above does not claim vision
support.

The CLI retains `AI_MODEL`, `AI_HANDOFF_MODEL`, `AI_FAST_MODEL`,
`AI_GUARDIAN_MODEL` and `AI_MODEL_PROFILES` for model selection.
Metadata declares available models; it does not select a role.
The example sets the host context limit to 500000 so it does not reduce the
model's declared window. It sets both profile reasoning levels to `low` for
the first smoke check. Profile reasoning overrides `AI_REASONING_LEVEL`;
the built-in standard and handoff profiles use `high`.
In app code, model roles belong at the top level of `createApp`:

```typescript title="server.ts"
const app = await createApp({
  profiles: {
    standard: { modelId: "gpt-6.1-sol", reasoningLevel: "low" },
    handoff: { modelId: "gpt-6.1-sol", reasoningLevel: "low" },
  },
  defaultProfile: "standard",
  fastModelId: "gpt-6.1-sol",
  guardianModelId: "gpt-6.1-sol",
  limits: { contextWindowTokens: 500000 },
  plugins,
});
```

Do not put these fields inside a `models` object. Chat vision completions use
the selected completion endpoint. The text-only example disables vision with
an empty `AI_VISION_MODEL`. Enable vision only after you verify endpoint support
and declare image input for its model. Embeddings, web search, image generation
and image editing still use Gateway and require their own configuration.
Custom completions do not route those specialized operations through the proxy.

Before the first local turn, install, build and apply migrations:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- upgrade
```

Use CLI chat for this check. Start `pnpm dev` only when a test needs the web app,
such as an OAuth callback. A normal completion check does not need a tunnel or
live Slack traffic.

## First Check

Confirm the app is configured:

```bash
pnpm exec junior check
```

When you are working inside this monorepo, use the source CLI wrapper instead:

```bash
pnpm cli -- check
```

Run one local turn:

```bash
pnpm exec junior chat -p "Describe the behavior I just changed in one sentence."
```

From this monorepo, run the same check through the source CLI:

```bash
pnpm cli -- chat -p "Describe the behavior I just changed in one sentence."
```

The command should print a Junior response and exit with status `0`. If it
reports missing model or provider credentials, refresh or add the required
environment variables and rerun the same prompt.

`-p` uses a new local conversation for each command. Use interactive mode to
test context across turns.

## Example App Checks

Use the example app skills when you need to prove local skill and plugin
discovery, not just a plain model response:

```bash
pnpm cli -- chat -p '$example-local Confirm the example app local skill is available.'
```

```bash
pnpm cli -- chat -p '$example-bundle-help Explain where this plugin-bundled skill is discovered from and whether it supports jr-rpc issue-credential.'
```

The first command should use the app-local `example-local` skill. The second
should report that the skill is discovered from
`app/plugins/example-bundle/skills` and that `example-bundle` is bundle-only
without credential issuance support.

## Conversation Check

Use interactive mode when the change depends on context across turns:

```bash
pnpm exec junior chat
```

From this monorepo:

```bash
pnpm cli -- chat
```

Send two prompts that exercise the changed behavior, then type `/exit`. The
second response should use context from the first response without needing a
Slack channel or thread.

## What This Proves

Local validation proves that the shared agent path can run without Slack:

- the prompt reaches the agent runtime
- the local destination is not Slack-shaped
- tools and plugins run with the configured local environment
- visible conversation context survives within one interactive local process
- terminal delivery succeeds for text replies

Keep the usual focused tests for deterministic contracts. Use Slack-specific
tests only when the change is about Slack event routing, Slack outbound payloads,
Slack markdown, Slack files, Slack retry behavior, or Slack authorization UI.
Local chat can validate user-bound OAuth and credential issuance: it prints the
private authorization URL, waits for the callback, and resumes the same turn as
the `local-cli` user.

Keep `pnpm dev` running for OAuth checks. The configured public callback reaches
the dev server first, which verifies the signed local state and redirects the
browser to the CLI's loopback listener.

## Failure Checks

If local validation fails, use the first matching symptom:

| Symptom                         | First check                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| Missing model credentials       | Check the selected endpoint's key in `.env.local`; restart the process.     |
| Missing provider credentials    | Configure the plugin/provider env required by the changed path.             |
| OAuth callback cannot connect   | Keep `pnpm dev` and its configured tunnel running while the CLI waits.      |
| Context resets between commands | Expected; use one interactive `junior chat` process for context.            |
| File-send UX needs validation   | Local validation cannot verify it; the local adapter has no file-send tool. |
| Slack-specific behavior changed | Use the Slack skill and integration tests instead.                          |

## Next Step

After local behavior works, run the focused commands from
[Testing](/contribute/testing/) for the files you changed.
