import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixturesDir = join(import.meta.dir, "fixtures");

test("kb.yaml fixture pins the scaffold config contract", async () => {
  const yaml = await readFixture("kb.yaml");

  expect(yaml).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`);
});

test("index.md fixture pins the one-line catalog format", async () => {
  const index = await readFixture("index.md");

  expect(index).toBe("- [[memories/example-memory.md|Example Memory]] | category: research | summary: One-line summary.\n");
});

test("log.md fixture pins the greppable entry prefix", async () => {
  const log = await readFixture("log.md");

  expect(log).toBe("## [2026-01-02] add | Example Source\n");
});

test("Basic Memory note fixture pins frontmatter, observation, and relation syntax", async () => {
  const note = await readFixture("basic-memory-note.md");

  expect(note).toContain(`---
title: Example Memory
type: note
tags:
  - research
permalink: example-memory
---`);
  expect(note).toContain("- [summary] One durable observation. #research");
  expect(note).toContain("- relates_to [[Target Memory]]");
});

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}
