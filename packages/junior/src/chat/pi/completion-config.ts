import { z } from "zod";

const modelMetadataSchema = z
  .strictObject({
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    input: z
      .array(z.enum(["text", "image"]))
      .min(1)
      .refine(
        (input) =>
          input.includes("text") && new Set(input).size === input.length,
      )
      .readonly(),
    reasoning: z.boolean(),
    cost: z
      .strictObject({
        input: z.number().finite().nonnegative(),
        output: z.number().finite().nonnegative(),
        cacheRead: z.number().finite().nonnegative(),
        cacheWrite: z.number().finite().nonnegative(),
      })
      .readonly(),
  })
  .refine((model) => model.maxTokens <= model.contextWindow)
  .readonly();

const completionEndpointSchema = z
  .strictObject({
    baseURL: z.string(),
    apiKey: z.string(),
    api: z.enum(["chat-completions", "responses"]),
    models: z
      .record(
        z.string().refine((id) => id.trim().length > 0),
        modelMetadataSchema,
      )
      .refine((models) => Object.keys(models).length > 0)
      .readonly(),
  })
  .readonly();

export type CompletionEndpointConfig = z.output<
  typeof completionEndpointSchema
>;

/** Parse deployment-only completion routing without consulting app or Gateway state. */
export function readCompletionEndpointConfig(
  env: NodeJS.ProcessEnv,
): CompletionEndpointConfig | undefined {
  const baseURL = env.AI_COMPLETION_BASE_URL?.trim() || undefined;
  const apiKey = env.AI_COMPLETION_API_KEY?.trim() || undefined;
  const api = env.AI_COMPLETION_API?.trim() || undefined;
  const models = env.AI_COMPLETION_MODELS?.trim() || undefined;
  if (Boolean(baseURL) !== Boolean(apiKey)) {
    throw new Error(
      "AI_COMPLETION_BASE_URL and AI_COMPLETION_API_KEY must be set together",
    );
  }
  if (!baseURL || !apiKey) {
    if (api || models) {
      throw new Error(
        "AI_COMPLETION_API and AI_COMPLETION_MODELS require AI_COMPLETION_BASE_URL and AI_COMPLETION_API_KEY",
      );
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(
      "AI_COMPLETION_BASE_URL must be an HTTP or HTTPS API root without credentials, query, or fragment",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    baseURL.includes("?") ||
    baseURL.includes("#")
  ) {
    throw new Error(
      "AI_COMPLETION_BASE_URL must be an HTTP or HTTPS API root without credentials, query, or fragment",
    );
  }
  if (api && api !== "chat-completions" && api !== "responses") {
    throw new Error("AI_COMPLETION_API must be chat-completions or responses");
  }
  let parsedModels: unknown;
  try {
    parsedModels = models ? JSON.parse(models) : undefined;
  } catch {
    throw new Error(
      "AI_COMPLETION_MODELS must be a nonempty JSON map of valid model metadata",
    );
  }
  const result = completionEndpointSchema.safeParse({
    baseURL,
    apiKey,
    api: api ?? "chat-completions",
    models: parsedModels,
  });
  if (!result.success) {
    // Zod issues can contain operator-supplied values. Report only the safe env name.
    throw new Error(
      "AI_COMPLETION_MODELS must be a nonempty JSON map of valid model metadata",
    );
  }
  return result.data;
}

/** Completion routing is immutable for this process; restart to change it. */
export const completionEndpointConfig = readCompletionEndpointConfig(
  process.env,
);
