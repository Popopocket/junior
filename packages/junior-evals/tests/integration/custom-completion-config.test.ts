import { afterAll, describe, expect, it, vi } from "vitest";

const { restoreEnvironment } = await vi.hoisted(async () => {
  // Immutable config must load after the shared environment initialization.
  const { initializeCompletionTestEnvironment } =
    await import("@junior-evals/fixture/completion-env");
  return initializeCompletionTestEnvironment("chat-completions");
});

import { createApp, defineJuniorPlugins } from "@/app";
import { botConfig } from "@/chat/config";

afterAll(restoreEnvironment);

const defaults = { ...botConfig };

describe("custom completion model configuration", () => {
  it("accepts selected custom metadata and retains specialized Gateway selection", async () => {
    try {
      await createApp({
        defaultProfile: "custom",
        profiles: { custom: "tenant/solver" },
        fastModelId: "tenant/solver",
        guardianModelId: "tenant/solver",
        visionModelId: "tenant/vision",
        webSearchModelId: "openai/gpt-6-luna",
        embeddingModelId: "openai/text-embedding-3-small",
        plugins: defineJuniorPlugins([]),
      });
      expect(botConfig).toMatchObject({
        profiles: { custom: { modelId: "tenant/solver" } },
        fastModelId: "tenant/solver",
        guardianModelId: "tenant/solver",
        visionModelId: "tenant/vision",
        webSearchModelId: "openai/gpt-6-luna",
      });
    } finally {
      await createApp({ plugins: defineJuniorPlugins([]) });
    }
  });

  it("rejects unknown custom IDs without catalog fallback and rolls back partial configuration", async () => {
    try {
      await expect(
        createApp({
          fastModelId: "tenant/solver",
          guardianModelId: "openai/gpt-6-luna",
          plugins: defineJuniorPlugins([]),
        }),
      ).rejects.toThrow("Unknown completion model id: openai/gpt-6-luna");
      expect(botConfig).toEqual(defaults);
      await expect(
        createApp({
          webSearchModelId: "tenant/solver",
          plugins: defineJuniorPlugins([]),
        }),
      ).rejects.toThrow("Unknown AI Gateway model id: tenant/solver");
      expect(botConfig).toEqual(defaults);
    } finally {
      await createApp({ plugins: defineJuniorPlugins([]) });
    }
  });

  it("resets app overrides without requiring metadata for unused built-in defaults", async () => {
    try {
      await createApp({
        defaultProfile: "custom",
        profiles: { custom: "tenant/solver" },
        fastModelId: "tenant/solver",
        plugins: defineJuniorPlugins([]),
      });
      await createApp({ plugins: defineJuniorPlugins([]) });
      expect(botConfig).toEqual(defaults);
      expect(botConfig.profiles.standard?.modelId).toBe("openai/gpt-5.4");
    } finally {
      await createApp({ plugins: defineJuniorPlugins([]) });
    }
  });
});
