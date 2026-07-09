import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INDEX_LINE_FORMAT, indexLine } from "../src/memory-format";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

const MULTI_PROCESS_TEST_TIMEOUT_MS = 20_000;

beforeEach(async () => {
  harness = await createKbHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

async function packageVersion(root = resolve(import.meta.dir, "..")): Promise<string> {
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  return metadata.version;
}

function isolatedKbEnv(root: string, path = join(root, "path")): Record<string, string> {
  return {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    PATH: path,
  };
}

async function runCopiedRepoKb(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return runProcess(process.execPath, [join(root, "bin/kb"), ...args], {
    cwd: root,
    env: isolatedKbEnv(root),
  });
}

async function copyRunnableRepoCli(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kb-version-test-")));
  await Promise.all([
    cp(resolve(import.meta.dir, "../src"), join(root, "src"), { recursive: true }),
    cp(resolve(import.meta.dir, "../bin"), join(root, "bin"), { recursive: true }),
    cp(resolve(import.meta.dir, "../package.json"), join(root, "package.json")),
    mkdir(join(root, "home")),
    mkdir(join(root, "xdg")),
    mkdir(join(root, "path")),
  ]);
  return root;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, stdout, stderr };
}

test("kb --help exits 0 and writes the golden help surface to stdout", async () => {
  const result = await harness.runKb(["--help"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Create and grow local-first markdown knowledge bases.");
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("kb <command> [args] [--in <name>]");
  expect(result.stdout).toContain("Learning:");
  expect(result.stdout).toContain("Create:");
  expect(result.stdout).toContain("Add:");
  expect(result.stdout).toContain("Ask:");
  expect(result.stdout).toContain("Maintain:");
  expect(result.stdout).toContain("enable search  Enable Basic Memory search over existing files.");
  expect(result.stdout).toContain("Targeting:");
  expect(result.stdout).toContain("Start with: kb start");
  expect(result.stdout).toContain("kb start prints the first-run path");
  expect(result.stdout).toContain("kb new creates under KB Home: ~/kb/<name>/");
  expect(result.stdout).toContain("The default Arm is b0");
  expect(result.stdout).toContain("Scaffold Arms: wiki, b0. b1 is reached with kb enable search; b2 is deferred.");
  expect(result.stdout).toContain("Retrieval favors b0/b1; curation favors wiki");
  expect(result.stdout).toContain("Drift tax");
  expect(result.stdout).toContain("stdout is for requested output and playbooks.");
});

test("kb --version exits 0 and writes only the version to stdout", async () => {
  const result = await harness.runKb(["--version"]);
  const version = await packageVersion();

  expect(result).toEqual({
    code: 0,
    stdout: `kb ${version}\n`,
    stderr: "",
  });
});

test("kb -V is version and bare -v is not a public alias", async () => {
  const version = await harness.runKb(["-V"]);
  const verbose = await harness.runKb(["-v"]);
  const expectedVersion = await packageVersion();

  expect(version).toEqual({
    code: 0,
    stdout: `kb ${expectedVersion}\n`,
    stderr: "",
  });
  expect(verbose).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: unknown flag: -v\n",
  });
});

test("global --kb flag is accepted before a command is routed", async () => {
  const result = await harness.runKb(["--kb", "research", "--version"]);
  const version = await packageVersion();

  expect(result).toEqual({
    code: 0,
    stdout: `kb ${version}\n`,
    stderr: "",
  });
});

test("kb --version follows a package-only version change", async () => {
  const root = await copyRunnableRepoCli();
  try {
    const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    metadata.version = "9.8.7";
    await writeFile(join(root, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);

    const result = await runCopiedRepoKb(root, ["--version"]);

    expect(result).toEqual({
      code: 0,
      stdout: "kb 9.8.7\n",
      stderr: "",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kb --version fails explicitly when package metadata is missing", async () => {
  const root = await copyRunnableRepoCli();
  try {
    await rm(join(root, "package.json"));

    const result = await runCopiedRepoKb(root, ["--version"]);

    expect(result.code).toBe(69);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("kb: cannot read package metadata");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packed npm artifact kb --version matches installed package metadata and repository output", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kb-packed-version-test-")));
  const packDir = join(root, "pack");
  const installPrefix = join(root, "install");
  const binDir = join(root, "bin");
  const npmEnv = {
    npm_config_cache: join(root, "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };

  try {
    await Promise.all([
      mkdir(packDir),
      mkdir(installPrefix),
      mkdir(binDir),
      mkdir(join(root, "home")),
      mkdir(join(root, "xdg")),
    ]);
    await writeFile(join(binDir, "bun"), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });

    const pack = await runProcess("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: resolve(import.meta.dir, ".."),
      env: npmEnv,
    });
    expect(pack.code, pack.stderr).toBe(0);

    const [packed] = JSON.parse(pack.stdout) as Array<{ filename: string }>;
    const tarball = join(packDir, packed.filename);
    const install = await runProcess("npm", ["install", "--ignore-scripts", "--prefix", installPrefix, tarball], {
      cwd: root,
      env: npmEnv,
    });
    expect(install.code, install.stderr).toBe(0);

    const installedMetadata = JSON.parse(
      await readFile(join(installPrefix, "node_modules/@tylerjnewman/kb/package.json"), "utf8"),
    ) as { version: string };
    const packedKb = join(installPrefix, "node_modules/.bin/kb");
    const packedVersion = await runProcess(packedKb, ["--version"], {
      cwd: root,
      env: isolatedKbEnv(root, binDir),
    });
    const repositoryVersion = await harness.runKb(["--version"]);

    expect(packedVersion).toEqual({
      code: 0,
      stdout: `kb ${installedMetadata.version}\n`,
      stderr: "",
    });
    expect(packedVersion.stdout).toBe(repositoryVersion.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

for (const command of [
  ["start"],
  ["new"],
  ["init"],
  ["list"],
  ["add"],
  ["draft"],
  ["search"],
  ["read"],
  ["status"],
  ["log"],
  ["enable"],
  ["reflect"],
  ["check"],
]) {
  test(`kb ${command.join(" ")} has command-specific help`, async () => {
    const result = await harness.runKb([...command, "--help"]);
    expect(result.code, command.join(" ")).toBe(0);
    expect(result.stderr, command.join(" ")).toBe("");
    expect(result.stdout, command.join(" ")).toContain(`kb ${command.join(" ")}`);
    expect(result.stdout, command.join(" ")).toContain("Usage:");
    expect(result.stdout, command.join(" ")).toContain("Rules of thumb:");
  });
}


test("kb start on an empty environment prints create-your-first guidance", async () => {
  const result = await harness.runKb(["start"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("First run");
  expect(result.stdout).toContain(`KB Home: ${join(harness.home, "kb")}`);
  expect(result.stdout).toContain("1. Create your first KB.");
  expect(result.stdout).toContain("kb new research");
  expect(result.stdout).toContain("kb add hello.txt");
  expect(result.stdout).toContain("Agent step: follow the printed Playbook.");
  expect(result.stdout).toContain(`Write the Memory in ${join(harness.home, "kb", "research", "memories")}`);
  expect(result.stdout).toContain('kb search "hello world"');
  expect(result.stdout).toContain("kb status");
});

test("kb start --help prints start help", async () => {
  const result = await harness.runKb(["start", "--help"]);

  expect(result).toEqual({
    code: 0,
    stdout: `kb start

Print a non-interactive first-run walkthrough for a new user or their agent.

Usage:
  kb start

What it teaches:
  new -> add -> agent writes Memory from the playbook -> search -> status

Rules of thumb:
  Prints a first-run walkthrough; does not modify files.
`,
    stderr: "",
  });
});

test("kb new research creates the B0 scaffold and initializes git silently", async () => {
  await harness.writeFakeExecutable(
    "git",
    "#!/bin/sh\nprintf '%s %s\\n' \"$PWD\" \"$*\" >> \"$HOME/git-calls\"\n/bin/mkdir .git\n",
  );

  const result = await harness.runKb(["new", "research"]);
  const kbDir = join(harness.home, "kb", "research");

  expect(result).toEqual({
    code: 0,
    stdout: `Created KB: research
Path: ${kbDir}
Default: research
Next: kb add <file-or-url>
`,
    stderr: "",
  });
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

  expect(result.stdout).toBe(`Created KB: wiki-research
Path: ${kbDir}
Default: wiki-research
Next: kb add <file-or-url>
`);
  expect(result.stderr).toBe("");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: wiki\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
});

test("kb init --arm b1 is rejected because enabling search owns Engine state", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");

  const result = await harness.runKb(["init", "--arm", "b1"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: b1 requires the search engine — create a b0 KB first, then run `kb enable search`.\n",
  });
  await expect(readFile(join(harness.cwd, "kb.yaml"), "utf8")).rejects.toThrow();
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
    stderr: "kb: unknown Arm: wat (expected wiki or b0)\n",
  });
});

test("kb new does not git init when the KB is already inside a git repo", async () => {
  await mkdir(join(harness.home, "kb", ".git"), { recursive: true });
  await harness.writeFakeExecutable(
    "git",
    "#!/bin/sh\necho should-not-run >&2\nexit 1\n",
  );

  const result = await harness.runKb(["new", "research"]);

  expect(result.stdout).toBe(`Created KB: research
Path: ${join(harness.home, "kb", "research")}
Default: research
Next: kb add <file-or-url>
`);
  expect(result.stderr).toBe("");
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

  expect(result).toEqual({
    code: 0,
    stdout: `Initialized KB in ${harness.cwd}
Next: kb add <file-or-url>
`,
    stderr: "",
  });
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
  expect((await readdir(harness.home)).filter((entry) => entry !== "Library")).toEqual([]);
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
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

test("kb start with an existing KB lists it and suggests the next step", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "index.md"), indexWithEntries(3));

  const result = await harness.runKb(["start"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Known KBs:\n* research ");
  expect(result.stdout).toContain(kbDir);
  expect(result.stdout).toContain("Suggested next step for research:");
  expect(result.stdout).toContain("- Try `kb enable search`: 3 index entries make hybrid search more useful than plain file search.");
  expect(result.stdout).toContain("kb add hello.txt");
  expect(result.stdout).toContain(`Write the Memory in ${join(kbDir, "memories")}`);
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
Arm: b0 (plain markdown)
Search: plain files
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

test("--in resolves from an unrelated cwd and --kb remains a hidden alias", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  await harness.runKb(["new", "research"]);

  const modern = await harness.runKb(["--in", "research", "status"]);
  const alias = await harness.runKb(["status", "--kb=research"]);

  expect(modern.code).toBe(0);
  expect(modern.stdout).toContain("KB: research\n");
  expect(alias.code).toBe(0);
  expect(alias.stdout).toContain("KB: research\n");
});

test("target and command-specific flags are rejected where meaningless", async () => {
  const target = await harness.runKb(["new", "research", "--in", "other"]);
  const guide = await harness.runKb(["start", "--guide"]);
  const arm = await harness.runKb(["status", "--arm", "wiki"]);

  expect(target).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: --in is not valid with kb new; that command does not target an existing KB\n",
  });
  expect(guide).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: --guide is only valid with kb init\n",
  });
  expect(arm).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: --arm is only valid with kb new or kb init\n",
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
Arm: b0 (plain markdown)
Search: plain files
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
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

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
  expect(result.stdout).toContain("Scaffold Arms: wiki, b0.");
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
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain(`add | ${rawFiles[0]}`);
  expect(result.stdout).toBe(`Add playbook
Raw source: raw/${rawFiles[0]}
Memory target: memories/source.md
URL behavior: local file copied verbatim into raw/.

Agent half:
1. Read raw/${rawFiles[0]} without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. Write memories/source.md in Basic Memory note format.
4. Include an executive summary of about 150 words or less.
5. Extract observations as "- [category] fact #tag".
6. Extract relations as "- relates_to [[Target]]".
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
    stdout: `Wiki add playbook
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

test("kb draft <title> creates a Basic Memory-compatible memory template", async () => {
  await scaffoldResearchKb();

  const result = await harness.runKb(["draft", "Example Memory", "--kb", "research"]);
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
  expect(memory).toContain("- relates_to [[Target Memory]]");
});

test("kb draft round-trips natural Memory titles through the note frontmatter", async () => {
  await scaffoldResearchKb();
  const title = `: "Quoted" # Hash 研究 [draft]`;

  const result = await harness.runKb(["draft", title, "--kb", "research"]);
  const kbDir = join(harness.home, "kb", "research");
  const memoryFiles = await readdir(join(kbDir, "memories"));

  expect(result).toEqual({
    code: 0,
    stdout: "Created memories/m-c0de2b2e61fa.md\n",
    stderr: "",
  });
  expect(memoryFiles).toEqual(["m-c0de2b2e61fa.md"]);
  expect(await readFile(join(kbDir, "memories", "m-c0de2b2e61fa.md"), "utf8")).toContain(`---
title: ": \\"Quoted\\" # Hash 研究 [draft]"
type: note
tags:
  - research
permalink: m-c0de2b2e61fa
---`);
});

test("kb draft preserves YAML implicit scalar titles as strings", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");

  for (const [title, file] of [
    ["true", "true.md"],
    ["null", "null.md"],
    ["123", "123.md"],
    ["2026-07-09", "2026-07-09.md"],
  ] as const) {
    const result = await harness.runKb(["draft", title, "--kb", "research"]);

    expect(result).toEqual({ code: 0, stdout: `Created memories/${file}\n`, stderr: "" });
    expect(await readFile(join(kbDir, "memories", file), "utf8")).toContain(`title: "${title}"`);
  }
});

test("kb draft rejects ambiguous catalog titles before creating files", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");

  for (const title of ["Pipe | Title", "Closing ]] Title", "Control\u0001Title"]) {
    const result = await harness.runKb(["draft", title, "--kb", "research"]);

    expect(result).toEqual({
      code: 64,
      stdout: "",
      stderr: "kb: title contains characters that cannot be represented unambiguously in the catalog\n",
    });
    expect(await readdir(join(kbDir, "memories"))).toEqual([]);
  }
});

test("kb draft creates deterministic collision-resistant slugs for non-ASCII and punctuation titles", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");

  const unicode = await harness.runKb(["draft", "研究", "--kb", "research"]);
  const punctuation = await harness.runKb(["draft", "!!!", "--kb", "research"]);

  expect(unicode).toEqual({ code: 0, stdout: "Created memories/m-4ff0f1dda80f.md\n", stderr: "" });
  expect(punctuation).toEqual({ code: 0, stdout: "Created memories/m-e84c538e7fe2.md\n", stderr: "" });
  expect((await readdir(join(kbDir, "memories"))).sort()).toEqual(["m-4ff0f1dda80f.md", "m-e84c538e7fe2.md"]);
});

test("kb note remains a hidden alias for draft", async () => {
  await scaffoldResearchKb();

  const result = await harness.runKb(["note", "Alias Memory", "--in", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: "Created memories/alias-memory.md\n",
    stderr: "",
  });
  expect(await readFile(join(harness.home, "kb", "research", "memories", "alias-memory.md"), "utf8")).toContain("title: Alias Memory");
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
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

test("kb read <ref> returns the memory and points at the tiered read order", async () => {
  await scaffoldResearchKb();
  await harness.runKb(["draft", "Example Memory", "--kb", "research"]);

  const result = await harness.runKb(["read", "example-memory", "--kb", "research"]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Tiered read order: index.md -> executive summary -> derivatives in memories/ -> raw sources only when needed.");
  expect(result.stdout).toContain("title: Example Memory");
  expect(result.stdout).toContain("- [summary] TODO #research");
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

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
   Matched in: index.md
   Match: - [[memories/alpha.md|Alpha Memory]] | category: research | summary: Retrieval loops and citations.
`,
    stderr: "",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toContain("query | retrieval");
});

test("kb search uses the pinned Basic Memory runner when the Engine is enabled and keeps the normalized output contract", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
printf 'uvx %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ] && [ "$4" = "tool" ] && [ "$5" = "search-notes" ]; then
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
   Matched in: memory
   Match: - [summary] One durable observation. #research - relates_to [[Target Memory]]
`,
    stderr: "",
  });
  expect(await readFile(join(harness.home, "engine-calls"), "utf8")).toBe(
    "uvx --from basic-memory==0.22.1 bm tool search-notes durable observation --project research\n",
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
    "uvx",
    `#!/bin/sh
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  /bin/cat '${fixturePath("search-entity.json")}'
  exit 0
fi
exit 2
`,
  );
  const engine = await harness.runKb(["search", "durable observation", "--kb", "research"]);

  expect(engineless.code).toBe(0);
  expect(engine.code).toBe(0);
  expect(searchShape(engine.stdout)).toEqual(searchShape(engineless.stdout));
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

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
    "uvx",
    "#!/bin/sh\nif [ \"$1\" = \"--from\" ] && [ \"$2\" = \"basic-memory==0.22.1\" ] && [ \"$3\" = \"bm\" ]; then echo 'missing project' >&2; exit 1; fi\nexit 2\n",
  );

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. Basic Memory search failed. missing project\n",
  });
});

test("kb search distinguishes missing uvx without fallback or query logging", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  const beforeLog = await readFile(join(kbDir, "log.md"), "utf8");

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. uvx is not on PATH. Install uv, then rerun this command.\n",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toBe(beforeLog);
});

test("kb search distinguishes malformed Engine JSON without fallback or query logging", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  const beforeLog = await readFile(join(kbDir, "log.md"), "utf8");
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  /bin/cat '${fixturePath("search-non-json.txt")}'
  exit 0
fi
exit 2
`,
  );

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. Basic Memory search returned non-JSON output.\n",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toBe(beforeLog);
});

test("kb search distinguishes Engine JSON error output without fallback or query logging", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  const beforeLog = await readFile(join(kbDir, "log.md"), "utf8");
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  /bin/cat '${fixturePath("search-json-error.json")}'
  exit 0
fi
exit 2
`,
  );

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. Basic Memory search returned an error. project unavailable\n",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toBe(beforeLog);
});

