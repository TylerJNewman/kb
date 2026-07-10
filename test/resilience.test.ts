import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFile, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir -p .git\n");
});

afterEach(async () => {
  await harness.cleanup();
});

async function createResearchKb(): Promise<string> {
  const created = await harness.runKb(["new", "research"]);
  expect(created.code).toBe(0);
  return join(harness.home, "kb", "research");
}

test("Unicode source names receive distinct stable Memory targets", async () => {
  await createResearchKb();
  const firstPath = join(harness.cwd, "研究一.txt");
  const secondPath = join(harness.cwd, "研究二.txt");
  await writeFile(firstPath, "one\n");
  await writeFile(secondPath, "two\n");

  const first = await harness.runKb(["add", firstPath, "--in", "research"]);
  const second = await harness.runKb(["add", secondPath, "--in", "research"]);
  const replay = await harness.runKb(["add", firstPath, "--in", "research"]);

  expect(first.code).toBe(0);
  expect(first.stdout).toContain("Memory target: memories/untitled-41030b7daa7d.md");
  expect(first.stdout).toContain("[[memories/untitled-41030b7daa7d.md|研究一]]");
  expect(second.code).toBe(0);
  expect(second.stdout).toContain("Memory target: memories/untitled-71b6f82f0aae.md");
  expect(second.stdout).toContain("[[memories/untitled-71b6f82f0aae.md|研究二]]");
  expect(replay.stdout).toStartWith("Raw source already present:");
});

test("identical adds are truthful idempotent replays with one audit event", async () => {
  const kbDir = await createResearchKb();
  const source = join(harness.cwd, "source.txt");
  await writeFile(source, "same-source\n");

  const first = await harness.runKb(["add", source, "--in", "research"]);
  const second = await harness.runKb(["add", source, "--in", "research"]);

  expect(first.code).toBe(0);
  expect(second).toEqual({
    code: 0,
    stderr: "",
    stdout: `Raw source already present: raw/source-48b972e2f225.txt\n\n${first.stdout}`,
  });
  expect(await readdir(join(kbDir, "raw"))).toEqual(["source-48b972e2f225.txt"]);
  const log = await readFile(join(kbDir, "log.md"), "utf8");
  expect(log.match(/ add \| source-48b972e2f225\.txt/g)).toHaveLength(1);
});

test("concurrent identical adds have one creator and one audit event", async () => {
  const kbDir = await createResearchKb();
  const source = join(harness.cwd, "source.txt");
  await writeFile(source, "same-source\n");

  const results = await Promise.all(
    Array.from({ length: 20 }, () => harness.runKb(["add", source, "--in", "research"])),
  );
  const creators = results.filter((result) => result.stdout.startsWith("Add playbook\n"));
  const replays = results.filter((result) => result.stdout.startsWith("Raw source already present:"));

  expect(results.every((result) => result.code === 0 && result.stderr === "")).toBe(true);
  expect(creators).toHaveLength(1);
  expect(replays).toHaveLength(19);
  expect(await readdir(join(kbDir, "raw"))).toEqual(["source-48b972e2f225.txt"]);
  const log = await readFile(join(kbDir, "log.md"), "utf8");
  expect(log.match(/ add \| source-48b972e2f225\.txt/g)).toHaveLength(1);
});

test("add rejects directories with a controlled diagnostic", async () => {
  const kbDir = await createResearchKb();
  const sourceDir = join(harness.cwd, "not a source");
  await mkdir(sourceDir);

  const result = await harness.runKb(["add", sourceDir, "--in", "research"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: `kb: source is not a file: ${sourceDir}\n`,
  });
  expect(await readdir(join(kbDir, "raw"))).toEqual([]);
});

