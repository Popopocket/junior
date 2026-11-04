import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SetupServer } from "msw/node";
import { z } from "zod";
import { createLocalSource } from "@sentry/junior-plugin-api";
import {
  createAgentInvocation,
  getAgentInvocation,
} from "@/chat/agent-invocations/store";
import { createAndEnqueueAgentInvocation } from "@/chat/agent-invocations/work";
import { runLocalAgentTurn } from "@/chat/local/runner";
import {
  commitMessages,
  loadProjection,
} from "@/chat/conversations/projection";
import {
  closeDb,
  getConversationEventStore,
  getConversationStore,
} from "@/chat/db";
import {
  completeObject,
  completeText,
  getCompletionApiKey,
  resolveCompletionModel,
} from "@/chat/pi/client";
import type { Message } from "@/chat/pi/sdk";
import { createTracedStreamFn } from "@/chat/pi/traced-stream";
import { createWebSearchTool } from "@/chat/tools/web/search";
import { createVisionContextService } from "@/chat/slack/vision-context";
import { contextProvenance } from "@/chat/conversations/provenance";
import { processBackgroundCompaction } from "@/chat/services/background-compaction";
import type { BackgroundCompactionMessage } from "@/chat/services/background-compaction-queue";
import {
  calculateContextInputLimitTokens,
  getModelContextBudget,
} from "@/chat/services/context-budget";
import { disconnectStateAdapter } from "@/chat/state/adapter";
import { realAgentRunner } from "@junior-tests/fixtures/agent-runner";
import { createConversationWorkHarness } from "@junior-tests/fixtures/conversation-work";
import {
  createCompletionHttpFixture,
  type CompletionProtocol,
  type CompletionHttpFixture,
} from "@junior-evals/fixture/completion-http";

const MODEL = "openai/gpt-5.4";
const PRIVATE_MODEL = "tenant/solver";
const messages = [
  { role: "user" as const, content: "Answer privately", timestamp: 1 },
];

