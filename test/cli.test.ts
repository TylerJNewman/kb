import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
  expect(result.stdout).toContain("Implemented Arms: wiki, b0, b1. b2 is deferred");
  expect(result.stdout).toContain("Retrieval favors b0/b1; curation favors wiki");
  expect(result.stdout).toContain("Drift tax");
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

test("kb new --arm wiki scaffolds the wiki Arm", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");

  const result = await harness.runKb(["new", "wiki-research", "--arm", "wiki"]);
  const kbDir = join(harness.home, "kb", "wiki-research");

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: wiki\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
});

test("kb init --arm b1 is accepted and marks the Engine enabled", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");

  const result = await harness.runKb(["init", "--arm", "b1"]);

  expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await readFile(join(harness.cwd, "kb.yaml"), "utf8")).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: enabled
    project: cwd
lastReflectAt: null
`);
});

test("--arm b2 is deferred and unknown Arms fail clearly", async () => {
  const deferred = await harness.runKb(["new", "research", "--arm", "b2"]);
  const unknown = await harness.runKb(["new", "research", "--arm", "wat"]);

  expect(deferred).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: --arm b2 is deferred for v1; use b1 plus the Advisor maintenance reminders.\n",
  });
  expect(unknown).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: unknown Arm: wat (expected wiki, b0, or b1)\n",
  });
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
Engine: disabled
Sources: 0
Memories: 0
Index entries: 0
Index size: 111 bytes
Health: ok
Advisor:
- No suggestions.
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
Engine: disabled
Sources: 0
Memories: 0
Index entries: 0
Index size: 111 bytes
Health: ok
Advisor:
- No suggestions.
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
  expect(result.stdout).toContain("Implemented Arms: wiki, b0, b1.");
  expect(result.stdout).toContain("b2 is deferred");
});

test("kb add <file> stages raw source unchanged, logs ingest, and prints the ingest playbook", async () => {
  await scaffoldResearchKb();
  const source = join(harness.cwd, "source.md");
  const sourceText = "# Source\n\nFact one.\n";
  await writeFile(source, sourceText);

  const result = await harness.runKb(["add", source, "--kb", "research"]);
  const kbDir = join(harness.home, "kb", "research");
  const rawFiles = await readdir(join(kbDir, "raw"));

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(rawFiles).toHaveLength(1);
  expect(rawFiles[0]).toMatch(/^source-[a-f0-9]{12}\.md$/);
  expect(await readFile(join(kbDir, "raw", rawFiles[0]), "utf8")).toBe(sourceText);
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain(`ingest | ${rawFiles[0]}`);
  expect(result.stdout).toBe(`Ingest playbook
Raw source: raw/${rawFiles[0]}
Memory target: memories/source.md
URL behavior: local file copied verbatim into raw/.

Agent half:
1. Read raw/${rawFiles[0]} without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. Write memories/source.md in Basic Memory note format.
4. Include an executive summary of about 150 words or less.
5. Extract observations as "- [category] fact #tag".
6. Extract relations as "- rel [[Target]]".
7. Add or update one index.md line: - [[memories/source.md|Source]] | category: <category> | summary: <one-line summary>
`);
});

test("kb add <url> stages a v1 URL reference instead of archiving HTML", async () => {
  await scaffoldResearchKb();

  const result = await harness.runKb(["add", "https://example.com/articles/a?x=1", "--kb=research"]);
  const kbDir = join(harness.home, "kb", "research");
  const rawFiles = await readdir(join(kbDir, "raw"));

  expect(result.code).toBe(0);
  expect(rawFiles).toHaveLength(1);
  expect(rawFiles[0]).toMatch(/^example-com-articles-a-[a-f0-9]{12}\.url\.md$/);
  expect(await readFile(join(kbDir, "raw", rawFiles[0]), "utf8")).toBe(`# URL Reference

url: https://example.com/articles/a?x=1

v1 behavior: this is a URL reference only, not a full HTML archive.
`);
  expect(result.stdout).toContain("URL behavior: v1 stages a URL reference only; full HTML archiving is deferred.");
});

test("kb add in a wiki KB prints the eager ingest playbook", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "wiki-research", "--arm", "wiki"]);
  const source = join(harness.cwd, "source.md");
  await writeFile(source, "# Source\n\nFact one.\n");

  const result = await harness.runKb(["add", source, "--kb", "wiki-research"]);
  const rawFile = (await readdir(join(harness.home, "kb", "wiki-research", "raw")))[0];

  expect(result).toEqual({
    code: 0,
    stdout: `Wiki ingest playbook
