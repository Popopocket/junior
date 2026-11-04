/**
 * Local Pi SDK boundary. All Pi package imports used by chat/pi/client.ts
 * are re-exported here so tests can mock a single Junior-owned path instead
 * of Pi's internal subpath layout, which changes across SDK versions.
 */
export {
  calculateCost,
  completeSimple,
  getEnvApiKey,
  getModels,
  isRetryableAssistantError,
  registerApiProvider,
  type Api,
  type Context,
  type SimpleStreamOptions,
  type CacheRetention,
  type Message,
  type Model,
  type ThinkingLevel,
} from "@earendil-works/pi-ai/compat";

export {
  stream as streamAnthropic,
  streamSimple as streamSimpleAnthropic,
} from "@earendil-works/pi-ai/api/anthropic-messages";

export {
  stream as streamOpenAICompletions,
  streamSimple as streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai/api/openai-completions";

export {
  stream as streamOpenAIResponses,
  streamSimple as streamSimpleOpenAIResponses,
} from "@earendil-works/pi-ai/api/openai-responses";

export { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
