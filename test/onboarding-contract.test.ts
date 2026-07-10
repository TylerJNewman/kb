import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const beginnerSurfaces = [
  "README.md",
  "docs/START-HERE.md",
  "docs/WALKTHROUGH.md",
  "site/index.html",
  "site/walkthrough.html",
];

async function text(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

test("beginner install guidance includes the runtime and Git required by kb", async () => {
  expect((await text("bin/kb")).startsWith("#!/usr/bin/env bun\n")).toBe(true);
  expect(JSON.parse(await text("package.json")).engines.bun).toBe(">=1.1.0");

  for (const path of beginnerSurfaces) {
    const content = await text(path);
    expect(content, path).toContain("bun install --global @tylerjnewman/kb");
    expect(content, path).toContain("kb --version");
    expect(content, path).toContain("git --version");
    expect(content, path).not.toContain("npm i -g @tylerjnewman/kb");
  }
});

test("first-run public language reserves Basic Memory for the optional engine", async () => {
  const publicLanguage = [
    ...(await Promise.all(beginnerSurfaces.map(text))),
    await text("src/cli.ts"),
    await text("src/memory-format.ts"),
  ].join("\n");

  for (const leakedPhrase of [
    "Basic Memory note",
    "in Basic Memory format",
    "Basic Memory-compatible Memory",
    "Basic Memory format, Engine disabled",
  ]) {
    expect(publicLanguage).not.toContain(leakedPhrase);
  }
  expect(publicLanguage).toContain("optional local search engine, Basic Memory");
});

test("HTML setup stops for the agent before verification commands run", async () => {
  const page = await text("site/index.html");
  const setupStart = page.indexOf('id="setupCode"');
  const promptStart = page.indexOf('id="agentPrompt"');
  const verifyStart = page.indexOf('id="verifyCode"');

  expect(setupStart).toBeGreaterThan(-1);
  expect(promptStart).toBeGreaterThan(setupStart);
  expect(verifyStart).toBeGreaterThan(promptStart);

  const setup = page.slice(setupStart, promptStart);
  const prompt = page.slice(promptStart, verifyStart);
  const verify = page.slice(verifyStart);
  expect(setup).toContain('kb add "$sample_dir/hello.txt" --in research');
  expect(setup).not.toContain("kb status");
  expect(setup).not.toContain("kb search");
  expect(prompt).toContain("kb add --complete");
  expect(verify).toContain("kb status --in research");
  expect(verify).toContain('kb search "vector search" --in research');
});

test("worked walkthroughs show the Add receipt before healthy status", async () => {
  for (const path of ["docs/WALKTHROUGH.md", "site/walkthrough.html"]) {
    const content = await text(path);
    const completedCommand = content.indexOf("kb add --complete");
    const receipt = content.indexOf("Completed Add handoff", completedCommand);
    const healthyStatus = content.indexOf("kb status", receipt);
    expect(completedCommand, path).toBeGreaterThan(-1);
    expect(receipt, path).toBeGreaterThan(completedCommand);
    expect(healthyStatus, path).toBeGreaterThan(receipt);
  }
});

test("onboarding exposes safe recovery without making kb new idempotent", async () => {
  for (const path of ["README.md", "docs/START-HERE.md", "site/index.html"]) {
    const content = await text(path);
    expect(content, path).toContain("kb status --in research");
    expect(content, path).toContain("kb add --resume");
  }
});