Raw source: raw/${rawFile}
Memory target: memories/source.md
URL behavior: local file copied verbatim into raw/.

Agent half:
1. Read raw/${rawFile} without editing it.
2. Write or update memories/source.md in Basic Memory note format.
3. Update related wiki pages in memories/ and index.md while preserving the raw/derived boundary.
4. Print a contradiction checklist for claims the model thinks may conflict; kb does not guarantee semantic contradiction detection.
5. Add or update one index.md line: - [[memories/source.md|Source]] | category: <category> | summary: <one-line summary>
`,
    stderr: "",
  });
});

test("kb note <title> creates a Basic Memory-compatible memory template", async () => {
  await scaffoldResearchKb();

  const result = await harness.runKb(["note", "Example Memory", "--kb", "research"]);
  const memory = await readFile(join(harness.home, "kb", "research", "memories", "example-memory.md"), "utf8");

  expect(result).toEqual({
    code: 0,
    stdout: "Created memories/example-memory.md\n",
    stderr: "",
  });
  expect(memory).toContain(`---
title: Example Memory
type: note
tags:
  - research
permalink: example-memory
---`);
  expect(memory).toContain("- [summary] TODO #research");
  expect(memory).toContain("- rel [[Target Memory]]");
});

test("kb log appends and reads greppable append-only entries", async () => {
  await scaffoldResearchKb();

  const appended = await harness.runKb(["log", "question | How does this work?", "--kb", "research"]);
  const read = await harness.runKb(["log", "--kb", "research"]);

  expect(appended).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(read.code).toBe(0);
  expect(read.stderr).toBe("");
  expect(read.stdout).toContain("created | research");
  expect(read.stdout).toContain("question | How does this work?");
});

test("kb read <ref> returns the memory and points at the tiered read order", async () => {
  await scaffoldResearchKb();
  await harness.runKb(["note", "Example Memory", "--kb", "research"]);

  const result = await harness.runKb(["read", "example-memory", "--kb", "research"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Tiered read order: index.md -> executive summary -> derivatives in memories/ -> raw sources only when needed.");
  expect(result.stdout).toContain("title: Example Memory");
  expect(result.stdout).toContain("- [summary] TODO #research");
});

test("kb search returns citation-ready refs and appends a query log entry", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "memories", "alpha.md"), `---
title: Alpha Memory
type: note
tags:
  - research
permalink: alpha
---

## Summary

Alpha explains retrieval loops.
`);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha Memory]] | category: research | summary: Retrieval loops and citations.
`);

  const result = await harness.runKb(["search", "retrieval", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `Search results
KB: research
Query: retrieval
Results: 1

1. memories/alpha.md | Alpha Memory
   Source: index.md
   Match: - [[memories/alpha.md|Alpha Memory]] | category: research | summary: Retrieval loops and citations.
`,
    stderr: "",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain("query | retrieval");
});

test("kb search uses Basic Memory when the Engine is enabled and keeps the normalized output contract", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  await harness.writeFakeExecutable(
    "bm",
    `#!/bin/sh
printf 'bm %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "tool" ] && [ "$2" = "search-notes" ]; then
  /bin/cat '${fixturePath("search-entity.json")}'
  exit 0
fi
exit 2
`,
  );

  const result = await harness.runKb(["search", "durable observation", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `Search results
KB: research
Query: durable observation
Results: 1

1. memories/example-memory.md | Example Memory
   Source: memory
   Match: - [summary] One durable observation. #research
- relates_to [[Target Memory]]
`,
    stderr: "",
  });
  expect(await readFile(join(harness.home, "engine-calls"), "utf8")).toBe(
    "bm tool search-notes durable observation --project research\n",
  );
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain("query | durable observation");
});

test("kb search output shape stays stable between engineless and Engine paths", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "memories", "example-memory.md"), `---
title: Example Memory
type: note
tags:
  - research
permalink: example-memory
---

- [summary] One durable observation. #research
`);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
`);
  const engineless = await harness.runKb(["search", "durable observation", "--kb", "research"]);

  await enableSearchInConfig(kbDir);
  await harness.writeFakeExecutable(
    "bm",
    `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
/bin/cat '${fixturePath("search-entity.json")}'
`,
  );
  const engine = await harness.runKb(["search", "durable observation", "--kb", "research"]);

  expect(engineless.code).toBe(0);
  expect(engine.code).toBe(0);
  expect(searchShape(engine.stdout)).toEqual(searchShape(engineless.stdout));
});

test("kb search reports Engine failure explicitly and does not fall back silently", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha Memory]] | category: research | summary: This would match fallback.
`);
  await harness.writeFakeExecutable(
    "bm",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\necho 'missing project' >&2\nexit 1\n",
  );

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. missing project\n",
  });
});

