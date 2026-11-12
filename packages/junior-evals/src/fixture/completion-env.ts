import { vi } from "vitest";
import { mswServer } from "@junior-tests/msw/server";
import type { CompletionProtocol } from "./completion-http";

/** Reload immutable runtime configuration while retaining the active setupFiles interceptor. */
export function initializeCompletionTestEnvironment(
  protocol: CompletionProtocol,
) {
  vi.resetModules();
  return {
    restoreEnvironment: configureCompletionTestEnvironment(protocol),
    server: mswServer,
  };
}

/** Install one immutable fake endpoint before importing Junior; restore at file teardown. */
function configureCompletionTestEnvironment(
  protocol: CompletionProtocol,
): () => void {
  const values: Record<string, string | undefined> = {
    JUNIOR_ATTACHMENT_STORAGE_PROVIDER: "memory",
    AI_COMPLETION_BASE_URL: "https://completion.invalid/tenant/private/v1/",
    AI_COMPLETION_API_KEY: "fake-private-completion-token",
    AI_COMPLETION_API: protocol,
    AI_MODEL: "openai/gpt-5.4",
    AI_MODEL_CONTEXT_WINDOW_TOKENS: "500000",
    AI_HANDOFF_MODEL: "tenant/solver",
    AI_MODEL_PROFILES: JSON.stringify({
      standard: { modelId: "openai/gpt-5.4", reasoningLevel: "none" },
      handoff: { modelId: "tenant/solver", reasoningLevel: "none" },
    }),
    AI_FAST_MODEL: "openai/gpt-5.4",
    AI_GUARDIAN_MODEL: "openai/gpt-5.4",
    AI_VISION_MODEL: "tenant/vision",
    AI_WEB_SEARCH_MODEL: "openai/gpt-5.4",
    AI_REASONING_LEVEL: "none",
    AI_GATEWAY_API_KEY: "fake-retained-gateway-token",
    // Missing OIDC would refresh from local CLI credentials; malformed fake fails before refresh.
    VERCEL_OIDC_TOKEN: "fake-invalid-oidc-token",
    VERCEL: undefined,
    VERCEL_ENV: undefined,
    AI_COMPLETION_MODELS: JSON.stringify({
      "openai/gpt-5.4": {
        contextWindow: 200_000,
        maxTokens: 8192,
        input: ["text"],
        reasoning: false,
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "tenant/solver": {
        contextWindow: 200_000,
        maxTokens: 8192,
        input: ["text"],
        reasoning: true,
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "tenant/vision": {
        contextWindow: 200_000,
        maxTokens: 8192,
        input: ["text", "image"],
        reasoning: false,
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "tenant/context-budget": {
        contextWindow: 500_000,
        maxTokens: 65_536,
        input: ["text"],
        reasoning: false,
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
    }),
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
