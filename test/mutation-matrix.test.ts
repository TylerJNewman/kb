import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

test("command mutation matrix pins KB-owned paths each command may change", async () => {
  await expectNewCreatesOnlyScaffold();
  await expectInitCreatesOnlyScaffold();

  await expectAllowedMutation("add", async () => {
    const source = join(harness.cwd, "source.md");
    await writeFile(source, "# Source\n\nMatrix fact.\n");
    return harness.runKb(["add", source, "--in", "research"]);
  }, ["log.md", /^raw\//, /^\.kb\/pending\/add\//]);

  await expectAllowedMutation("draft", () => harness.runKb(["draft", "Matrix Memory", "--in", "research"]), [
    "memories/matrix-memory.md",
  ]);

  await expectAllowedMutation("search", () => harness.runKb(["search", "matrix", "--in", "research"]), ["log.md"], {
    memory: true,
    index: true,
  });

  await expectAllowedMutation("enable search", async () => {
    await writeEngineStubs();
    return harness.runKb(["enable", "search", "--in", "research"]);
  }, ["kb.yaml"]);

  await expectAllowedMutation("reflect", () => harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: "2026-07-17T12:00:00.000Z" },
  }), [".kb/pending/reflect.json"], { memory: true });

  await expectAllowedMutation("check", () => harness.runKb(["check", "--in", "research"]), [], {
    memory: true,
    index: true,
  });

  await expectAllowedMutation("check", () => harness.run("kb", ["check", "--in", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  }), [], { arm: "wiki", memory: true, index: true });

  await expectAllowedMutation("status", () => harness.runKb(["status", "--in", "research"]), [], {
    memory: true,
    index: true,
  });

  await expectAllowedMutation("read", () => harness.runKb(["read", "matrix-memory", "--in", "research"]), [], {
    memory: true,
  });

  await expectAllowedMutation("list", () => harness.runKb(["list"]), [], {
    memory: true,
  });
});

async function expectNewCreatesOnlyScaffold(): Promise<void> {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  const result = await harness.runKb(["new", "research"]);
  expect(result.code).toBe(0);
  expect(await listTree(join(harness.home, "kb", "research"))).toEqual([
    ".git/",
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories/",
    "raw/",
  ]);
  await resetHarness();
}

async function expectInitCreatesOnlyScaffold(): Promise<void> {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  const result = await harness.runKb(["init"]);
  expect(result.code).toBe(0);
  expect(await listTree(harness.cwd)).toEqual([
    ".git/",
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories/",
    "raw/",
  ]);
  await resetHarness();
}

type MatrixOptions = {
  arm?: "b0" | "wiki";
  memory?: boolean;
  index?: boolean;
};

async function expectAllowedMutation(
  name: string,
  run: () => Promise<{ code: number; stdout: string; stderr: string }>,
  allowed: Array<string | RegExp>,
  options: MatrixOptions = {},
): Promise<void> {
  await scaffoldKb(options.arm ?? "b0");
  const kbDir = join(harness.home, "kb", "research");
  if (options.memory) {
    await writeMemory(kbDir);
  }
  if (options.index) {
    await writeIndex(kbDir);
  }

  const before = await contentHashes(kbDir);
  const result = await run();
  expect(result.code, name).toBe(0);
  const changed = changedHashes(before, await contentHashes(kbDir));
  expect(changed.filter((path) => !isAllowed(path, allowed)), name).toEqual([]);
  expect(changed.length, name).toBeLessThanOrEqual(allowed.length);

  await resetHarness();
}

async function resetHarness(): Promise<void> {
  await harness.cleanup();
  harness = await createKbHarness();
}

async function scaffoldKb(arm: "b0" | "wiki"): Promise<void> {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  const args = arm === "wiki" ? ["new", "research", "--arm", "wiki"] : ["new", "research"];
  expect((await harness.runKb(args)).code).toBe(0);
}

async function writeMemory(kbDir: string): Promise<void> {
  await writeFile(join(kbDir, "memories", "matrix-memory.md"), `---
title: Matrix Memory
type: note
tags:
  - research
permalink: matrix-memory
---

Matrix fact.
`);
}

async function writeIndex(kbDir: string): Promise<void> {
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/matrix-memory.md|Matrix Memory]] | category: research | summary: Matrix fact.
`);
}

async function writeEngineStubs(): Promise<void> {
  await harness.writeFakeExecutable(
    "bm",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi\nif [ \"$1\" = \"project\" ] && [ \"$2\" = \"list\" ]; then echo '{\"projects\":[]}'; exit 0; fi\nif [ \"$1\" = \"project\" ] && [ \"$2\" = \"add\" ]; then exit 0; fi\nif [ \"$1\" = \"reindex\" ]; then exit 0; fi\nexit 2\n",
  );
}

async function contentHashes(root: string, dir = ""): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const rel = dir === "" ? entry.name : join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(hashes, await contentHashes(root, rel));
      continue;
    }
    const bytes = await readFile(join(root, rel));
    hashes[rel] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}

function changedHashes(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort();
}

function isAllowed(path: string, allowed: Array<string | RegExp>): boolean {
  return allowed.some((entry) => typeof entry === "string" ? entry === path : entry.test(path));
}

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`).sort();
}