test("kb search distinguishes missing Engine results without fallback or query logging", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  const beforeLog = await readFile(join(kbDir, "log.md"), "utf8");
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  /bin/cat '${fixturePath("search-missing-results.json")}'
  exit 0
fi
exit 2
`,
  );

  const result = await harness.runKb(["search", "fallback", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. Basic Memory search JSON did not include results.\n",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toBe(beforeLog);
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
Arm: b0 (plain markdown)
Search: plain files
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
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

test("kb enable search runs availability, project add, and reindex through one pinned Basic Memory runner", async () => {
  await scaffoldResearchKb();
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
printf 'uvx %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  shift 3
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

  expect(result).toEqual({ code: 0, stdout: "Search enabled for research. Arm: b1. Existing files unchanged.\n", stderr: "" });
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
uvx --from basic-memory==0.22.1 bm --version
uvx --from basic-memory==0.22.1 bm project add research ${kbDir}
uvx --from basic-memory==0.22.1 bm reindex --project research --search
`);
});

test("populated B0 enables B1 search with zero content migration", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const sourcePaths = [
    join(harness.cwd, "alpha.md"),
    join(harness.cwd, "beta.md"),
    join(harness.cwd, "gamma.md"),
  ];
  await Promise.all([
    writeFile(sourcePaths[0], "# Alpha\n\nsharedterm alpha source.\n"),
    writeFile(sourcePaths[1], "# Beta\n\nsharedterm beta source.\n"),
    writeFile(sourcePaths[2], "# Gamma\n\nsharedterm gamma source.\n"),
  ]);

  for (const sourcePath of sourcePaths) {
    expect((await harness.runKb(["add", sourcePath, "--kb", "research"])).code).toBe(0);
  }

  for (const title of ["Alpha Memory", "Beta Memory", "Gamma Memory"]) {
    expect((await harness.runKb(["draft", title, "--kb", "research"])).code).toBe(0);
  }
  await writeMemory(kbDir, "alpha-memory.md", "Alpha Memory", "alpha-memory", "", "\n- [summary] sharedterm alpha memory. #research\n- relates_to [[Beta Memory]]\n");
  await writeMemory(kbDir, "beta-memory.md", "Beta Memory", "beta-memory", "", "\n- [summary] sharedterm beta memory. #research\n- relates_to [[Gamma Memory]]\n");
  await writeMemory(kbDir, "gamma-memory.md", "Gamma Memory", "gamma-memory", "", "\n- [summary] sharedterm gamma memory. #research\n- relates_to [[Alpha Memory]]\n");
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
${INDEX_LINE_FORMAT}
${indexLine("memories/alpha-memory.md", "Alpha Memory", "research", "sharedterm alpha memory.")}
${indexLine("memories/beta-memory.md", "Beta Memory", "research", "sharedterm beta memory.")}
${indexLine("memories/gamma-memory.md", "Gamma Memory", "research", "sharedterm gamma memory.")}
`);

  const beforeSearch = await harness.runKb(["search", "sharedterm", "--kb", "research"]);
  expect(beforeSearch.code).toBe(0);
  const beforeRefs = searchRefs(beforeSearch.stdout);
  expect(beforeRefs).toEqual(["memories/alpha-memory.md", "memories/beta-memory.md", "memories/gamma-memory.md"]);
  const beforeHashes = await contentHashes(kbDir);

  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
printf 'uvx %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  shift 3
fi
if [ "$1" = "--version" ]; then
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
if [ "$1" = "tool" ] && [ "$2" = "search-notes" ]; then
  /bin/cat <<'JSON'
{"results":[
  {"title":"Alpha Memory","file_path":"memories/alpha-memory.md","matched_chunk":"sharedterm alpha memory.","score":0.9},
  {"title":"Beta Memory","file_path":"memories/beta-memory.md","matched_chunk":"sharedterm beta memory.","score":0.8},
  {"title":"Gamma Memory","file_path":"memories/gamma-memory.md","matched_chunk":"sharedterm gamma memory.","score":0.7}
]}
JSON
  exit 0
fi
exit 2
`,
  );

  const enabled = await harness.runKb(["enable", "search", "--kb", "research"]);
  expect(enabled).toEqual({ code: 0, stdout: "Search enabled for research. Arm: b1. Existing files unchanged.\n", stderr: "" });
  const afterHashes = await contentHashes(kbDir);
  const changed = changedHashes(beforeHashes, afterHashes);
  expect(changed).toEqual(["kb.yaml"]);
  for (const ref of ["raw/", "memories/", "index.md", "log.md"]) {
    expect(changed.some((path) => path === ref || path.startsWith(ref))).toBe(false);
  }

  const afterSearch = await harness.runKb(["search", "sharedterm", "--kb", "research"]);
  expect(afterSearch.code).toBe(0);
  expect(searchRefs(afterSearch.stdout)).toEqual(beforeRefs);
  expect(await readFile(join(harness.home, "engine-calls"), "utf8")).toContain(
    "uvx --from basic-memory==0.22.1 bm tool search-notes sharedterm --project research\n",
  );
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

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

