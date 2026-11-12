import { defineConfig } from "vitest/config";
import path from "node:path";
import { loadJuniorTestEnvFiles } from "./tests/fixtures/env";

const workspaceRoot = path.resolve(__dirname, "../..");
const packageRoot = process.cwd();

loadJuniorTestEnvFiles({ workspaceRoot, packageRoots: [packageRoot] });

// Core tests use Gateway fixtures, not ambient local completion configuration.
// Explicit config tests set their own values after this bootstrap.
for (const name of [
  "AI_COMPLETION_BASE_URL",
  "AI_COMPLETION_API_KEY",
  "AI_COMPLETION_API",
  "AI_COMPLETION_MODELS",
  "AI_MODEL",
  "AI_HANDOFF_MODEL",
  "AI_FAST_MODEL",
  "AI_GUARDIAN_MODEL",
  "AI_DECISION_MODEL",
  "AI_VISION_MODEL",
  "AI_MODEL_PROFILES",
  "AI_MODEL_CONTEXT_WINDOW_TOKENS",
  "AI_REASONING_LEVEL",
]) {
  delete process.env[name];
}

process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
process.env.JUNIOR_SECRET = "junior-test-secret";
process.env.JUNIOR_STATE_ADAPTER = "memory";
process.env.JUNIOR_ATTACHMENT_STORAGE_PROVIDER = "memory";
// Do not inherit application providers from the devcontainer or local env files.
process.env.JUNIOR_SANDBOX_PROVIDER = "vercel";
process.env.JUNIOR_QUEUE_PROVIDER = "vercel";
process.env.JUNIOR_STATE_KEY_PREFIX ??= `junior:test:${process.pid}`;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Restore a real module after tests remove a virtual config mock.
      "#junior/config": path.resolve(
        __dirname,
        "tests/fixtures/virtual-config.ts",
      ),
      "@sentry/junior-plugin-api": path.resolve(
        __dirname,
        "../junior-plugin-api/src/index.ts",
      ),
      "@sentry/junior-memory": path.resolve(
        __dirname,
        "../junior-memory/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/unit/workflow/**/*.test.ts",
      "tests/integration/workflow/**/*.test.ts",
    ],
    globalSetup: ["tests/fixtures/postgres/global-setup.ts"],
    setupFiles: [
      "tests/msw/setup.ts",
      "tests/fixtures/postgres/setup.ts",
      "tests/fixtures/experimental-setup.ts",
      "tests/fixtures/setup.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["json", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
