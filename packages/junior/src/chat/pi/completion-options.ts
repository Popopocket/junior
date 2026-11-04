import {
  clampMaxTokensToContext,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@/chat/pi/sdk";

/** Bound custom output without bypassing Pi's context-aware limit. */
export function completionStreamOptions(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
): SimpleStreamOptions {
  if (model.provider !== "openai-compatible") return options;
  const maxTokens = Math.min(
    options.maxTokens ?? model.maxTokens,
    model.maxTokens,
  );
  const samplingParams = options.samplingParams
    ? { ...options.samplingParams }
    : undefined;
  if (samplingParams) {
    // Pi applies sampling fields last. Token aliases must not bypass its context cap.
    delete samplingParams.max_tokens;
    delete samplingParams.max_completion_tokens;
    delete samplingParams.max_output_tokens;
  }
  return {
    ...options,
    maxTokens,
    ...(samplingParams ? { samplingParams } : undefined),
    ...(model.api === "openai-responses"
      ? {
          onPayload: async (payload, payloadModel) => {
            const replacement = await options.onPayload?.(
              payload,
              payloadModel,
            );
            const params = replacement ?? payload;
            // Pi raises context-clamped Responses output below 16 back to 16.
            if (
              params &&
              typeof params === "object" &&
              "max_output_tokens" in params &&
              params.max_output_tokens === 16
            ) {
              const cap = clampMaxTokensToContext(
                model,
                context,
                Math.min(maxTokens, 16),
              );
              if (cap < 16) return { ...params, max_output_tokens: cap };
            }
            return replacement;
          },
        }
      : undefined),
  };
}