test("commands reject malformed KB configuration before doing work", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const before = await readFile(join(kbDir, "kb.yaml"), "utf8");
  await writeFile(join(kbDir, "kb.yaml"), before.replace("schemaVersion: 1", "schemaVersion: 2"));

  const result = await harness.runKb(["status", "--kb", "research"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: invalid kb.yaml: unsupported schemaVersion: 2\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(before.replace("schemaVersion: 1", "schemaVersion: 2"));
});

test("configuration validation rejects representative unsupported required-value shapes without mutation", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const valid = await readFile(join(kbDir, "kb.yaml"), "utf8");
  const cases = [
    {
      content: valid.replace("formatVersion: basic-memory-note-v1", "formatVersion: future-v2"),
      error: "unsupported formatVersion: future-v2",
    },
    {
      content: valid.replace("formatVersion: basic-memory-note-v1\n", ""),
      error: "missing formatVersion",
    },
    {
      content: valid.replace("arm: b0", "arm: b0\narm: b0"),
      error: "duplicate arm",
    },
    {
      content: valid.replace("arm: b0", "arm: mystery"),
      error: "unknown arm: mystery",
    },
    {
      content: valid.replace("state: disabled", "state: mystery"),
      error: "unknown Engine state: mystery",
    },
    {
      content: valid.replace("  basicMemory:", "  unrelated:"),
      error: "missing basicMemory",
    },
  ];

  for (const scenario of cases) {
    await writeFile(join(kbDir, "kb.yaml"), scenario.content);
    const result = await harness.runKb(["status", "--kb", "research"]);
    expect(result).toEqual({
      code: 64,
      stdout: "",
      stderr: `kb: invalid kb.yaml: ${scenario.error}\n`,
    });
    expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(scenario.content);
  }
});

