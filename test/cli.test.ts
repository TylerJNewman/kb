import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
  expect(result.stdout).toContain("Create and grow local-first markdown knowledge bases.");
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("kb [--kb <name>] <command> [flags]");
  expect(result.stdout).toContain("kb new creates under KB Home: ~/kb/<name>/");
  expect(result.stdout).toContain("The default Arm is b0");
  expect(result.stdout).toContain("stdout is for requested output and playbooks.");
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

test("unimplemented product commands are router stubs", async () => {
  const result = await harness.runKb(["add"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: command not implemented in this slice: add\n",
  });
});

test("kb new --help teaches what a KB is and where it lands", async () => {
  const result = await harness.runKb(["new", "--help"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Create a new KB under KB Home: ~/kb/<name>/.");
  expect(result.stdout).toContain("A KB is a portable git repo of markdown");
  expect(result.stdout).toContain("raw/       immutable raw sources");
  expect(result.stdout).toContain("memories/  derivatives written from raw sources");
  expect(result.stdout).toContain("Git: initialized silently unless the KB is already inside a git repo");
});

test("kb new research creates the B0 scaffold and initializes git silently", async () => {
  await harness.writeFakeExecutable(
    "git",
    "#!/bin/sh\nprintf '%s %s\\n' \"$PWD\" \"$*\" >> \"$HOME/git-calls\"\n/bin/mkdir .git\n",
  );

  const result = await harness.runKb(["new", "research"]);
  const kbDir = join(harness.home, "kb", "research");

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await listTree(kbDir)).toEqual([
    ".git/",
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories/",
    "raw/",
  ]);
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`);
  expect(await readFile(join(kbDir, "AGENTS.md"), "utf8")).toContain("Use the `kb` CLI");
  expect(await readFile(join(kbDir, "AGENTS.md"), "utf8")).toContain("Raw/derived boundary: never modify files in `raw/`.");
  expect(await readFile(join(kbDir, "index.md"), "utf8")).toBe(`# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
`);
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toMatch(/^# KB Log\n\n## \[\d{4}-\d{2}-\d{2}\] created \| research\n$/);
  expect(await readFile(join(harness.home, "git-calls"), "utf8")).toEndWith("/home/kb/research init\n");
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toBe(`default: research
kbs:
  research: ${kbDir}
`);
});

test("kb new does not git init when the KB is already inside a git repo", async () => {
  await mkdir(join(harness.home, "kb", ".git"), { recursive: true });
  await harness.writeFakeExecutable(
    "git",
    "#!/bin/sh\necho should-not-run >&2\nexit 1\n",
  );

  const result = await harness.runKb(["new", "research"]);

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await listTree(join(harness.home, "kb", "research"))).toEqual([
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories/",
    "raw/",
  ]);
});

test("kb new rejects names that escape KB Home", async () => {
  const result = await harness.runKb(["new", "../research"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: KB name must be one path segment using letters, numbers, dot, dash, or underscore\n",
  });
});

test("kb init scaffolds the current directory in place and updates the Registry", async () => {
  await harness.writeFakeExecutable(
    "git",
    "#!/bin/sh\nprintf '%s %s\\n' \"$PWD\" \"$*\" >> \"$HOME/git-calls\"\n/bin/mkdir .git\n",
  );

  const result = await harness.runKb(["init"]);

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await listTree(harness.cwd)).toEqual([
    ".git/",
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories/",
    "raw/",
  ]);
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toBe(`default: cwd
kbs:
  cwd: ${harness.cwd}
`);
});

test("kb init refuses home and points at kb new", async () => {
  const result = await harness.run("kb", ["init"], { cwd: harness.home });

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: refusing to scaffold a KB here; use `kb new <name>` from home or root\n",
  });
  expect(await readdir(harness.home)).toEqual([]);
});

test("kb init refuses filesystem root and points at kb new", async () => {
  const result = await harness.run("kb", ["init"], { cwd: "/" });

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: refusing to scaffold a KB here; use `kb new <name>` from home or root\n",
  });
});

test("kb list shows all KBs and the default", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");

  await harness.runKb(["new", "research"]);
  await harness.runKb(["new", "papers"]);
  const result = await harness.runKb(["list"]);

  expect(result).toEqual({
    code: 0,
    stdout: `  papers ${join(harness.home, "kb", "papers")}
* research ${join(harness.home, "kb", "research")}
`,
    stderr: "",
  });
});

test("--kb resolves from an unrelated cwd and missing targets fail clearly", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "research"]);

  const found = await harness.runKb(["status", "--kb", "research"]);
  const missing = await harness.runKb(["status", "--kb", "missing"]);

  expect(found).toEqual({
    code: 0,
    stdout: `KB: research
Path: ${join(harness.home, "kb", "research")}
Arm: b0
`,
    stderr: "",
  });
  expect(missing).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: unknown KB: missing\n",
  });
});

test("cwd inside a KB is auto-detected before default fallback", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "research"]);
  await harness.runKb(["new", "papers"]);

  const result = await harness.run("kb", ["status"], {
    cwd: join(harness.home, "kb", "papers", "memories"),
  });

  expect(result).toEqual({
    code: 0,
    stdout: `KB: papers
Path: ${join(harness.home, "kb", "papers")}
Arm: b0
`,
    stderr: "",
  });
});

test("Registry rebuild-by-scan reconstructs KB Home entries when config is deleted", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "research"]);
  await rm(join(harness.xdgConfigHome, "kb", "config.yaml"));

  const result = await harness.runKb(["list"]);

  expect(result).toEqual({
    code: 0,
    stdout: `* research ${join(harness.home, "kb", "research")}
`,
    stderr: "",
  });
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toContain("research:");
});

test("kb init --guide prints the non-interactive chooser", async () => {
  const result = await harness.runKb(["init", "--guide"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("KB chooser");
  expect(result.stdout).toContain("Retrieval or curation?");
  expect(result.stdout).toContain("Corpus size?");
  expect(result.stdout).toContain("Will you maintain it by hand?");
  expect(result.stdout).toContain("Rule of thumb");
});

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort();
}