test("kb status prints counts, health, and an empty Advisor slot for fixture state", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "raw", "source.md"), "# Source\n");
  await writeFile(join(kbDir, "memories", "alpha.md"), `---
title: Alpha Memory
type: note
tags:
  - research
permalink: alpha
---
`);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha Memory]] | category: research | summary: Retrieval loops.
`);

  const result = await harness.runKb(["status", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `KB: research
Path: ${kbDir}
Arm: b0
Engine: disabled
Sources: 1
Memories: 1
Index entries: 1
Index size: 197 bytes
Health: ok
Advisor:
- No suggestions.
`,
    stderr: "",
  });
  expect(result.stdout).not.toContain("reflect");
  expect(result.stdout).not.toContain("enable search");
});

test("kb status Advisor suggests enable search at the index threshold only", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");

  await writeFile(join(kbDir, "index.md"), indexWithEntries(2));
  const before = await harness.runKb(["status", "--kb", "research"]);
  expect(before.stdout).toContain("Advisor:\n- No suggestions.");

  await writeFile(join(kbDir, "index.md"), indexWithEntries(3));
  const after = await harness.runKb(["status", "--kb", "research"]);

  expect(after.code).toBe(0);
  expect(after.stderr).toBe("");
  expect(after.stdout).toContain("- Try `kb enable search`: 3 index entries make hybrid search more useful than plain file search.");
});

test("kb enable search lazy-installs Basic Memory, adds the project, reindexes, and flips to B1", async () => {
  await scaffoldResearchKb();
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
printf 'uvx %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "basic-memory" ] && [ "$2" = "--version" ]; then
  /bin/cat > "\${0%/*}/bm" <<'SH'
#!/bin/sh
printf 'bm %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--version" ]; then
  echo "Basic Memory version: 0.22.1"
  exit 0
fi
if [ "$1" = "project" ] && [ "$2" = "add" ]; then
  echo "Project '$3' added successfully"
  exit 0
fi
if [ "$1" = "reindex" ]; then
  echo "Reindex complete!"
  exit 0
fi
exit 2
SH
  /bin/chmod +x "\${0%/*}/bm"
  echo "Basic Memory version: 0.22.1"
  exit 0
fi
if [ "$1" = "--version" ]; then
  echo "uvx 0.0.0"
  exit 0
fi
exit 2
`,
  );

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);
  const kbDir = join(harness.home, "kb", "research");

  expect(result).toEqual({ code: 0, stdout: "Search enabled for research.\n", stderr: "" });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: enabled
    project: research
lastReflectAt: null
`);
  expect(await readFile(join(harness.home, "engine-calls"), "utf8")).toBe(`uvx --version
uvx basic-memory --version
bm project add research ${kbDir}
bm reindex --project research --search
`);
});

test("kb enable search is idempotent once already enabled", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: enabled
    project: research
lastReflectAt: null
`);

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);

  expect(result).toEqual({ code: 0, stdout: "Search already enabled for research.\n", stderr: "" });
});

test("kb enable search fails clearly without uvx and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: uvx is not on PATH. Install uv, then rerun `kb enable search`.\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`);
  expect((await harness.runKb(["status", "--kb", "research"])).stdout).toContain("Arm: b0\nEngine: disabled");
});

test("kb enable search reports install-check failure and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await harness.writeFakeExecutable(
    "uvx",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'uvx 0.0.0'; exit 0; fi\necho 'Basic Memory install failed' >&2\nexit 2\n",
  );

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: Basic Memory install check failed. Basic Memory install failed\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: b0\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
});

test("kb enable search reports reindex failure and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await harness.writeFakeExecutable(
    "bm",
    "#!/bin/sh\nprintf 'bm %s\\n' \"$*\" >> \"$HOME/engine-calls\"\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"project\" ]; then exit 0; fi\necho 'reindex failed' >&2\nexit 1\n",
  );

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: Basic Memory reindex failed. reindex failed\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: b0\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
});