test("contradictory Engine state is rejected instead of defaulting to unknown", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`);

  const result = await harness.runKb(["search", "anything", "--kb", "research"]);

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: invalid kb.yaml: unsupported state combination: arm b1 requires enabled Engine with a project\n",
  });
});

test("invalid reflect timestamps fail before mutation", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const malformed = `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: someday
`;
  await writeFile(join(kbDir, "kb.yaml"), malformed);

  const result = await harness.run("kb", ["reflect", "--kb", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });

  expect(result).toEqual({
    code: 64,
    stdout: "",
    stderr: "kb: invalid kb.yaml: invalid lastReflectAt: someday\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(malformed);
  expect(await readFile(join(kbDir, "log.md"), "utf8")).not.toContain("reflect");
});

test("kb enable search fails clearly without uvx and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "raw", "existing.md"), "# Existing content\n");
  const beforeHashes = await contentHashes(kbDir);

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
  expect(await contentHashes(kbDir)).toEqual(beforeHashes);
  expect((await harness.runKb(["status", "--kb", "research"])).stdout).toContain("Arm: b0 (plain markdown)\nSearch: plain files");
});

test("kb enable search reports uvx availability failure and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const beforeHashes = await contentHashes(kbDir);
  await harness.writeFakeExecutable(
    "uvx",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'uvx is broken' >&2; exit 2; fi\nexit 2\n",
  );

  const result = await harness.runKb(["enable", "search", "--kb", "research"]);

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: uvx availability failed. uvx is broken\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: b0\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
  expect(await contentHashes(kbDir)).toEqual(beforeHashes);
});

test("kb enable search reports install-check failure and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "raw", "existing.md"), "# Existing content\n");
  const beforeHashes = await contentHashes(kbDir);
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
  expect(await contentHashes(kbDir)).toEqual(beforeHashes);
});

test("kb enable search reports reindex failure and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await harness.writeFakeExecutable(
    "uvx",
    "#!/bin/sh\nprintf 'uvx %s\\n' \"$*\" >> \"$HOME/engine-calls\"\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"--from\" ] && [ \"$2\" = \"basic-memory==0.22.1\" ] && [ \"$3\" = \"bm\" ]; then shift 3; fi\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"project\" ]; then exit 0; fi\necho 'reindex failed' >&2\nexit 1\n",
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

test("kb enable search times out, kills the Engine process tree, and leaves the KB in B0", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeFile(join(kbDir, "raw", "existing.md"), "# Existing content\n");
  const beforeHashes = await contentHashes(kbDir);
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then shift 3; fi
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "project" ]; then
  /bin/sh -c '/bin/sleep 60' &
  echo "$!" > "$HOME/engine-child-pid"
  wait
fi
exit 2
`,
  );

  const result = await harness.run("kb", ["enable", "search", "--kb", "research"], {
    env: { KB_ENGINE_TIMEOUT_MS: "100" },
  });

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: Basic Memory project add timed out after 100ms.\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("arm: b0\n");
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toContain("state: disabled\n");
  expect(await contentHashes(kbDir)).toEqual(beforeHashes);
  expect(await processIsRunning(Number((await readFile(join(harness.home, "engine-child-pid"), "utf8")).trim()))).toBe(false);
});

