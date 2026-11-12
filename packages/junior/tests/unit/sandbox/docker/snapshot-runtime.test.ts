import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JUNIOR_SANDBOX_PROVIDER = "docker";
});

vi.mock("@/chat/plugins/catalog-runtime", () => ({
  pluginCatalogRuntime: {
    getRuntimeDependencies: () => [
      { type: "system", package: "gh" },
      { type: "npm", package: "vercel", version: "latest" },
    ],
    getRuntimePostinstall: () => [{ cmd: "agent-browser", args: ["install"] }],
  },
}));

vi.mock("@/chat/sandbox/runtime-dependencies", () => ({
  GLOBAL_RUNTIME_DEPENDENCIES: [
    { type: "system", package: "docker" },
    { type: "system", package: "ripgrep" },
  ],
  GLOBAL_RUNTIME_POSTINSTALL: [{ cmd: "install", args: ["docker-compose"] }],
}));

import { create } from "@/chat/sandbox/snapshot/profile";

describe("Docker snapshot runtime dependencies", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the minimal snapshot profile without full runtime opt-in", () => {
    vi.stubEnv("JUNIOR_DOCKER_SANDBOX_FULL_RUNTIME", undefined);
    const profile = create("node22");
    expect(profile?.dependencies).toEqual([
      { type: "system", package: "ripgrep" },
      { type: "system", package: "gh" },
    ]);
    expect(profile?.postinstall).toEqual([]);
    expect(profile?.floating).toBe(false);
  });

  it("uses a distinct expiring snapshot for the full plugin runtime", () => {
    vi.stubEnv("JUNIOR_DOCKER_SANDBOX_FULL_RUNTIME", undefined);
    const minimal = create("node22");
    vi.stubEnv("JUNIOR_DOCKER_SANDBOX_FULL_RUNTIME", "1");
    const full = create("node22");

    expect(full?.floating).toBe(true);
    expect(full?.hash).not.toBe(minimal?.hash);
  });
});
