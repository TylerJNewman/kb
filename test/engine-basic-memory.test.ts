import { expect, test } from "bun:test";
import { buildBasicMemoryCommand } from "../src/engine/basic-memory";

test("Basic Memory command construction pins every operation to the same uvx runner", () => {
  expect(buildBasicMemoryCommand(["--version"])).toEqual([
    "uvx",
    "--from",
    "basic-memory==0.22.1",
    "bm",
    "--version",
  ]);
  expect(buildBasicMemoryCommand(["project", "add", "research", "/tmp/kb"])).toEqual([
    "uvx",
    "--from",
    "basic-memory==0.22.1",
    "bm",
    "project",
    "add",
    "research",
    "/tmp/kb",
  ]);
  expect(buildBasicMemoryCommand(["reindex", "--project", "research", "--search"])).toEqual([
    "uvx",
    "--from",
    "basic-memory==0.22.1",
    "bm",
    "reindex",
    "--project",
    "research",
    "--search",
  ]);
  expect(buildBasicMemoryCommand(["tool", "search-notes", "durable observation", "--project", "research"])).toEqual([
    "uvx",
    "--from",
    "basic-memory==0.22.1",
    "bm",
    "tool",
    "search-notes",
    "durable observation",
    "--project",
    "research",
  ]);
});