test("kb search times out without engineless fallback or a successful query log entry", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await enableSearchInConfig(kbDir);
  await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/alpha.md|Alpha Memory]] | category: research | summary: This would match fallback.
`);
  const beforeLog = await readFile(join(kbDir, "log.md"), "utf8");
  await harness.writeFakeExecutable(
    "uvx",
    `#!/bin/sh
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then
  /bin/sh -c '/bin/sleep 60' &
  echo "$!" > "$HOME/engine-child-pid"
  wait
fi
exit 2
`,
  );

  const result = await harness.run("kb", ["search", "fallback", "--kb", "research"], {
    env: { KB_ENGINE_TIMEOUT_MS: "500" },
  });

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: search engine failed; engineless fallback was not used. Basic Memory search timed out after 500ms.\n",
  });
  expect(await readFile(join(kbDir, "log.md"), "utf8")).toBe(beforeLog);
  expect(await processIsRunning(Number((await readFile(join(harness.home, "engine-child-pid"), "utf8")).trim()))).toBe(false);
});

test("configuration replacement failure leaves prior config parseable and removes temp files", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  await writeEngineStubs();
  const before = await readFile(join(kbDir, "kb.yaml"), "utf8");

  const result = await harness.run("kb", ["enable", "search", "--kb", "research"], {
    env: { KB_FAIL_CONFIG_COMMIT: "before-rename" },
  });

  expect(result).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: cannot enable search: config commit failed before atomic replacement\n",
  });
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(before);
  expect((await readdir(kbDir)).filter((entry) => entry.startsWith(".kb.yaml."))).toEqual([]);
  expect((await harness.runKb(["status", "--kb", "research"])).code).toBe(0);
});

test("injected configuration write and lock failures preserve config and remove owned artifacts", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const before = await readFile(join(kbDir, "kb.yaml"), "utf8");
  const cases: Array<{ env: Record<string, string>; error: string }> = [
    { env: { KB_FAIL_CONFIG_COMMIT: "before-write" }, error: "config commit failed before temporary write" },
    { env: { KB_FAIL_CONFIG_LOCK: "1" }, error: "config lock acquisition failed" },
    { env: { KB_FAIL_CONFIG_LOCK: "after-mkdir" }, error: "config lock owner write failed: injected owner write failure" },
  ];

  for (const scenario of cases) {
    const result = await harness.run("kb", ["reflect", "--kb", "research"], {
      env: { ...scenario.env, KB_NOW: "2026-07-07T12:00:00.000Z" },
    });
    expect(result).toEqual({ code: 69, stdout: "", stderr: `kb: ${scenario.error}\n` });
    expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(before);
    expect((await readdir(kbDir)).filter((entry) => entry.startsWith(".kb.yaml."))).toEqual([]);
  }
});

test("configuration lock recovery never steals a live lock and does recover a dead owner", async () => {
  await scaffoldResearchKb();
  const kbDir = join(harness.home, "kb", "research");
  const lockDir = join(kbDir, ".kb.yaml.lock");
  await mkdir(lockDir);
  await writeFile(join(lockDir, "owner"), JSON.stringify({ pid: process.pid, createdAt: 0 }));

  const blocked = await harness.run("kb", ["reflect", "--kb", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });
  expect(blocked).toEqual({ code: 69, stdout: "", stderr: "kb: config lock acquisition timed out\n" });
  expect(await stat(lockDir)).toBeDefined();

  await writeFile(join(lockDir, "owner"), JSON.stringify({ pid: 2_147_483_647, createdAt: 0 }));
  const recovered = await harness.run("kb", ["reflect", "--kb", "research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });
  expect(recovered.code).toBe(0);
  expect((await readdir(kbDir)).filter((entry) => entry.startsWith(".kb.yaml."))).toEqual([]);
});

test("concurrent reflect metadata and Engine transition preserve both updates", async () => {
  await scaffoldResearchKb();
  await writeMemory(join(harness.home, "kb", "research"), "concurrent.md", "Concurrent Memory", "concurrent");
  await writeSlowEngineStubs();
  const kbDir = join(harness.home, "kb", "research");

  const [enabled, reflected] = await Promise.all([
    harness.runKb(["enable", "search", "--kb", "research"]),
    harness.run("kb", ["reflect", "--kb", "research"], {
      env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
    }),
  ]);

  expect(enabled.code).toBe(0);
  expect(reflected.code).toBe(0);
  expect(await readFile(join(kbDir, "kb.yaml"), "utf8")).toBe(`schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b1
