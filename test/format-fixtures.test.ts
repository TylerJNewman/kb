import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixturesDir = join(import.meta.dir, "fixtures");
const basicMemoryContractDir = join(fixturesDir, "basic-memory-contract");

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

test("Basic Memory contract fixtures pin real engine JSON shapes", async () => {
  const projectList = await readBasicMemoryContractJson("project-list.json");
  const searchEntity = await readBasicMemoryContractJson("search-entity.json");
  const searchObservation = await readBasicMemoryContractJson("search-observation.json");
  const searchRelation = await readBasicMemoryContractJson("search-relation.json");
  const statusTimeout = await readBasicMemoryContractJson("status-wait-timeout.json");

  expect(projectList.projects[0]).toMatchObject({
    name: "kb-contract-spike",
    local_path: "/tmp/kb-bm-contract/kb",
    cli_route: "local",
    is_default: true,
  });
  expect(searchEntity.results[0]).toMatchObject({
    type: "entity",
    permalink: "example-memory",
    file_path: "memories/example-memory.md",
  });
  expect(searchObservation.results[0]).toMatchObject({
    type: "observation",
    category: "summary",
    content: "One durable observation. #research",
  });
  expect(searchRelation.results[0]).toMatchObject({
    type: "relation",
    from_entity: "example-memory",
    to_entity: "target-memory",
    relation_type: "relates_to",
  });
  expect(statusTimeout.error).toContain("bm reindex --project kb-contract-spike");
});

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

async function readBasicMemoryContractJson(name: string): Promise<any> {
  return JSON.parse(await readFile(join(basicMemoryContractDir, name), "utf8"));
}
