import { expect } from "vitest";
import { http, HttpResponse } from "msw";
import type { SetupServer } from "msw/node";

export type CompletionProtocol = "chat-completions" | "responses";

export interface CompletionHttpRequest {
  url: string;
  authorization: string | null;
  modelHeader: string | null;
  body: Record<string, unknown>;
}

export interface CompletionHttpFixture {
  requests: CompletionHttpRequest[];
  enqueueText(text: string, inputTokens?: number): void;
  enqueueAgentText(text: string, inputTokens?: number): void;
  enqueueTool(name: string, argumentParts: string[]): void;
  enqueueObject(object: unknown): void;
  enqueueMalformedObject(): void;
  enqueueGatewaySearch(): void;
  enqueueUntilAborted(): Promise<void>;
  rejectAll(status: number): void;
  assertConsumed(): void;
  assertCustomRequests(model?: string): void;
  assertGatewaySearch(model: string): void;
}

const BASE_URL = "https://completion.invalid/tenant/private/v1";
const CUSTOM_TOKEN = "fake-private-completion-token";
const GATEWAY_TOKEN = "fake-retained-gateway-token";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v4/ai/language-model";
const TOOL_CALL_ID = "call_clock";

type Step = {
  gateway?: boolean;
  streaming?: boolean;
  tools?: boolean;
  respond(
    request: Request,
    body: Record<string, unknown>,
  ): Response | Promise<Response>;
};