test("engineless loop new add note search read status works with no Engine installed", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  const source = join(harness.cwd, "source.md");
  await writeFile(source, "# Source\n\nFact one supports the minimal loop.\n");

  expect(await harness.runKb(["new", "research"])).toEqual({ code: 0, stdout: "", stderr: "" });
  const added = await harness.runKb(["add", source, "--kb", "research"]);
  expect(added.code).toBe(0);
  expect(await harness.runKb(["note", "Loop Memory", "--kb", "research"])).toEqual({
    code: 0,
    stdout: "Created memories/loop-memory.md\n",
    stderr: "",
  });

  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "memories", "loop-memory.md"), `---
title: Loop Memory
type: note
tags:
  - research
permalink: loop-memory
---

## Summary

Fact one supports the minimal engineless loop.
`);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/loop-memory.md|Loop Memory]] | category: research | summary: Fact one supports the loop.
`);

  const searched = await harness.runKb(["search", "fact one", "--kb", "research"]);
  const read = await harness.runKb(["read", "loop-memory", "--kb", "research"]);
  const status = await harness.runKb(["status", "--kb", "research"]);

  expect(searched.code).toBe(0);
  expect(searched.stdout).toContain("1. memories/loop-memory.md | Loop Memory");
  expect(read.code).toBe(0);
  expect(read.stdout).toContain("title: Loop Memory");
  expect(status.code).toBe(0);
  expect(status.stdout).toContain("Engine: disabled");
  expect(status.stdout).toContain("Advisor:\n- No suggestions.");
});

test("daily commands do not mutate existing raw contents", async () => {
  await scaffoldResearchKb();
  const source = join(harness.cwd, "source.txt");
  await writeFile(source, "original raw bytes\n");
  await harness.runKb(["add", source, "--kb", "research"]);
  const rawFile = (await readdir(join(harness.home, "kb", "research", "raw")))[0];
  const rawPath = join(harness.home, "kb", "research", "raw", rawFile);

  await harness.runKb(["note", "Other", "--kb", "research"]);
  await harness.runKb(["log", "question | Check raw", "--kb", "research"]);
  await harness.runKb(["read", "other", "--kb", "research"]);

  expect(await readFile(rawPath, "utf8")).toBe("original raw bytes\n");
});

test("kb reflect reports memories changed since last reflect, writes marker, logs, and prints playbook", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: 2026-07-01T00:00:00.000Z
`);
  await writeMemory(kbDir, "old.md", "Old Memory", "old");
  await writeMemory(kbDir, "new.md", "New Memory", "new");
  await utimes(join(kbDir, "memories", "old.md"), new Date("2026-06-30T12:00:00.000Z"), new Date("2026-06-30T12:00:00.000Z"));
  await utimes(join(kbDir, "memories", "new.md"), new Date("2026-07-02T12:00:00.000Z"), new Date("2026-07-02T12:00:00.000Z"));

  const result = await harness.run("kb", ["reflect", "--kb", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });

  expect(result).toEqual({
    code: 0,
    stdout: `Reflect playbook
Changed since last reflect: 1
- memories/new.md | New Memory

Agent half:
1. Read exactly the Memory refs listed above.
2. Write any useful cross-memory synthesis back into memories/ as Basic Memory-compatible Memories.
3. Add or update index.md lines only for Memories you actually create or revise.
4. Do not claim contradiction detection, stale-fact judgment, or semantic consolidation as guaranteed by kb reflect.
`,
    stderr: "",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("lastReflectAt: 2026-07-07T12:00:00.000Z");
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain("## [2026-07-07] reflect | 1 memories");
});

test("kb defrag reports deterministic cleanup candidates and mutates nothing", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeMemory(kbDir, "alpha.md", "Alpha", "alpha");
  await writeMemory(kbDir, "alpha-copy.md", "Alpha Copy", "alpha");
  await writeMemory(kbDir, "unindexed.md", "Unindexed", "unindexed");
  await writeMemory(kbDir, "old-fact.md", "Old Fact", "old-fact", "superseded_by: new-fact\n");
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha]] | category: research | summary: Alpha.
- [[memories/missing.md|Missing]] | category: research | summary: Missing.
`);
  const before = await snapshotKb(kbDir);

  const result = await harness.runKb(["defrag", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `Defrag playbook
Deterministic candidates:
Duplicate slugs:
- alpha: memories/alpha-copy.md, memories/alpha.md

Orphan memories not in index.md:
- memories/alpha-copy.md
- memories/old-fact.md
- memories/unindexed.md

Dangling index refs:
- memories/missing.md

Archivable superseded refs:
- memories/old-fact.md -> archive/memories/old-fact.md