engine:
  basicMemory:
    state: enabled
    project: research
lastReflectAt: 2026-07-07T12:00:00.000Z
`);
});

test("engineless loop new add draft search read status works with no Engine installed", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  const source = join(harness.cwd, "source.md");
  await writeFile(source, "# Source\n\nFact one supports the minimal loop.\n");

  expect((await harness.runKb(["new", "research"])).code).toBe(0);
  const added = await harness.runKb(["add", source, "--kb", "research"]);
  expect(added.code).toBe(0);
  expect(await harness.runKb(["draft", "Loop Memory", "--kb", "research"])).toEqual({
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
  expect(status.stdout).toContain("Search: plain files");
  expect(status.stdout).toContain("Advisor:\n- No suggestions.");
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

test("daily commands do not mutate existing raw contents", async () => {
  await scaffoldResearchKb();
  const source = join(harness.cwd, "source.txt");
  await writeFile(source, "original raw bytes\n");
  await harness.runKb(["add", source, "--kb", "research"]);
  const rawFile = (await readdir(join(harness.home, "kb", "research", "raw")))[0];
  const rawPath = join(harness.home, "kb", "research", "raw", rawFile);

  await harness.runKb(["draft", "Other", "--kb", "research"]);
  await harness.runKb(["log", "question | Check raw", "--kb", "research"]);
  await harness.runKb(["read", "other", "--kb", "research"]);

  expect(await readFile(rawPath, "utf8")).toBe("original raw bytes\n");
}, MULTI_PROCESS_TEST_TIMEOUT_MS);

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

test("kb check reports deterministic cleanup candidates and mutates nothing", async () => {
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

  const result = await harness.runKb(["check", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `Check playbook