/** Exercise both immutable completion configurations against real Junior transports. */
export function completionAcceptance(
  protocol: CompletionProtocol,
  server: SetupServer,
): void {
  describe(`custom completion HTTP (${protocol})`, () => {
    let http: CompletionHttpFixture;
    beforeEach(() => {
      http = createCompletionHttpFixture(protocol, server);
    });
    afterEach(() => {
      http.assertConsumed();
    });
    afterAll(async () => {
      await disconnectStateAdapter();
      await closeDb();
    });

    it("reserves custom output tokens before deriving the context input ceiling", () => {
      const budget = getModelContextBudget("tenant/context-budget");
      expect(budget).toEqual({ contextWindow: 434_464 });
      expect(calculateContextInputLimitTokens(budget)).toBe(412_740);
    });

    it("assembles split tool arguments, sends real tool output, and resumes persisted local history", async () => {
      http.enqueueText("UTC clock investigation");
      http.enqueueObject({
        profile: "standard",
        reasoning_level: "none",
        confidence: 1,
        reason: "Clock task",
      });
      http.enqueueTool("systemTime", ['{"time', 'zone":"Etc/', 'UTC"}']);
      http.enqueueAgentText("UTC clock checked.");
      http.enqueueObject({
        profile: "standard",
        reasoning_level: "none",
        confidence: 1,
        reason: "Clock followup",
      });
      http.enqueueAgentText("Previous clock check remembered.");
      const conversationId = `local:completion:${randomUUID()}`;
      const replies: string[] = [];
      const deps = {
        agentRunner: realAgentRunner,
        deliverReply: async (reply: { text: string }) => {
          replies.push(reply.text);
        },
      };
      await expect(
        runLocalAgentTurn({ conversationId, message: "Check UTC clock" }, deps),
      ).resolves.toMatchObject({ outcome: "success" });
      await expect(
        runLocalAgentTurn(
          { conversationId, message: "What did you check?" },
          deps,
        ),
      ).resolves.toMatchObject({ outcome: "success" });
      expect(replies).toEqual([
        "UTC clock checked.",
        "Previous clock check remembered.",
      ]);
      expect(http.requests).toHaveLength(6);
      const agentRequests = http.requests.filter(
        ({ body }) => Array.isArray(body.tools) && body.tools.length > 0,
      );
      expect(agentRequests).toHaveLength(3);
      const classifiers = http.requests.filter(
        ({ body }) => body.stream !== true,
      );
      expect(classifiers).toHaveLength(2);
      for (const { body } of classifiers) {
        expect(body).not.toHaveProperty("reasoning_effort");
        expect(body).not.toHaveProperty("reasoning");
      }
      const second = JSON.stringify(agentRequests[1]!.body);
      expect(second).toContain("iso_utc");
      expect(second).toContain("Etc/UTC");
      expect(second).toContain(
        protocol === "responses" ? "function_call_output" : '"role":"tool"',
      );
      const followup = JSON.stringify(agentRequests[2]!.body);
      expect(followup).toContain("UTC clock checked.");
      expect(followup).toContain("Check UTC clock");
      expect(followup).toContain("What did you check?");
      const history = await loadProjection({ conversationId });
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            toolName: "systemTime",
            isError: false,
          }),
          expect.objectContaining({
            role: "assistant",
            provider: "openai-compatible",
            model: MODEL,
          }),
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "toolCall",
                name: "systemTime",
                arguments: { timezone: "Etc/UTC" },
              }),
            ]),
          }),
        ]),
      );
      await expect(
        getConversationStore().get({ conversationId }),
      ).resolves.toMatchObject({
        title: "UTC clock investigation",
      });
      http.assertCustomRequests(MODEL);
    });

    it("keeps web search on Gateway when its raw model id equals custom completion", async () => {
      http.enqueueText("Private completion.");
      http.enqueueGatewaySearch();
      const completion = await completeText({ modelId: MODEL, messages });
      expect(completion.text).toBe("Private completion.");
      const search = createWebSearchTool(MODEL);
      const result = await search.execute!(
        { query: "Junior release", max_results: 1 },
        { toolCallId: "search-boundary" },
      );
      expect(result).toMatchObject({
        result_count: 1,
        results: [
          {
            title: "Release",
            url: "https://example.invalid/release",
            snippet: "Release notes",
          },
        ],
      });
      expect(http.requests).toHaveLength(2);
      http.assertCustomRequests(MODEL);
      http.assertGatewaySearch(MODEL);
    });

    it("uses exact private model prefix for text and locally validated structured completion", async () => {
      http.enqueueText("Private utility answer.");
      http.enqueueText("Private maximum reasoning answer.");
      http.enqueueObject({ count: 3 });
      http.enqueueText("x");
      expect(
        (
          await completeText({
            modelId: PRIVATE_MODEL,
            messages,
            thinkingLevel: "xhigh",
            maxTokens: 100_000,
          })
        ).text,
      ).toBe("Private utility answer.");
      expect(
        (
          await completeText({
            modelId: PRIVATE_MODEL,
            messages,
            thinkingLevel: "max",
            maxTokens: 100_000,
          })
        ).text,
      ).toBe("Private maximum reasoning answer.");
      await expect(
        completeObject({
          modelId: PRIVATE_MODEL,
          prompt: "Count",
          thinkingLevel: "low",
          maxTokens: 100_000,
          schema: z.object({ count: z.number().int().positive() }),
        }),
      ).resolves.toMatchObject({
        object: { count: 3 },
        costUsd: expect.closeTo(0.00002, 12),
      });
      expect(
        (
          await completeText({
            modelId: PRIVATE_MODEL,
            messages,
            maxTokens: 1,
          })
        ).text,
      ).toBe("x");
      expect(http.requests).toHaveLength(4);
      const tinyRequest = http.requests[3]!.body;
      expect(
        protocol === "responses"
          ? tinyRequest.max_output_tokens
          : (tinyRequest.max_completion_tokens ?? tinyRequest.max_tokens),
      ).toBe(1);
      expect(tinyRequest).not.toHaveProperty("reasoning_effort");
      expect(tinyRequest).not.toHaveProperty("reasoning");
      for (const request of http.requests.slice(0, 3)) {
        const maxTokens =
          protocol === "responses"
            ? request.body.max_output_tokens
            : (request.body.max_completion_tokens ?? request.body.max_tokens);
        expect(maxTokens).toBe(8192);
      }
      if (protocol === "responses") {
        expect(http.requests[0]!.body).toMatchObject({
          reasoning: { effort: "xhigh" },
        });
        expect(http.requests[1]!.body).toMatchObject({
          reasoning: { effort: "max" },
        });
        expect(http.requests[2]!.body).toMatchObject({
          reasoning: { effort: "low" },
          store: false,
        });
      } else {
        expect(http.requests[0]!.body).toMatchObject({
          reasoning_effort: "xhigh",
        });
        expect(http.requests[1]!.body).toMatchObject({
          reasoning_effort: "max",
        });
        expect(http.requests[2]!.body).toMatchObject({
          reasoning_effort: "low",
        });
      }
      http.assertCustomRequests(PRIVATE_MODEL);
    });

    it.each([
      { priorInputTokens: 450_000, maxTokens: 65_536, outputCeiling: 50_000 },
      { priorInputTokens: 496_000, maxTokens: 10, outputCeiling: 1 },
      { priorInputTokens: 499_990, maxTokens: 65_536, outputCeiling: 1 },
    ])(
      "preserves context-aware output clamp for $priorInputTokens input tokens despite sampling aliases",
      async ({ priorInputTokens, maxTokens, outputCeiling }) => {
        const model = resolveCompletionModel("tenant/context-budget");
        const history: Message[] = [
          { role: "user", content: "Previous task", timestamp: 1 },
          {
            role: "assistant",
            content: [{ type: "text", text: "Previous work." }],
            api:
              protocol === "responses"
                ? "openai-responses"
                : "openai-completions",
            provider: "openai-compatible",
            model: model.id,
            usage: {
              input: priorInputTokens,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: priorInputTokens,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            timestamp: 2,
          },
          { role: "user", content: "Summarize.", timestamp: 3 },
        ];
        http.enqueueText("Context-safe summary.");
        const stream = await createTracedStreamFn()(
          model,
          { messages: history },
          {
            apiKey: await getCompletionApiKey(),
            maxTokens,
            samplingParams: {
              max_tokens: 100_000,
              max_completion_tokens: 100_000,
              max_output_tokens: 100_000,
            },
          },
        );
        const message = await stream.result();
        expect(message.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: "Context-safe summary.",
            }),
          ]),
        );
        const request = http.requests[0]!.body;
        const outputLimit =
          protocol === "responses"
            ? request.max_output_tokens
            : (request.max_completion_tokens ?? request.max_tokens);
        expect(outputLimit).toBeGreaterThan(0);
        expect(outputLimit).toBeLessThanOrEqual(outputCeiling);
        http.assertCustomRequests(model.id);
      },
    );

    it.each([401, 429, 503])(
      "fails closed on HTTP %i without escaping to Gateway",
      async (status) => {
        // Injected fault: private LLM rejects every attempt at its real HTTP edge.
        http.rejectAll(status);
        await expect(
          completeText({ modelId: PRIVATE_MODEL, messages }),
        ).rejects.toThrow();
        expect(http.requests.length).toBeGreaterThan(0);
        http.assertCustomRequests(PRIVATE_MODEL);
      },
      60_000,
    );

    it("rejects malformed structured JSON and schema-invalid values without a Gateway fallback", async () => {
      // Injected fault: valid HTTP/provider envelopes carry malformed JSON, then invalid values.
      http.enqueueMalformedObject();
      await expect(
        completeObject({
          modelId: PRIVATE_MODEL,
          prompt: "Count",
          schema: z.object({ count: z.number().int().positive() }),
        }),
      ).rejects.toThrow();
      http.enqueueObject({ count: -1 });
      await expect(
        completeObject({
          modelId: PRIVATE_MODEL,
          prompt: "Count",
          schema: z.object({ count: z.number().int().positive() }),
        }),
      ).rejects.toThrow();
      http.assertCustomRequests(PRIVATE_MODEL);
    });

    it("aborts an in-flight HTTP completion without using another provider", async () => {
      const controller = new AbortController();
      const started = http.enqueueUntilAborted();
      const completion = completeText({
        modelId: PRIVATE_MODEL,
        messages,
        signal: controller.signal,
      });
      await started;
      controller.abort();
      await expect(completion).resolves.toMatchObject({
        text: "",
        message: {
          stopReason: "aborted",
          provider: "openai-compatible",
          model: PRIVATE_MODEL,
        },
      });
      expect(http.requests).toHaveLength(1);
      http.assertCustomRequests(PRIVATE_MODEL);
    });

    it("runs real profile handoff and its auxiliary summary on the private endpoint", async () => {
      http.enqueueText("Private solver handoff");
      http.enqueueObject({
        profile: "standard",
        reasoning_level: "none",
        confidence: 1,
        reason: "Begin standard",
      });
      http.enqueueTool("handoff", ['{"pro', 'file":"handoff"}']);
      http.enqueueText("Summary: user needs private solver.");
      http.enqueueAgentText("Private solver finished.");
      const conversationId = `local:completion:${randomUUID()}`;
      const replies: string[] = [];
      await expect(
        runLocalAgentTurn(
          { conversationId, message: "Use solver profile" },
          {
            agentRunner: realAgentRunner,
            deliverReply: async (reply) => {
              replies.push(reply.text);
            },
          },
        ),
      ).resolves.toMatchObject({ outcome: "success" });
      expect(replies).toEqual(["Private solver finished."]);
      expect(http.requests.map((request) => request.body.model)).toEqual([
        MODEL,
        MODEL,
        MODEL,
        MODEL,
        PRIVATE_MODEL,
      ]);
      expect(
        JSON.stringify(
          http.requests.find(({ body }) => body.model === PRIVATE_MODEL)!.body,
        ),
      ).toContain("Summary: user needs private solver.");
      const history = await loadProjection({ conversationId });
      expect(history.at(-1)).toMatchObject({
        provider: "openai-compatible",
        model: PRIVATE_MODEL,
      });
      http.assertCustomRequests();
      const events =
        await getConversationEventStore().loadCurrentHistory(conversationId);
      expect(events.map((event) => event.data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "handoff",
            modelId: PRIVATE_MODEL,
            summary: "Summary: user needs private solver.",
          }),
        ]),
      );
    });

    it("compacts oversized persisted history before the real agent continues on the private endpoint", async () => {
      const conversationId = `local:completion:${randomUUID()}`;
      await getConversationStore().recordActivity({
        conversationId,
        destination: { platform: "local", conversationId },
        nowMs: Date.now(),
        source: "local",
        visibility: "private",
      });
      await commitMessages({
        conversationId,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Old log ".repeat(120_000) }],
            timestamp: 1,
          },
        ],
        provenance: [contextProvenance],
      });
      http.enqueueText("Continue blue choice");
      http.enqueueObject({
        profile: "standard",
        reasoning_level: "none",
        confidence: 1,
        reason: "Continue task",
      });
      http.enqueueAgentText("<summary>Keep the blue choice.</summary>");
      http.enqueueAgentText("Continued with the blue choice.");
      const replies: string[] = [];
      await expect(
        runLocalAgentTurn(
          { conversationId, message: "Continue" },
          {
            agentRunner: realAgentRunner,
            deliverReply: async (reply) => {
              replies.push(reply.text);
            },
          },
        ),
      ).resolves.toMatchObject({ outcome: "success" });
      expect(replies).toEqual(["Continued with the blue choice."]);
      expect(http.requests).toHaveLength(4);
      const agentRequests = http.requests.filter(
        ({ body }) => Array.isArray(body.tools) && body.tools.length > 0,
      );
      expect(agentRequests).toHaveLength(2);
      expect(JSON.stringify(agentRequests[0]!.body)).toContain(
        "Old log Old log",
      );
      const continued = JSON.stringify(agentRequests[1]!.body);
      expect(continued).toContain("Keep the blue choice.");
      expect(continued.length).toBeLessThan(200_000);
      const persisted = JSON.stringify(
        await loadProjection({ conversationId }),
      );
      expect(persisted).toContain("Keep the blue choice.");
      expect(persisted.length).toBeLessThan(200_000);
      http.assertCustomRequests(MODEL);
    });

    it("prepares a queued background summary with real private Agent HTTP transport", async () => {
      const conversationId = `local:completion:${randomUUID()}`;
      await getConversationStore().recordActivity({
        conversationId,
        destination: { platform: "local", conversationId },
        nowMs: Date.now(),
        source: "local",
        visibility: "private",
      });
      const jobs: BackgroundCompactionMessage[] = [];
      // Provider-reported usage crosses the background mark, not the foreground trigger.
      // The completed real Turn stores its own request snapshot and queues the job.
      http.enqueueAgentText("Blue option ready.", 150_000);
      await expect(
        realAgentRunner.run({
          conversationId,
          turnId: randomUUID(),
          instruction: { text: "Remember the blue option." },
          source: createLocalSource(conversationId),
          destination: { platform: "local", conversationId },
          actor: { platform: "local", userId: "local-cli" },
          credentialContext: { actor: { type: "user", userId: "local-cli" } },
          modelProfile: "standard",
          reasoning: "none",
          disabledFeatures: ["handoff", "interactive-auth", "subagents"],
          environment: {
            backgroundCompactionQueue: {
              send: async (job) => {
                jobs.push(job);
              },
            },
          },
        }),
      ).resolves.toMatchObject({
        status: "completed",
        result: { diagnostics: { outcome: "success" } },
      });
      expect(jobs).toEqual([
        {
          conversationId,
          historyVersion: 0,
          markSeq: expect.any(Number),
        },
      ]);
      http.enqueueAgentText("<summary>The person picked blue.</summary>");
      await processBackgroundCompaction(jobs[0]!);
      const history =
        await getConversationEventStore().loadCurrentHistory(conversationId);
      expect(history.map((event) => event.data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "compaction_prepared",
            outcome: "ready",
            modelId: MODEL,
            modelProfile: "standard",
            summary: "The person picked blue.",
            historyVersion: 0,
            markSeq: jobs[0]!.markSeq,
          }),
        ]),
      );
      expect(http.requests).toHaveLength(2);
      expect(JSON.stringify(http.requests[1]!.body)).toContain(
        "Remember the blue option.",
      );
      http.assertCustomRequests(MODEL);
    });

    it("sends enabled dedicated vision image analysis to the private endpoint", async () => {
      http.enqueueText("Chart shows three green bars.");
      const vision = createVisionContextService({
        completeText,
        downloadFile: async () => {
          throw new Error("No remote attachment expected");
        },
        listThreadReplies: async () => {
          throw new Error("No thread hydration expected");
        },
      });
      const attachments = await vision.resolveUserAttachments(
        [
          {
            type: "image",
            mimeType: "image/png",
            name: "chart.png",
            data: Buffer.from("89504e470d0a1a0a", "hex"),
          },
        ],
        {},
      );
      expect(attachments).toEqual([
        expect.objectContaining({
          promptText: expect.stringContaining("Chart shows three green bars."),
        }),
      ]);
      const body = JSON.stringify(http.requests[0]!.body);
      expect(body).toContain("data:image/png;base64,iVBORw0KGgo=");
      expect(http.requests).toHaveLength(1);
      http.assertCustomRequests("tenant/vision");
    });

    it("runs a durably queued nested child profile through real agent wiring", async () => {
      const parentConversationId = `local:completion:${randomUUID()}`;
      const destination = {
        platform: "local" as const,
        conversationId: parentConversationId,
      };
      const conversationStore = getConversationStore();
      await conversationStore.recordActivity({
        conversationId: parentConversationId,
        destination,
        nowMs: Date.now(),
        source: "local",
        visibility: "private",
      });
      const invocation = {
        actor: { platform: "system" as const, name: "private-parent" },
        destination,
        parentConversationId,
        input: "Check delegated task",
        modelProfile: "handoff",
        reasoningLevel: "none" as const,
      };
      const child = await createAgentInvocation({
        ...invocation,
        idempotencyKey: randomUUID(),
      });
      const work = await createConversationWorkHarness(realAgentRunner);
      const grandchild = await createAndEnqueueAgentInvocation(
        {
          ...invocation,
          parentConversationId: child.childConversationId,
          idempotencyKey: randomUUID(),
        },
        { conversationStore, queue: work.queue, state: work.state },
      );
      http.enqueueAgentText("Nested child checked private task.");
      await expect(
        work.process(work.queue.takeMessage()),
      ).resolves.toMatchObject({ status: "completed" });
      await expect(
        getAgentInvocation(grandchild.invocationId),
      ).resolves.toMatchObject({
        status: "completed",
        result: "Nested child checked private task.",
      });
      const history = await loadProjection({
        conversationId: grandchild.childConversationId,
      });
      expect(history.at(-1)).toMatchObject({
        provider: "openai-compatible",
        model: PRIVATE_MODEL,
      });
      expect(http.requests).toHaveLength(1);
      http.assertCustomRequests(PRIVATE_MODEL);
    });
  });
}
