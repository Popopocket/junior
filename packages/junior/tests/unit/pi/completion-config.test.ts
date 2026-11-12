import { describe, expect, it } from "vitest";
import { readCompletionEndpointConfig } from "@/chat/pi/completion-config";

const metadata = {
  contextWindow: 500_000,
  maxTokens: 65_536,
  input: ["text", "image"],
  reasoning: true,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
};
const env = {
  AI_COMPLETION_BASE_URL: "http://127.0.0.1:8317/prefix/v1",
  AI_COMPLETION_API_KEY: "fixture-custom-token",
  AI_COMPLETION_MODELS: JSON.stringify({ "gpt-6.1-sol": metadata }),
};

describe("readCompletionEndpointConfig", () => {
  it("keeps absent or blank configuration on Gateway", () => {
    expect(readCompletionEndpointConfig({})).toBeUndefined();
    expect(
      readCompletionEndpointConfig({ AI_COMPLETION_BASE_URL: "  " }),
    ).toBeUndefined();
  });

  it.each([
    { AI_COMPLETION_BASE_URL: env.AI_COMPLETION_BASE_URL },
    { AI_COMPLETION_API_KEY: env.AI_COMPLETION_API_KEY },
  ])("requires endpoint and its own credential together", (input) => {
    expect(() => readCompletionEndpointConfig(input)).toThrow(
      "AI_COMPLETION_BASE_URL and AI_COMPLETION_API_KEY must be set together",
    );
  });

  it.each([
    { AI_COMPLETION_API: "responses" },
    { AI_COMPLETION_MODELS: env.AI_COMPLETION_MODELS },
  ])("rejects orphan protocol or metadata", (input) => {
    expect(() => readCompletionEndpointConfig(input)).toThrow(
      "require AI_COMPLETION_BASE_URL and AI_COMPLETION_API_KEY",
    );
  });

  it.each([undefined, "chat-completions", "responses"])(
    "selects explicit protocol %s without probing",
    (api) => {
      const config = readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_API: api,
      });
      expect(config).toEqual({
        api: api ?? "chat-completions",
        apiKey: env.AI_COMPLETION_API_KEY,
        baseURL: env.AI_COMPLETION_BASE_URL,
        models: { "gpt-6.1-sol": metadata },
      });
    },
  );

  it("trims environment values without changing model IDs or URL path", () => {
    const config = readCompletionEndpointConfig({
      ...env,
      AI_COMPLETION_BASE_URL: ` ${env.AI_COMPLETION_BASE_URL} `,
      AI_COMPLETION_API_KEY: ` ${env.AI_COMPLETION_API_KEY} `,
      AI_COMPLETION_API: " responses ",
    });
    expect(config?.baseURL).toBe(env.AI_COMPLETION_BASE_URL);
    expect(config?.apiKey).toBe(env.AI_COMPLETION_API_KEY);
    expect(config?.models["gpt-6.1-sol"]).toEqual(metadata);
  });

  it.each([
    "not a URL",
    "ftp://example.test/v1",
    "https://user:secret@example.test/v1",
    "https://example.test/v1?secret=value",
    "https://example.test/v1#secret",
    "https://example.test/v1?",
    "https://example.test/v1#",
  ])("rejects unsafe endpoint without echoing supplied URL: %s", (url) => {
    let caught: unknown;
    try {
      readCompletionEndpointConfig({ ...env, AI_COMPLETION_BASE_URL: url });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("AI_COMPLETION_BASE_URL");
    expect(String(caught)).not.toContain(url);
    expect(String(caught)).not.toContain(env.AI_COMPLETION_API_KEY);
  });

  it("accepts HTTPS and rejects unknown protocols", () => {
    expect(
      readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_BASE_URL: "https://example.test/v1",
      })?.baseURL,
    ).toBe("https://example.test/v1");
    expect(() =>
      readCompletionEndpointConfig({ ...env, AI_COMPLETION_API: "auto" }),
    ).toThrow("AI_COMPLETION_API");
  });

  it.each([undefined, "not json", "[]", "{}", "null"])(
    "rejects missing or invalid model JSON: %s",
    (models) => {
      expect(() =>
        readCompletionEndpointConfig({ ...env, AI_COMPLETION_MODELS: models }),
      ).toThrow("AI_COMPLETION_MODELS");
    },
  );

  it.each([
    { contextWindow: 0 },
    { contextWindow: 1.5 },
    { maxTokens: -1 },
    { maxTokens: 500_001 },
    { maxTokens: 1.5 },
    { reasoning: "true" },
    { input: [] },
    { input: ["image"] },
    { input: ["text", "text"] },
    { input: ["text", "audio"] },
    { extra: true },
    { cost: { ...metadata.cost, output: -1 } },
    { cost: { ...metadata.cost, output: "1" } },
    { cost: { input: 1, output: 2, cacheRead: 0 } },
    { cost: { ...metadata.cost, extra: 0 } },
  ])("rejects invalid metadata %j", (override) => {
    expect(() =>
      readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_MODELS: JSON.stringify({
          model: { ...metadata, ...override },
        }),
      }),
    ).toThrow("AI_COMPLETION_MODELS");
  });

  it("rejects infinite costs and empty IDs, but permits explicit zero prices", () => {
    expect(() =>
      readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_MODELS:
          '{"model":{"contextWindow":10,"maxTokens":1,"input":["text"],"reasoning":false,"cost":{"input":1e400,"output":0,"cacheRead":0,"cacheWrite":0}}}',
      }),
    ).toThrow("AI_COMPLETION_MODELS");
    expect(() =>
      readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_MODELS: JSON.stringify({ " ": metadata }),
      }),
    ).toThrow("AI_COMPLETION_MODELS");
    expect(
      readCompletionEndpointConfig({
        ...env,
        AI_COMPLETION_MODELS: JSON.stringify({
          model: {
            ...metadata,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        }),
      })?.models.model!.cost.input,
    ).toBe(0);
  });
});
