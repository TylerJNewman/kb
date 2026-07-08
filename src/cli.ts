import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, parse, resolve } from "node:path";

export const VERSION = "0.0.0";

const EXIT_USAGE = 64;
const EXIT_UNAVAILABLE = 69;

const PRODUCT_COMMANDS = new Set([
  "new",
  "init",
  "list",
  "status",
  "add",
  "note",
  "search",
  "read",
  "log",
  "enable",
  "reflect",
  "defrag",
  "lint",
]);

type ParseResult =
  | {
      ok: true;
      help: boolean;
      version: boolean;
      kbName: string | null;
      command: string | null;
      args: string[];
      guide: boolean;
    }
  | { ok: false; message: string };

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    writeError(parsed.message);
    return EXIT_USAGE;
  }

  if (parsed.version) {
    process.stdout.write(`kb ${VERSION}\n`);
    return 0;
  }

  if (parsed.help && parsed.command === "new") {
    process.stdout.write(newHelpText());
    return 0;
  }

  if (parsed.command === "init" && parsed.guide) {
    process.stdout.write(initGuideText());
    return 0;
  }

  if (parsed.help || parsed.command === null) {
    process.stdout.write(helpText());
    return 0;
  }

  if (!PRODUCT_COMMANDS.has(parsed.command)) {
    writeError(`unknown command: ${parsed.command}`);
    return EXIT_USAGE;
  }

  if (parsed.command === "new") {
    return createKb(parsed.args);
  }

  if (parsed.command === "init") {
    return initKb(parsed.args);
  }

  if (parsed.command === "list") {
    return listKbs();
  }

  if (parsed.command === "status") {
    return statusKb(parsed.kbName);
  }

  if (parsed.command === "add") {
    return addSource(parsed.kbName, parsed.args);
  }

  if (parsed.command === "note") {
    return createMemoryNote(parsed.kbName, parsed.args);
  }

  if (parsed.command === "log") {
    return logKb(parsed.kbName, parsed.args);
  }

  if (parsed.command === "read") {
    return readMemory(parsed.kbName, parsed.args);
  }

  writeError(`command not implemented in this slice: ${parsed.command}`);
  return EXIT_UNAVAILABLE;
}

function parseArgs(argv: string[]): ParseResult {
  let help = false;
  let version = false;
  let kbName: string | null = null;
  let command: string | null = null;
  let guide = false;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }

    if (arg === "--kb") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: "--kb requires a name" };
      }
      kbName = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--kb=")) {
      const value = arg.slice("--kb=".length);
      if (value.length === 0) {
        return { ok: false, message: "--kb requires a name" };
      }
      kbName = value;
      continue;
    }

    if (arg === "--guide") {
      guide = true;
      continue;
    }

    if (arg.startsWith("-")) {
      return { ok: false, message: `unknown flag: ${arg}` };
    }

    if (command !== null) {
      args.push(arg);
      continue;
    }

    command = arg;
  }

  return { ok: true, help, version, kbName, command, args, guide };
}

function writeError(message: string): void {
  process.stderr.write(`kb: ${message}\n`);
}

function helpText(): string {
  return `kb ${VERSION}

Create and grow local-first markdown knowledge bases. A KB is a folder you own:
raw sources stay immutable in raw/, derivatives live in memories/, and the CLI
keeps the catalog and log consistent.

Usage:
  kb [--kb <name>] <command> [flags]
  kb new <name>
  kb --help
  kb --version

Global flags:
  --kb <name>    Target a named KB from the Registry.
  --help         Print this help text.
  --version      Print the CLI version.

Commands:
  new init list status add note search read log enable reflect defrag lint

Rules of thumb:
  Start with: kb new research
  kb new creates under KB Home: ~/kb/<name>/; kb init scaffolds the cwd.
  The default Arm is b0: plain markdown, Basic Memory format, Engine disabled.

Conventions:
  stdout is for requested output and playbooks.
  stderr is for errors and diagnostics.
  usage errors exit 64; unavailable router stubs exit 69.
`;
}

function newHelpText(): string {
  return `kb new <name>

Create a new KB under KB Home: ~/kb/<name>/.

A KB is a portable git repo of markdown:
  raw/       immutable raw sources; agents read, never edit
  memories/  derivatives written from raw sources
  index.md   fixed-line catalog for cheap navigation
  log.md     append-only history with greppable entries

Default behavior:
  Arm: b0
  Engine: disabled
  Git: initialized silently unless the KB is already inside a git repo

Usage:
  kb new <name>

Name must be one path segment, for example: research, papers-2026.
`;
}