test("an abandoned Add is durable, visible, resumable, and explicitly completable", async () => {
  const kbDir = await createResearchKb();
  const source = join(harness.cwd, "one.txt");
  await writeFile(source, "one source\n");

  const added = await harness.runKb(["add", source, "--in", "research"]);
  const rawRef = /^Raw source: (raw\/.+)$/m.exec(added.stdout)?.[1];
  expect(rawRef).toBeDefined();

  const status = await harness.runKb(["status", "--in", "research"]);
  expect(status.stdout).toContain("Health: unfinished work");
  expect(status.stdout).toContain(`Resume: kb add --resume ${rawRef} --in research`);

  const resumed = await harness.runKb(["add", "--resume", rawRef!, "--in", "research"]);
  expect(resumed.code).toBe(0);
  expect(resumed.stdout).toContain("Resuming pending Add");
  expect(resumed.stdout).toContain("Memory target: memories/one.md");

  await writeFile(join(kbDir, "memories", "one.md"), "---\ntitle: One\npermalink: one\n---\n\n# One\n");
  await appendFile(
    join(kbDir, "index.md"),
    "\n- [[memories/one.md|One]] | category: source | summary: One source\n",
  );
  const completed = await harness.runKb([
    "add",
    "--complete",
    rawRef!,
    "memories/one.md",
    "--in",
    "research",
  ]);
  expect(completed).toEqual({
    code: 0,
    stdout: `Completed Add handoff: ${rawRef} -> memories/one.md\n`,
    stderr: "",
  });
  expect((await harness.runKb(["status", "--in", "research"])).stdout).toContain("Health: ok");
});

test("an untouched draft is unfinished and excluded from search", async () => {
  await createResearchKb();
  await harness.runKb(["draft", "Never Finished", "--in", "research"]);

  const status = await harness.runKb(["status", "--in", "research"]);
  const search = await harness.runKb(["search", "TODO", "--in", "research"]);
  const resumed = await harness.runKb([
    "draft",
    "--resume",
    "memories/never-finished.md",
    "--in",
    "research",
  ]);

  expect(status.stdout).toContain("Health: unfinished work");
  expect(status.stdout).toContain("Draft: memories/never-finished.md");
  expect(search.stdout).toContain("Results: 0");
  expect(search.stdout).toContain("Run `kb status --in research`");
  expect(resumed.stdout).toContain("Draft playbook");
});

test("Reflect keeps its worklist pending until explicit completion", async () => {
  const kbDir = await createResearchKb();
  const topicPath = join(kbDir, "memories", "topic.md");
  await writeFile(
    topicPath,
    "---\ntitle: Topic\npermalink: topic\n---\n\nChanged fact.\n",
  );
  const topicChangedAt = new Date("2026-07-10T11:00:00.000Z");
  await utimes(topicPath, topicChangedAt, topicChangedAt);

  const first = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: "2026-07-10T12:00:00.000Z" },
  });
  const second = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: "2026-07-11T12:00:00.000Z" },
  });

  expect(first.stdout).toContain("Changed since last reflect: 1");
  expect(first.stdout).toContain("kb reflect --complete --in research");
  expect(second.stdout).toContain("Resuming pending Reflect");
  expect(second.stdout).toContain("memories/topic.md");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("lastReflectAt: null");

  const completed = await harness.runKb(["reflect", "--complete", "--in", "research"]);
  expect(completed.code).toBe(0);
  expect(completed.stdout).toContain("Completed Reflect handoff: 1 Memory");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain(
    "lastReflectAt: 2026-07-10T12:00:00.000Z",
  );
});

test("concurrent external init registrations preserve every successful KB", async () => {
  const paths = Array.from({ length: 8 }, (_, index) => join(harness.root, `external-${index}`));
  await Promise.all(paths.map((path) => mkdir(path)));

  const results = await Promise.all(paths.map((cwd) => harness.run("kb", ["init"], { cwd })));

  expect(results.every((result) => result.code === 0)).toBe(true);
  const registry = await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8");
  for (const path of paths) {
    expect(registry).toContain(`  ${path.split("/").at(-1)}: ${path}`);
  }
});

