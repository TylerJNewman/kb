import { afterEach, beforeEach, expect, test } from "bun:test";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

test("kb --help exits 0 and writes the golden help surface to stdout", async () => {
  const result = await harness.runKb(["--help"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("kb [--kb <name>] <command> [flags]");
  expect(result.stdout).toContain("stdout is for requested output and playbooks.");
  expect(result.stdout).toContain("No product commands are implemented in this slice.");
});

test("kb --version exits 0 and writes only the version to stdout", async () => {
  const result = await harness.runKb(["--version"]);

  expect(result).toEqual({
    code: 0,
    stdout: "kb 0.0.0\n",
    stderr: "",
  });
});

test("global --kb flag is accepted before a command is routed", async () => {
  const result = await harness.runKb(["--kb", "research", "--version"]);

  expect(result).toEqual({
    code: 0,
    stdout: "kb 0.0.0\n",
    stderr: "",
  });
});

test("unknown command exits non-zero and writes stderr only", async () => {
  const result = await harness.runKb(["wat"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: unknown command: wat\n",
  });
});

test("bad flag exits non-zero and writes stderr only", async () => {
  const result = await harness.runKb(["--wat"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: unknown flag: --wat\n",
  });
});

test("product commands are router stubs only", async () => {
  const result = await harness.runKb(["new"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: command not implemented in this slice: new\n",
  });
});
