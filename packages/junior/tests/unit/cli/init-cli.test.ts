import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "@/cli/check";
import { runInit } from "@/cli/init";

const tempRoots: string[] = [];

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("init cli", () => {
  it("writes the scaffold into an empty directory", async () => {
    const target = makeTempDir("junior-init-empty-");

    await runInit(target, () => undefined);

    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "server.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "instrument.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(target, "api"))).toBe(false);
    expect(fs.existsSync(path.join(target, "vercel.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "nitro.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "plugins.ts"))).toBe(true);
    expect(fs.existsSync(path.join(target, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(target, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "app", "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "app", "WORLD.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "app", "DESCRIPTION.md"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(target, ".github", "workflows", "ci.yml")),
    ).toBe(true);

    const workflow = fs.readFileSync(
      path.join(target, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("pnpm check");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("pnpm install");

    const vercelConfig = readJsonFile<Record<string, unknown>>(
      path.join(target, "vercel.json"),
    );
    expect(vercelConfig.framework).toBe("nitro");
    expect(vercelConfig.buildCommand).toBe(
      "pnpm exec junior upgrade && pnpm build",
    );
    expect(vercelConfig.crons).toBeUndefined();
    expect(vercelConfig.functions).toBeUndefined();

    const serverEntry = fs.readFileSync(path.join(target, "server.ts"), "utf8");
    expect(serverEntry).toContain(
      'import { initSentry } from "@sentry/junior/instrumentation";',
    );
    expect(serverEntry).toContain('import("@sentry/junior")');
    expect(serverEntry).toContain('import("./plugins.ts")');
    expect(serverEntry).toContain("createApp({");
    expect(serverEntry).toContain("plugins,");

    const nitroConfig = fs.readFileSync(
      path.join(target, "nitro.config.ts"),
      "utf8",
    );
    expect(nitroConfig).toContain(
      'import { juniorNitro, withSentryConfig } from "@sentry/junior/nitro";',
    );
    expect(nitroConfig).toContain('preset: "vercel"');
    expect(nitroConfig).toContain("juniorNitro({");
    expect(nitroConfig).toContain('plugins: "./plugins"');
    expect(nitroConfig).toContain('"/**": { handler: "./server.ts" }');
    expect(nitroConfig).toContain("withSentryConfig(config");

    const tsConfig = readJsonFile<Record<string, unknown>>(
      path.join(target, "tsconfig.json"),
    );
    expect(tsConfig.extends).toBe("nitro/tsconfig");

    const pluginsFile = fs.readFileSync(
      path.join(target, "plugins.ts"),
      "utf8",
    );
    expect(pluginsFile).toContain(
      'import { defineJuniorPlugins } from "@sentry/junior";',
    );
    expect(pluginsFile).toContain(
      'import { memoryPlugin } from "@sentry/junior-memory";',
    );
    expect(pluginsFile).toContain("defineJuniorPlugins(");
    expect(pluginsFile).toContain("memoryPlugin()");
    expect(pluginsFile).toContain('"@sentry/junior-maintenance"');

    const pkg = readJsonFile<{
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    }>(path.join(target, "package.json"));
    expect(pkg.dependencies["@sentry/junior"]).toBe("latest");
    expect(pkg.dependencies["@sentry/junior-memory"]).toBe("latest");
    expect(pkg.dependencies["@sentry/junior-maintenance"]).toBe("latest");
    expect(pkg.dependencies["@sentry/nitro"]).toBeUndefined();
    expect(pkg.devDependencies.nitro).toBeDefined();
    expect(pkg.devDependencies.vite).toBeUndefined();
    expect(pkg.devDependencies.vercel).toBeUndefined();
    expect(pkg.scripts.dev).toBe("nitro dev");
    expect(pkg.scripts.check).toBe("junior check");
    expect(pkg.scripts.build).toBe("junior snapshot create && nitro build");
    expect(pkg.scripts.preview).toBe("nitro preview");
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");

    const pnpmWorkspace = fs.readFileSync(
      path.join(target, "pnpm-workspace.yaml"),
      "utf8",
    );
    expect(pnpmWorkspace).toBe(`minimumReleaseAge: 1440
minimumReleaseAgeExclude:
  - "@sentry/*"
`);

    const envExample = fs.readFileSync(
      path.join(target, ".env.example"),
      "utf8",
    );
    expect(envExample).toContain("CRON_SECRET=");
    expect(envExample).toContain("AI_GUARDIAN_MODEL=");
    expect(envExample).toContain("DATABASE_URL=");
    expect(envExample).toContain("JUNIOR_DATABASE_DRIVER=");
    expect(envExample).toContain("JUNIOR_SQL_STATEMENT_TIMEOUT_MS=");
    expect(envExample).toContain("SENTRY_ENVIRONMENT=");
    expect(envExample).toContain("SENTRY_TRACES_SAMPLE_RATE=1");
    expect(envExample).toContain("SENTRY_ORG=");
    expect(envExample).toContain("SENTRY_PROJECT=");
    expect(envExample).toContain("SENTRY_AUTH_TOKEN=");

    const checkLines: string[] = [];
    await runCheck(target, {
      info: (line) => checkLines.push(line),
      warn: (line) => checkLines.push(line),
      error: (line) => checkLines.push(line),
    });
    expect(checkLines).toContain("✓ deployment config");
  });

  it("refuses to initialize a non-empty directory", async () => {
    const target = makeTempDir("junior-init-non-empty-");
    fs.writeFileSync(path.join(target, "README.md"), "# existing\n");

    await expect(runInit(target, () => undefined)).rejects.toThrow(
      "refusing to initialize non-empty directory",
    );
  });

  it("refuses to initialize a file path", async () => {
    const targetRoot = makeTempDir("junior-init-file-path-");
    const filePath = path.join(targetRoot, "not-a-dir.txt");
    fs.writeFileSync(filePath, "hello");

    await expect(runInit(filePath, () => undefined)).rejects.toThrow(
      "refusing to initialize non-directory path",
    );
  });
});
