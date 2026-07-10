import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

test("package metadata pins exact Bun and TypeScript verification tools", async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(pkg.packageManager).toBe("bun@1.3.10");
  expect(pkg.engines?.bun).toBe("1.3.10");
  expect(pkg.devDependencies?.typescript).toBe("5.9.3");
  expect(pkg.devDependencies?.["@types/bun"]).toBe("1.3.14");
  expect(Object.values(pkg.devDependencies ?? {}).every((version) => !/[~^*]|latest/.test(version))).toBe(true);
});

test("typecheck and verify scripts use repository-local tools", async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  expect(pkg.scripts?.typecheck).toBe("bun run tsc --noEmit --project tsconfig.json");
  expect(pkg.scripts?.verify).toBe("bun run typecheck && bun test");
  expect(pkg.scripts?.typecheck).not.toContain("bunx");
  expect(pkg.scripts?.typecheck).not.toContain("npx");
});

test("CI pins Bun and runs frozen install plus deterministic verification", async () => {
  const workflow = await readFile(join(repoRoot, ".github", "workflows", "verify.yml"), "utf8");

  expect(workflow).toContain("oven-sh/setup-bun@v2");
  expect(workflow).toContain("bun-version: 1.3.10");
  expect(workflow).toContain("bun install --frozen-lockfile");
  expect(workflow).toContain("bun run verify");
});
