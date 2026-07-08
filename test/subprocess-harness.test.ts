import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

test("harness runs kb with isolated HOME, XDG_CONFIG_HOME, cwd, and controlled PATH", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\necho fake-git\n");

  const result = await harness.runKb(["--help"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(await harness.listCwd()).toEqual([]);
  expect(await readdir(harness.home)).toEqual([]);
  expect(await readdir(harness.xdgConfigHome)).toEqual([]);

  const fakeGit = await harness.run("git", []);
  expect(fakeGit).toEqual({ code: 0, stdout: "fake-git\n", stderr: "" });
});
