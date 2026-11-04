import { afterAll, vi } from "vitest";

const { restoreEnvironment, server } = await vi.hoisted(async () => {
  // Static imports cannot run before setupFiles' cached immutable config.
  const { initializeCompletionTestEnvironment } =
    await import("@junior-evals/fixture/completion-env");
  return initializeCompletionTestEnvironment("responses");
});

import { completionAcceptance } from "./custom-completion-scenarios";

afterAll(restoreEnvironment);
completionAcceptance("responses", server);