This command prints deterministic structural candidates and an agent review playbook only; it does not move, archive, delete, or prove semantic issues.
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
4. Do not claim kb check found semantic duplicates, contradictions, or stale facts.
`,
    stderr: "",
  });
  expect(await snapshotKb(kbDir)).toEqual(before);
});

test("kb check works on non-wiki Arms", async () => {
  await scaffoldResearchKb();

  const result = await harness.runKb(["check", "--kb", "research"]);

  expect(result).toEqual({
    code: 0,
    stdout: `Check playbook
This command prints deterministic structural candidates and an agent review playbook only; it does not move, archive, delete, or prove semantic issues.
Deterministic candidates:
Duplicate slugs:
- None

Orphan memories not in index.md:
- None

Dangling index refs:
- None

Archivable superseded refs:
- None



Agent half:
1. Review only the deterministic candidates above.
2. For superseded facts, move the old Memory to archive/memories/ and add a replacement note; do not delete it.
3. Fix index.md so every indexed Memory exists and every kept Memory has one catalog line.
4. Do not claim kb check found semantic duplicates, contradictions, or stale facts.
`,
    stderr: "",
  });
});

test("kb check reports deterministic structural issues and prints contradiction review playbook", async () => {
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

  const result = await harness.run("kb", ["check", "--kb", "wiki-research"], {
    env: { KB_NOW: "2026-07-07T12:00:00.000Z" },
  });

  expect(result).toEqual({
    code: 0,
    stdout: `Check playbook