test("concurrent same-name new leaves one complete registered KB", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () => harness.runKb(["new", "same"])),
  );

  expect(results.filter((result) => result.code === 0)).toHaveLength(1);
  expect(results.filter((result) => result.code === 64)).toHaveLength(11);
  expect((await readdir(join(harness.home, "kb", "same"))).sort()).toEqual([
    ".git",
    "AGENTS.md",
    "index.md",
    "kb.yaml",
    "log.md",
    "memories",
    "raw",
  ]);
  const registry = await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8");
  expect(registry.match(/  same: /g)).toHaveLength(1);
});

test("kb init adopts a valid external KB after Registry loss", async () => {
  const external = join(harness.root, "external");
  await mkdir(external);
  expect((await harness.run("kb", ["init"], { cwd: external })).code).toBe(0);
  const before = await readFile(join(external, "kb.yaml"), "utf8");
  await rm(join(harness.xdgConfigHome, "kb", "config.yaml"));

  const adopted = await harness.run("kb", ["init"], { cwd: external });

  expect(adopted.code).toBe(0);
  expect(adopted.stdout).toContain("Registered existing KB: external");
  expect(await readFile(join(external, "kb.yaml"), "utf8")).toBe(before);
  expect((await harness.runKb(["status", "--in", "external"])).code).toBe(0);
});

test("missing config in a containing KB blocks default fallback", async () => {
  const defaultKb = await createResearchKb();
  const damaged = join(harness.home, "kb", "damaged");
  await mkdir(damaged);
  expect((await harness.run("kb", ["init"], { cwd: damaged })).code).toBe(0);
  await rm(join(damaged, "kb.yaml"));
  const deep = join(damaged, "memories", "deep");
  await mkdir(deep);
  const before = await readFile(join(defaultKb, "log.md"), "utf8");

  const result = await harness.run("kb", ["status"], { cwd: deep });

  expect(result.code).toBe(64);
  expect(result.stderr).toContain(`damaged containing KB at ${damaged}`);
  expect(await readFile(join(defaultKb, "log.md"), "utf8")).toBe(before);
});

test("enable search rejects wiki without invoking the Engine", async () => {
  expect((await harness.runKb(["new", "wiki", "--arm", "wiki"])).code).toBe(0);
  await harness.writeFakeExecutable("bm", "#!/bin/sh\necho called >> \"$HOME/bm-calls\"\n");

  const result = await harness.runKb(["enable", "search", "--in", "wiki"]);

  expect(result.code).toBe(64);
  expect(result.stderr).toContain("wiki curation was not changed");
  expect(await Bun.file(join(harness.home, "bm-calls")).exists()).toBe(false);
});

test("malformed required config is unhealthy and blocks add side effects", async () => {
  const kbDir = await createResearchKb();
  await writeFile(join(kbDir, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm b0
engine:
  basicMemory:
    state disabled
    project: null
lastReflectAt: null
`);
  const source = join(harness.cwd, "source.txt");
  await writeFile(source, "source\n");

  const status = await harness.runKb(["status", "--in", "research"]);
  const add = await harness.runKb(["add", source, "--in", "research"]);

  expect(status.code).toBe(65);
  expect(status.stdout).toContain("Health: invalid kb.yaml");
  expect(add.code).toBe(65);
  expect(await readdir(join(kbDir, "raw"))).toEqual([]);
});

test("concurrent enable search callers execute one Engine transaction", async () => {
  await createResearchKb();
  await harness.writeFakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "project" ]; then echo project-add >> "$HOME/engine-calls"; /bin/sleep 0.1; exit 0; fi
if [ "$1" = "reindex" ]; then echo reindex >> "$HOME/engine-calls"; /bin/sleep 0.1; exit 0; fi
exit 1
`);

  const results = await Promise.all(
    Array.from({ length: 8 }, () => harness.runKb(["enable", "search", "--in", "research"])),
  );

  expect(results.every((result) => result.code === 0)).toBe(true);
  const calls = await readFile(join(harness.home, "engine-calls"), "utf8");
  expect(calls.match(/^project-add$/gm)).toHaveLength(1);
  expect(calls.match(/^reindex$/gm)).toHaveLength(1);
});