function initGuideText(): string {
  return `KB chooser

1. Retrieval or curation?
   Choose b0 when you mostly need to retrieve and summarize memories later.
   Choose wiki when you want a hand-maintained overview that stays readable page by page.

2. Corpus size?
   Start with b0 for a small or uncertain corpus. Enable search later when grep and index reading feel too thin.

3. Will you maintain it by hand?
   If yes, wiki can fit. If no, use b0 and let the Advisor suggest reflect or search when the pain is real.

Rule of thumb
   Default to b0 unless the human explicitly wants a curated wiki. b1 is b0 plus the Basic Memory Engine; enable it later over the same files.
`;
}

async function createKb(args: string[]): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb new <name>");
    return EXIT_USAGE;
  }

  const name = args[0];
  if (!isSafeKbName(name)) {
    writeError("KB name must be one path segment using letters, numbers, dot, dash, or underscore");
    return EXIT_USAGE;
  }

  const kbHome = join(homedir(), "kb");
  const kbDir = join(kbHome, name);

  try {
    await mkdir(kbHome, { recursive: true });
    await scaffoldKb(kbDir, name);
    await registerKb(name, kbDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      writeError(`KB already exists: ${kbDir}`);
      return EXIT_USAGE;
    }
    writeError(error instanceof Error ? error.message : String(error));
    return EXIT_UNAVAILABLE;
  }

  return 0;
}

async function initKb(args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb init [--guide]");
    return EXIT_USAGE;
  }

  const cwd = resolve(process.cwd());
  if (cwd === resolve(homedir()) || cwd === parse(cwd).root) {
    writeError("refusing to scaffold a KB here; use `kb new <name>` from home or root");
    return EXIT_USAGE;
  }

  const name = basename(cwd);
  if (!isSafeKbName(name)) {
    writeError("current directory name is not a safe KB name");
    return EXIT_USAGE;
  }

  try {
    await scaffoldKb(cwd, name);
    await registerKb(name, cwd);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      writeError(`KB already exists: ${cwd}`);
      return EXIT_USAGE;
    }
    writeError(error instanceof Error ? error.message : String(error));
    return EXIT_UNAVAILABLE;
  }

  return 0;
}

async function scaffoldKb(kbDir: string, name: string): Promise<void> {
  if (await exists(join(kbDir, "kb.yaml"))) {
    const error = new Error("KB already exists") as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  if (!(await exists(kbDir))) {
    await mkdir(kbDir);
  }
  await Promise.all([
    writeFile(join(kbDir, "kb.yaml"), kbYaml(), { flag: "wx" }),
    writeFile(join(kbDir, "AGENTS.md"), agentsMd(), { flag: "wx" }),
    writeFile(join(kbDir, "index.md"), indexMd(), { flag: "wx" }),
    writeFile(join(kbDir, "log.md"), logMd(name), { flag: "wx" }),
    mkdir(join(kbDir, "raw")),
    mkdir(join(kbDir, "memories")),
  ]);

  if (!(await isInsideGitRepo(kbDir))) {
    const code = await runSilent("git", ["init"], kbDir);
    if (code !== 0) {
      throw new Error("git init failed");
    }
  }
}

async function listKbs(): Promise<number> {
  const registry = await loadRegistry();
  if (registry.kbs.size === 0) {
    process.stdout.write("No KBs found.\n");
    return 0;
  }

  const lines = [...registry.kbs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, path]) => `${name === registry.defaultKb ? "* " : "  "}${name} ${path}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function statusKb(kbName: string | null): Promise<number> {
  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  process.stdout.write(`KB: ${target.name}\nPath: ${target.path}\nArm: b0\n`);
  return 0;
}

async function addSource(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb add <file-or-url>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const input = args[0];
  const staged = isUrl(input) ? await stageUrlReference(target.path, input) : await stageFileSource(target.path, input);
  if (staged === null) {
    return EXIT_USAGE;
  }

  await appendLogEntry(target.path, "ingest", staged.rawFile);
  process.stdout.write(ingestPlaybook(staged));
  return 0;
}

async function createMemoryNote(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb note <title>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const title = args[0].trim();
  if (title.length === 0) {
    writeError("title is required");
    return EXIT_USAGE;
  }
  if (!isSingleLine(title)) {
    writeError("title must be a single line");
    return EXIT_USAGE;
  }

  const slug = slugify(title);
  const file = `${slug}.md`;
  try {
    await writeFile(join(target.path, "memories", file), memoryTemplate(title, slug), { flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      writeError(`Memory already exists: memories/${file}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  process.stdout.write(`Created memories/${file}\n`);
  return 0;
}