This command prints deterministic structural candidates and an agent review playbook only; it does not move, archive, delete, or prove semantic issues.
Deterministic candidates:
Duplicate slugs:
- None

Orphan memories not in index.md:
- memories/orphan.md

Dangling index refs:
- memories/missing-index.md

Archivable superseded refs:
- None

Wiki structural candidates:
Dangling [[links]]:
- memories/alpha.md -> Missing Page
Missing cross-references:
- memories/orphan.md has no [[links]]
Stale-by-date flags:
- memories/alpha.md review_after 2026-07-01



Agent half:
1. Review only the deterministic candidates above.
2. For superseded facts, move the old Memory to archive/memories/ and add a replacement note; do not delete it.
3. Fix index.md so every indexed Memory exists and every kept Memory has one catalog line.
4. Do not claim kb check found semantic duplicates, contradictions, or stale facts.
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

async function writeEngineStubs(): Promise<void> {
  await harness.writeFakeExecutable(
    "uvx",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"--from\" ] && [ \"$2\" = \"basic-memory==0.22.1\" ] && [ \"$3\" = \"bm\" ]; then shift 3; fi\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"project\" ]; then exit 0; fi\nif [ \"$1\" = \"reindex\" ]; then exit 0; fi\nexit 2\n",
  );
}

async function writeSlowEngineStubs(): Promise<void> {
  await harness.writeFakeExecutable(
    "uvx",
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"--from\" ] && [ \"$2\" = \"basic-memory==0.22.1\" ] && [ \"$3\" = \"bm\" ]; then shift 3; fi\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nif [ \"$1\" = \"project\" ]; then /bin/sleep 0.2; exit 0; fi\nif [ \"$1\" = \"reindex\" ]; then /bin/sleep 0.2; exit 0; fi\nexit 2\n",
  );
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
      || line.startsWith("   Matched in: ")
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

async function processIsRunning(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  const result = Bun.spawn(["/bin/kill", "-0", String(pid)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return await result.exited === 0;
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

function searchRefs(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => /^\d+\. ([^ ]+) \| /.exec(line)?.[1])
    .filter((ref): ref is string => typeof ref === "string");
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