Agent half:
1. Review only the deterministic candidates above.
2. For superseded facts, move the old Memory to archive/memories/ and add a replacement note; do not delete it.
3. Fix index.md so every indexed Memory exists and every kept Memory has one catalog line.
4. Do not claim kb defrag found semantic duplicates, contradictions, or stale facts.
`,
    stderr: "",
  });
  expect(await snapshotKb(kbDir)).toEqual(before);
});

test("kb lint reports deterministic structural issues and prints contradiction review playbook", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "wiki-research", "--arm", "wiki"]);
  const kbDir = join(harness.home, "kb", "wiki-research");
  await writeMemory(kbDir, "alpha.md", "Alpha", "alpha", "review_after: 2026-07-01\n", "See [[Missing Page]].\n");
  await writeMemory(kbDir, "orphan.md", "Orphan", "orphan", "", "No links here.\n");
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha]] | category: research | summary: Alpha.
- [[memories/missing-index.md|Missing Index]] | category: research | summary: Missing.
`);

  const result = await harness.run("kb", ["lint", "--kb", "wiki-research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });

  expect(result).toEqual({
    code: 0,
    stdout: `Wiki lint
Deterministic structural issues:
Orphan pages not in index.md:
- memories/orphan.md
Dangling [[links]]:
- memories/alpha.md -> Missing Page
Missing cross-references:
- memories/orphan.md has no [[links]]
Stale-by-date flags:
- memories/alpha.md review_after 2026-07-01
Dangling index refs:
- memories/missing-index.md

Contradiction review playbook:
1. Review related pages and stale flags above.
2. Print a checklist of claims the model thinks may conflict, with file refs.
3. Update derivatives in memories/ only; never edit raw/.
4. Do not claim kb lint proves semantic contradictions or note quality.
`,
    stderr: "",
  });
});

test("Advisor suggests reflect only after the threshold elapses", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeMemory(kbDir, "alpha.md", "Alpha", "alpha");

  const reflected = await harness.run("kb", ["reflect", "--kb", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });
  expect(reflected.code).toBe(0);

  const fresh = await harness.run("kb", ["status", "--kb", "research"], {
    env: { KB_NOW: "2026-07-08T12:00:00.000Z" },
  });
  const stale = await harness.run("kb", ["status", "--kb", "research"], {
    env: { KB_NOW: "2026-07-22T12:00:00.000Z" },
  });

  expect(fresh.stdout).toContain("Advisor:\n- No suggestions.\n");
  expect(stale.stdout).toContain("Advisor:\n- Run `kb reflect`: last reflect was 15 days ago.\n");
});

async function scaffoldResearchKb(): Promise<void> {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "research"]);
}

async function enableSearchInConfig(kbDir: string): Promise<void> {
  await writeFile(join(kbDir, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: enabled
    project: research
lastReflectAt: null
`);
}

function fixturePath(name: string): string {
  return resolve(import.meta.dir, "fixtures", "basic-memory-contract", name);
}

function searchShape(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) =>
      line === "Search results"
      || line.startsWith("KB: ")
      || line.startsWith("Query: ")
      || line.startsWith("Results: ")
      || /^\d+\. memories\/.+ \| .+$/.test(line)
      || line.startsWith("   Source: ")
      || line.startsWith("   Match: ")
    )
    .map((line) =>
      line
        .replace(/^KB: .+$/, "KB: <kb>")
        .replace(/^Query: .+$/, "Query: <query>")
        .replace(/^Results: \d+$/, "Results: <n>")
        .replace(/^   Match: .+$/, "   Match: <match>")
    );
}

async function writeMemory(
  kbDir: string,
  file: string,
  title: string,
  permalink: string,
  extraFrontmatter = "",
  body = "",
): Promise<void> {
  await writeFile(join(kbDir, "memories", file), `---
title: ${title}
type: note
tags:
  - research
permalink: ${permalink}
${extraFrontmatter}---

## Summary

${title}
${body}
`);
}

async function snapshotKb(kbDir: string): Promise<Record<string, string>> {
  const files = ["index.md", "log.md", "kb.yaml"];
  const memories = await readdir(join(kbDir, "memories"));
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    snapshot[file] = await readFile(join(kbDir, file), "utf8");
  }
  for (const file of memories.sort()) {
    const path = join("memories", file);
    snapshot[path] = await readFile(join(kbDir, path), "utf8");
    snapshot[`${path}:mtime`] = String((await stat(join(kbDir, path))).mtimeMs);
  }
  return snapshot;
}

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort();
}

function indexWithEntries(count: number): string {
  const lines = [
    "# KB Index",
    "",
    "Line format:",
    "- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>",
  ];
  for (let i = 1; i <= count; i += 1) {
    lines.push(`- [[memories/memory-${i}.md|Memory ${i}]] | category: research | summary: Entry ${i}.`);
  }
  return `${lines.join("\n")}\n`;
}