async function logKb(kbName: string | null, args: string[]): Promise<number> {
  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  if (args.length === 0) {
    process.stdout.write(await readFile(join(target.path, "log.md"), "utf8"));
    return 0;
  }

  if (args.length !== 1) {
    writeError("usage: kb log [entry]");
    return EXIT_USAGE;
  }
  if (!isSingleLine(args[0])) {
    writeError("log entry must be a single line");
    return EXIT_USAGE;
  }

  await appendFile(join(target.path, "log.md"), `## [${todayIso()}] ${args[0]}\n`);
  return 0;
}

async function readMemory(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb read <ref>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const memoryPath = await resolveMemoryRef(target.path, args[0]);
  if (memoryPath === null) {
    writeError(`memory not found: ${args[0]}`);
    return EXIT_USAGE;
  }

  process.stdout.write(`Tiered read order: index.md -> executive summary -> derivatives in memories/ -> raw sources only when needed.\n\n`);
  process.stdout.write(await readFile(memoryPath, "utf8"));
  return 0;
}

function isSafeKbName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== "..";
}

function kbYaml(): string {
  return `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`;
}

function agentsMd(): string {
  return `# KB Agent Instructions

Use the \`kb\` CLI for this Knowledge Base.

Raw/derived boundary: never modify files in \`raw/\`. Write derivatives in \`memories/\` through the CLI workflow.
`;
}

function indexMd(): string {
  return `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
`;
}

function logMd(name: string): string {
  return `# KB Log

## [${todayIso()}] created | ${name}
`;
}

type StagedSource = {
  rawFile: string;
  memoryFile: string;
  title: string;
  urlReference: boolean;
};

async function stageFileSource(kbPath: string, input: string): Promise<StagedSource | null> {
  try {
    const sourcePath = resolve(input);
    const bytes = await readFile(sourcePath);
    const parsed = parse(sourcePath);
    const title = titleFromSlug(slugify(parsed.name));
    const hash = shortHash(bytes);
    const rawFile = `${slugify(parsed.name)}-${hash}${parsed.ext}`;
    await writeRawIfMissing(kbPath, rawFile, bytes);
    return {
      rawFile,
      memoryFile: `${slugify(parsed.name)}.md`,
      title,
      urlReference: false,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      writeError(`source not found: ${input}`);
      return null;
    }
    throw error;
  }
}

async function stageUrlReference(kbPath: string, url: string): Promise<StagedSource> {
  const parsed = new URL(url);
  const slug = slugify(`${parsed.hostname}${parsed.pathname}`);
  const rawFile = `${slug}-${shortHash(url)}.url.md`;
  const content = `# URL Reference

url: ${url}

v1 behavior: this is a URL reference only, not a full HTML archive.
`;
  await writeRawIfMissing(kbPath, rawFile, content);
  return {
    rawFile,
    memoryFile: `${slug}.md`,
    title: titleFromSlug(slug),
    urlReference: true,
  };
}

async function writeRawIfMissing(kbPath: string, rawFile: string, content: string | Buffer): Promise<void> {
  const path = join(kbPath, "raw", rawFile);
  if (await exists(path)) {
    return;
  }
  await writeFile(path, content, { flag: "wx" });
}

async function appendLogEntry(kbPath: string, verb: string, title: string): Promise<void> {
  await appendFile(join(kbPath, "log.md"), `## [${todayIso()}] ${verb} | ${title}\n`);
}

function ingestPlaybook(staged: StagedSource): string {
  const rawRef = `raw/${staged.rawFile}`;
  const memoryRef = `memories/${staged.memoryFile}`;
  const urlBehavior = staged.urlReference
    ? "v1 stages a URL reference only; full HTML archiving is deferred."
    : "local file copied verbatim into raw/.";

  return `Ingest playbook
Raw source: ${rawRef}
Memory target: ${memoryRef}
URL behavior: ${urlBehavior}

Agent half:
1. Read ${rawRef} without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. Write ${memoryRef} in Basic Memory note format.
4. Include an executive summary of about 150 words or less.
5. Extract observations as "- [category] fact #tag".
6. Extract relations as "- rel [[Target]]".
7. Add or update one index.md line: - [[${memoryRef}|${staged.title}]] | category: <category> | summary: <one-line summary>
`;
}