function sse(
  events: Array<Record<string, unknown>>,
  protocol: CompletionProtocol,
): Response {
  const encoder = new TextEncoder();
  return new HttpResponse(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `${protocol === "responses" ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
            ),
          );
        }
        if (protocol === "chat-completions")
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function chatChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  inputTokens = 12,
) {
  return {
    id: "chatcmpl_fake",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason
      ? {
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: 4,
            total_tokens: inputTokens + 4,
          },
        }
      : {}),
  };
}

function responseEnvelope(
  output: unknown[],
  model: unknown = "fake-model",
  inputTokens = 12,
) {
  return {
    id: "resp_fake",
    object: "response",
    created_at: 1,
    status: "completed",
    model,
    error: null,
    incomplete_details: null,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 4,
      total_tokens: inputTokens + 4,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function textItem(text: string) {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function textResponse(
  protocol: CompletionProtocol,
  text: string,
  inputTokens = 12,
): Response {
  if (protocol === "chat-completions") {
    return sse(
      [
        chatChunk({ role: "assistant", content: "" }),
        chatChunk({ content: text }),
        chatChunk({}, "stop", inputTokens),
      ],
      protocol,
    );
  }
  const item = textItem(text);
  return sse(
    [
      {
        type: "response.created",
        response: { id: "resp_fake", status: "in_progress" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, content: [] },
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        part: { type: "output_text", text: "", annotations: [] },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        delta: text,
      },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: responseEnvelope([item], "fake-model", inputTokens),
      },
    ],
    protocol,
  );
}

function toolResponse(
  protocol: CompletionProtocol,
  name: string,
  argumentParts: string[],
): Response {
  if (protocol === "chat-completions") {
    return sse(
      [
        chatChunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: TOOL_CALL_ID,
              type: "function",
              function: { name, arguments: "" },
            },
          ],
        }),
        ...argumentParts.map((argumentsPart) =>
          chatChunk({
            tool_calls: [{ index: 0, function: { arguments: argumentsPart } }],
          }),
        ),
        chatChunk({}, "tool_calls"),
      ],
      protocol,
    );
  }
  const item = {
    type: "function_call",
    id: "fc_fake",
    call_id: TOOL_CALL_ID,
    name,
    arguments: argumentParts.join(""),
    status: "completed",
  };
  return sse(
    [
      {
        type: "response.created",
        response: { id: "resp_fake", status: "in_progress" },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, arguments: "", status: "in_progress" },
      },
      ...argumentParts.map((delta) => ({
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: item.id,
        delta,
      })),
      {
        type: "response.function_call_arguments.done",
        output_index: 0,
        item_id: item.id,
        arguments: item.arguments,
      },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: responseEnvelope([item]) },
    ],
    protocol,
  );
}

function objectResponse(
  protocol: CompletionProtocol,
  text: string,
  model: unknown,
): Response {
  if (protocol === "responses") {
    return HttpResponse.json(responseEnvelope([textItem(text)], model));
  }
  return HttpResponse.json({
    id: "chatcmpl_object",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  });
}

/** Intercept every HTTP request in one scenario, including globally allowlisted hosts. */
export function createCompletionHttpFixture(
  protocol: CompletionProtocol,
  server: SetupServer,
): CompletionHttpFixture {
  const requests: CompletionHttpRequest[] = [];
  const unexpected: string[] = [];
  const steps: Step[] = [];
  let rejectionStatus: number | undefined;
  const customUrl = `${BASE_URL}/${protocol === "responses" ? "responses" : "chat/completions"}`;
  // A single terminal handler intentionally shadows global Slack/live-host handlers.
  // Returning an error prevents network access; recording also catches swallowed errors.
  server.use(
    http.all("*", async ({ request }) => {
      if (
        request.method !== "POST" ||
        (request.url !== customUrl &&
          !(request.url === GATEWAY_URL && steps.some((step) => step.gateway)))
      ) {
        unexpected.push(`${request.method} ${request.url}`);
        return HttpResponse.json(
          { error: { message: "Unscripted HTTP request blocked" } },
          { status: 599 },
        );
      }
      const body = (await request.json()) as Record<string, unknown>;
      requests.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
        modelHeader: request.headers.get("ai-language-model-id"),
        body,
      });
      if (rejectionStatus !== undefined) {
        return HttpResponse.json(
          {
            error: {
              message: `Injected private HTTP ${rejectionStatus}`,
              type: "test_error",
              code: "test_error",
            },
          },
          { status: rejectionStatus, headers: { "retry-after": "0" } },
        );
      }
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      // Title work may race routing. Match actual HTTP shape, never a global call index.
      const index = steps.findIndex(
        (step) =>
          request.url === (step.gateway ? GATEWAY_URL : customUrl) &&
          (step.streaming === undefined ||
            step.streaming === (body.stream === true)) &&
          (step.tools === undefined || step.tools === hasTools),
      );
      if (index === -1) {
        unexpected.push(
          `${request.method} ${request.url} stream=${body.stream === true} tools=${hasTools}`,
        );
        return HttpResponse.json(
          { error: { message: "Unscripted LLM request shape blocked" } },
          { status: 599 },
        );
      }
      const [step] = steps.splice(index, 1);
      return step!.respond(request, body);
    }),
  );

  return {
    requests,
    enqueueText(text, inputTokens) {
      steps.push({
        streaming: true,
        tools: false,
        respond: () => textResponse(protocol, text, inputTokens),
      });
    },
    enqueueAgentText(text, inputTokens) {
      steps.push({
        streaming: true,
        tools: true,
        respond: () => textResponse(protocol, text, inputTokens),
      });
    },
    enqueueTool(name, argumentParts) {
      steps.push({
        streaming: true,
        tools: true,
        respond: () => toolResponse(protocol, name, argumentParts),
      });
    },
    enqueueObject(object) {
      steps.push({
        streaming: false,
        tools: false,
        respond: (_request, body) =>
          objectResponse(protocol, JSON.stringify(object), body.model),
      });
    },
    enqueueMalformedObject() {
      steps.push({
        streaming: false,
        tools: false,
        respond: (_request, body) =>
          objectResponse(protocol, "{invalid-json", body.model),
      });
    },
    enqueueGatewaySearch() {
      steps.push({
        gateway: true,
        respond: () =>
          HttpResponse.json({
            content: [
              {
                type: "tool-call",
                toolCallId: "search_1",
                toolName: "parallelSearch",
                input: { query: "Junior release" },
                providerExecuted: true,
              },
              {
                type: "tool-result",
                toolCallId: "search_1",
                toolName: "parallelSearch",
                result: {
                  results: [
                    {
                      title: "Release",
                      url: "https://example.invalid/release",
                      excerpt: "Release notes",
                    },
                  ],
                },
                providerExecuted: true,
              },
            ],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 12,
                noCache: 12,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 4, text: 4, reasoning: 0 },
            },
            warnings: [],
          }),
      });
    },
    enqueueUntilAborted() {
      // This package targets ES2022, before Promise.withResolvers.
      let started!: () => void;
      const pending = new Promise<void>((resolve) => {
        started = resolve;
      });
      steps.push({
        streaming: true,
        tools: false,
        respond: async (request) => {
          started();
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) resolve();
            else
              request.signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
          return HttpResponse.error();
        },
      });
      return pending;
    },
    rejectAll(status) {
      rejectionStatus = status;
    },
    assertConsumed() {
      expect(
        unexpected,
        "No request may escape explicit fake HTTP routes",
      ).toEqual([]);
      expect(
        steps,
        "Every scripted LLM response must be consumed",
      ).toHaveLength(0);
    },
    assertCustomRequests(model) {
      const custom = requests.filter((request) => request.url !== GATEWAY_URL);
      expect(custom.length).toBeGreaterThan(0);
      for (const request of custom) {
        expect(request.url).toBe(customUrl);
        expect(request.authorization).toBe(`Bearer ${CUSTOM_TOKEN}`);
        if (model !== undefined) expect(request.body.model).toBe(model);
      }
    },
    assertGatewaySearch(model) {
      const gateway = requests.filter((request) => request.url === GATEWAY_URL);
      expect(gateway).toHaveLength(1);
      expect(gateway[0]).toMatchObject({
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        modelHeader: model,
      });
      expect(JSON.stringify(gateway[0]!.body)).toContain("parallelSearch");
      expect(JSON.stringify(gateway[0]!.body)).not.toContain(CUSTOM_TOKEN);
    },
  };
}