function memoryTemplate(title: string, slug: string): string {
  return `---
title: ${title}
type: note
tags:
  - research
permalink: ${slug}
---

## Summary

TODO

## Observations

- [summary] TODO #research

## Relations

- rel [[Target Memory]]
`;
}

async function resolveMemoryRef(kbPath: string, ref: string): Promise<string | null> {
  const candidates = [
    ref,
    `${ref}.md`,
    join("memories", ref),
    join("memories", `${ref}.md`),
    join("memories", `${slugify(ref)}.md`),
  ].map((candidate) => resolve(kbPath, candidate));

  for (const candidate of candidates) {
    if (!candidate.startsWith(`${resolve(kbPath)}/`)) {
      continue;
    }
    if (extname(candidate) === ".md" && (await exists(candidate))) {
      return candidate;
    }
  }

  return null;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function shortHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "untitled" : slug;
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function isSingleLine(value: string): boolean {
  return !/[\r\n]/.test(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function isInsideGitRepo(path: string): Promise<boolean> {
  let current = resolve(path);
  const root = parse(current).root;

  while (true) {
    if (await exists(join(current, ".git"))) {
      return true;
    }
    if (current === root) {
      return false;
    }
    current = dirname(current);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

type Registry = {
  defaultKb: string | null;
  kbs: Map<string, string>;
};

async function registerKb(name: string, path: string): Promise<void> {
  const registry = await loadRegistry();
  registry.kbs.set(name, path);
  registry.defaultKb ??= name;
  await writeRegistry(registry);
}

async function loadRegistry(): Promise<Registry> {
  const path = registryPath();
  try {
    return parseRegistry(await readFile(path, "utf8"));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const registry = await scanKbHome();
  if (registry.kbs.size > 0) {
    await writeRegistry(registry);
  }
  return registry;
}

function parseRegistry(text: string): Registry {
  let defaultKb: string | null = null;
  const kbs = new Map<string, string>();
  let inKbs = false;

  for (const line of text.split("\n")) {
    if (line.startsWith("default: ")) {
      const value = line.slice("default: ".length).trim();
      defaultKb = value === "null" ? null : value;
      continue;
    }
    if (line === "kbs:") {
      inKbs = true;
      continue;
    }
    if (inKbs) {
      const match = /^  ([A-Za-z0-9._-]+): (.+)$/.exec(line);
      if (match) {
        kbs.set(match[1], match[2]);
      }
    }
  }

  return { defaultKb, kbs };
}

async function writeRegistry(registry: Registry): Promise<void> {
  await mkdir(dirname(registryPath()), { recursive: true });
  const lines = [`default: ${registry.defaultKb ?? "null"}`, "kbs:"];
  for (const [name, path] of [...registry.kbs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name}: ${path}`);
  }
  await writeFile(registryPath(), `${lines.join("\n")}\n`);
}

async function scanKbHome(): Promise<Registry> {
  const kbHome = join(homedir(), "kb");
  const kbs = new Map<string, string>();
  try {
    for (const entry of await readdir(kbHome, { withFileTypes: true })) {
      if (entry.isDirectory() && isSafeKbName(entry.name) && (await exists(join(kbHome, entry.name, "kb.yaml")))) {
        kbs.set(entry.name, join(kbHome, entry.name));
      }
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return { defaultKb: [...kbs.keys()].sort()[0] ?? null, kbs };
}

async function resolveTargetKb(kbName: string | null): Promise<{ name: string; path: string } | null> {
  const registry = await loadRegistry();
  if (kbName !== null) {
    const path = registry.kbs.get(kbName);
    return path === undefined ? null : { name: kbName, path };
  }

  const cwdKb = await findContainingKb(process.cwd());
  if (cwdKb !== null) {
    return cwdKb;
  }

  if (registry.defaultKb !== null) {
    const path = registry.kbs.get(registry.defaultKb);
    if (path !== undefined) {
      return { name: registry.defaultKb, path };
    }
  }

  return null;
}

async function findContainingKb(start: string): Promise<{ name: string; path: string } | null> {
  let current = resolve(start);
  const root = parse(current).root;

  while (true) {
    if (await exists(join(current, "kb.yaml"))) {
      return { name: basename(current), path: current };
    }
    if (current === root) {
      return null;
    }
    current = dirname(current);
  }
}

function registryPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "kb", "config.yaml");
}

async function runSilent(cmd: string, args: string[], cwd: string): Promise<number> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    return await proc.exited;
  } catch {
    return 127;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
