import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import { BasicMemoryAdapter } from "./engine/basic-memory";
import { FORMAT_VERSION, INDEX_LINE_FORMAT, indexLine, memoryFormatPlaybookLines, memoryTemplate } from "./memory-format";

export const VERSION = "0.1.0";

const EXIT_USAGE = 64;
const EXIT_UNAVAILABLE = 69;
const SEARCH_ADVISOR_INDEX_ENTRY_THRESHOLD = 3;
const SCAFFOLD_ARMS = new Set(["wiki", "b0"]);

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
      arm: string | null;
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

  if (parsed.arm !== null && parsed.command !== "new" && parsed.command !== "init") {
    writeError("--arm is only valid with kb new or kb init");
    return EXIT_USAGE;
  }

  if (parsed.command === "new") {
    return createKb(parsed.args, parsed.arm);
  }

  if (parsed.command === "init") {
    return initKb(parsed.args, parsed.arm);
  }

  if (parsed.command === "list") {
    return listKbs();
  }

  if (parsed.command === "enable") {
    return enableKb(parsed.kbName, parsed.args);
  }

  if (parsed.command === "status") {
    return statusKb(parsed.kbName);
  }

  if (parsed.command === "search") {
    return searchKb(parsed.kbName, parsed.args);
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

  if (parsed.command === "reflect") {
    return reflectKb(parsed.kbName, parsed.args);
  }

  if (parsed.command === "defrag") {
    return defragKb(parsed.kbName, parsed.args);
  }

  if (parsed.command === "lint") {
    return lintKb(parsed.kbName, parsed.args);
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
  let arm: string | null = null;
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

    if (arg === "--arm") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: "--arm requires a value" };
      }
      arm = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--arm=")) {
      const value = arg.slice("--arm=".length);
      if (value.length === 0) {
        return { ok: false, message: "--arm requires a value" };
      }
      arm = value;
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

  return { ok: true, help, version, kbName, command, args, guide, arm };
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
  Scaffold Arms: wiki, b0. b1 is reached with kb enable search; b2 is deferred.
  Retrieval favors b0/b1; curation favors wiki.
  Drift tax rises with eager wiki curation; use wiki-arm kb lint and reflect when it does.

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
  Use --arm wiki only when the human has explicitly chosen that Arm.

Usage:
  kb new <name> [--arm wiki|b0]

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
   Scaffold Arms: wiki, b0. b1 is b0 plus the Basic Memory Engine; enable it later over the same files. b2 is deferred because scheduling is not in v1.
`;
}

async function createKb(args: string[], arm: string | null): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb new <name> [--arm wiki|b0]");
    return EXIT_USAGE;
  }

  const selectedArm = validateArm(arm);
  if (selectedArm === null) {
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
    await scaffoldKb(kbDir, name, selectedArm);
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

async function initKb(args: string[], arm: string | null): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb init [--guide] [--arm wiki|b0]");
    return EXIT_USAGE;
  }

  const selectedArm = validateArm(arm);
  if (selectedArm === null) {
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
    await scaffoldKb(cwd, name, selectedArm);
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

function validateArm(arm: string | null): string | null {
  const selected = arm ?? "b0";
  if (selected === "b2") {
    writeError("--arm b2 is deferred for v1; use b1 plus the Advisor maintenance reminders.");
    return null;
  }
  if (selected === "b1") {
    writeError("b1 requires the search engine — create a b0 KB first, then run `kb enable search`.");
    return null;
  }
  if (!SCAFFOLD_ARMS.has(selected)) {
    writeError(`unknown Arm: ${selected} (expected wiki or b0)`);
    return null;
  }
  return selected;
}

async function scaffoldKb(kbDir: string, name: string, arm = "b0"): Promise<void> {
  if (await exists(join(kbDir, "kb.yaml"))) {
    const error = new Error("KB already exists") as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  if (!(await exists(kbDir))) {
    await mkdir(kbDir);
  }
  await Promise.all([
    writeFile(join(kbDir, "kb.yaml"), kbYaml(arm, name), { flag: "wx" }),
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

  const config = await readKbConfig(target.path);
  const counts = await countKbFiles(target.path);
  const health = await healthSummary(target.path);
  const advisor = advisorSuggestions(config, counts);

  process.stdout.write(`KB: ${target.name}
Path: ${target.path}
Arm: ${config.arm}
Engine: ${config.engineState}
Sources: ${counts.sources}
Memories: ${counts.memories}
Index entries: ${counts.indexEntries}
Index size: ${counts.indexBytes} bytes
Health: ${health}
Advisor:
${renderAdvisor(advisor)}
`);
  return 0;
}

async function enableKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 1 || args[0] !== "search") {
    writeError("usage: kb enable search");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const config = await readKbConfig(target.path);
  if (config.engineState === "enabled") {
    process.stdout.write(`Search already enabled for ${target.name}.\n`);
    return 0;
  }

  const enabled = await new BasicMemoryAdapter().enable(target.path, target.name);
  if (!enabled.ok) {
    writeError(`cannot enable search: ${enabled.message}`);
    return EXIT_UNAVAILABLE;
  }

  await writeKbConfig(target.path, { ...config, ...enabled.value });
  process.stdout.write(`Search enabled for ${target.name}.\n`);
  return 0;
}

async function searchKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length === 0) {
    writeError("usage: kb search <query>");
    return EXIT_USAGE;
  }

  const query = args.join(" ").trim();
  if (query.length === 0) {
    writeError("query is required");
    return EXIT_USAGE;
  }
  if (!isSingleLine(query)) {
    writeError("query must be a single line");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const config = await readKbConfig(target.path);
  let results: SearchResult[];
  if (config.engineState === "enabled") {
    const searched = await new BasicMemoryAdapter().search(target.path, config.engineProject ?? target.name, query);
    if (!searched.ok) {
      writeError(`search engine failed; engineless fallback was not used. ${searched.message}`);
      return EXIT_UNAVAILABLE;
    }
    results = searched.value.map((result) => ({ ...result, source: "memory" }));
  } else {
    results = await searchFiles(target.path, query);
  }

  await appendLogEntry(target.path, "query", query);

  process.stdout.write(renderSearchResults(target.name, query, results));
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
  const config = await readKbConfig(target.path);
  process.stdout.write(config.arm === "wiki" ? wikiIngestPlaybook(staged) : ingestPlaybook(staged));
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

async function reflectKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb reflect");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const config = await readKbConfig(target.path);
  const changed = await changedMemoriesSince(target.path, config.lastReflectAt);
  const now = nowInstant();
  await writeLastReflectAt(target.path, now);
  await appendLogEntry(target.path, "reflect", `${changed.length} memories`);
  process.stdout.write(reflectPlaybook(changed));
  return 0;
}

async function defragKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb defrag");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  process.stdout.write(defragPlaybook(await defragCandidates(target.path)));
  return 0;
}

async function lintKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb lint");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --kb <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const config = await readKbConfig(target.path);
  if (config.arm !== "wiki") {
    writeError(`kb lint applies to the wiki Arm; this KB is ${config.arm}`);
    return EXIT_USAGE;
  }

  process.stdout.write(wikiLintReport(await wikiLintIssues(target.path)));
  return 0;
}

function isSafeKbName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== "..";
}

function kbYaml(arm = "b0"): string {
  return `schemaVersion: 1
formatVersion: ${FORMAT_VERSION}
arm: ${arm}
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
${INDEX_LINE_FORMAT}
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

type KbConfig = {
  arm: string;
  engineState: string;
  lastReflectAt: string | null;
  engineProject: string | null;
};

async function readKbConfig(kbPath: string): Promise<KbConfig> {
  const text = await readFile(join(kbPath, "kb.yaml"), "utf8");
  const lastReflectAt = readYamlScalar(text, "lastReflectAt");
  const project = readYamlScalar(text, "project");
  return {
    arm: readYamlScalar(text, "arm") ?? "unknown",
    engineState: readYamlScalar(text, "state") ?? "unknown",
    lastReflectAt: lastReflectAt === null || lastReflectAt === "null" ? null : lastReflectAt,
    engineProject: project === "null" ? null : project,
  };
}

async function writeKbConfig(kbPath: string, config: KbConfig): Promise<void> {
  await writeFile(join(kbPath, "kb.yaml"), `schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: ${config.arm}
engine:
  basicMemory:
    state: ${config.engineState}
    project: ${config.engineProject ?? "null"}
lastReflectAt: ${config.lastReflectAt ?? "null"}
`);
}

function readYamlScalar(text: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m").exec(text);
  return match?.[1]?.trim() ?? null;
}

type KbCounts = {
  sources: number;
  memories: number;
  indexEntries: number;
  indexBytes: number;
};

async function countKbFiles(kbPath: string): Promise<KbCounts> {
  const [sources, memories, index] = await Promise.all([
    countFiles(join(kbPath, "raw")),
    countMarkdownFiles(join(kbPath, "memories")),
    readOptionalFile(join(kbPath, "index.md")),
  ]);

  return {
    sources,
    memories,
    indexEntries: indexEntryLines(index).length,
    indexBytes: Buffer.byteLength(index),
  };
}

async function countFiles(path: string): Promise<number> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).length;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function countMarkdownFiles(path: string): Promise<number> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function healthSummary(kbPath: string): Promise<string> {
  const required = ["kb.yaml", "index.md", "log.md", "raw", "memories"];
  for (const name of required) {
    if (!(await exists(join(kbPath, name)))) {
      return `missing ${name}`;
    }
  }
  return "ok";
}

type SearchResult = {
  ref: string;
  title: string;
  source: "index.md" | "memory";
  match: string;
  score: number;
};

async function searchFiles(kbPath: string, query: string): Promise<SearchResult[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const byRef = new Map<string, SearchResult>();
  const index = await readFile(join(kbPath, "index.md"), "utf8");

  for (const line of indexEntryLines(index)) {
    const parsed = parseIndexLine(line);
    if (parsed === null) {
      continue;
    }
    const score = scoreText(line, terms);
    if (score > 0) {
      byRef.set(parsed.ref, {
        ref: parsed.ref,
        title: parsed.title,
        source: "index.md",
        match: line,
        score,
      });
    }
  }

  for (const entry of await readdir(join(kbPath, "memories"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const ref = `memories/${entry.name}`;
    const text = await readFile(join(kbPath, ref), "utf8");
    const score = scoreText(text, terms);
    if (score === 0) {
      continue;
    }

    const current = byRef.get(ref);
    if (current !== undefined) {
      current.score += score;
      if (current.source !== "index.md") {
        current.source = "memory";
        current.match = firstMatchingLine(text, terms);
      }
      continue;
    }

    byRef.set(ref, {
      ref,
      title: titleFromMemory(text) ?? titleFromSlug(entry.name.slice(0, -".md".length)),
      source: "memory",
      match: firstMatchingLine(text, terms),
      score,
    });
  }

  return [...byRef.values()].sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
}

function renderSearchResults(kbName: string, query: string, results: SearchResult[]): string {
  const lines = [`Search results`, `KB: ${kbName}`, `Query: ${query}`, `Results: ${results.length}`];
  if (results.length === 0) {
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.ref} | ${result.title}`);
    lines.push(`   Source: ${result.source}`);
    lines.push(`   Match: ${result.match}`);
  });
  return `${lines.join("\n")}\n`;
}

function indexEntryLines(index: string): string[] {
  return index.split("\n").filter((line) => line.startsWith("- [[") && !line.includes("<file>"));
}

function parseIndexLine(line: string): { ref: string; title: string } | null {
  const match = /^- \[\[([^|\]]+)\|([^\]]+)\]\]/.exec(line);
  if (match === null) {
    return null;
  }
  return { ref: match[1], title: match[2] };
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + lower.split(term).length - 1, 0);
}

function firstMatchingLine(text: string, terms: string[]): string {
  const line = text.split("\n").find((candidate) => {
    const lower = candidate.toLowerCase();
    return terms.some((term) => lower.includes(term));
  });
  return line?.trim() ?? "";
}

function titleFromMemory(text: string): string | null {
  const title = readYamlScalar(text, "title");
  return title === null || title.length === 0 ? null : title;
}

type MemoryInfo = {
  ref: string;
  title: string;
  slug: string;
  supersededBy: string | null;
  mtimeMs: number;
};

async function listMemories(kbPath: string): Promise<MemoryInfo[]> {
  const memories: MemoryInfo[] = [];
  for (const entry of await readdir(join(kbPath, "memories"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const ref = `memories/${entry.name}`;
    const path = join(kbPath, ref);
    const [text, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    memories.push({
      ref,
      title: titleFromMemory(text) ?? titleFromSlug(entry.name.slice(0, -".md".length)),
      slug: readYamlScalar(text, "permalink") ?? entry.name.slice(0, -".md".length),
      supersededBy: readYamlScalar(text, "superseded_by"),
      mtimeMs: metadata.mtimeMs,
    });
  }
  return memories.sort((a, b) => a.ref.localeCompare(b.ref));
}

async function changedMemoriesSince(kbPath: string, lastReflectAt: string | null): Promise<MemoryInfo[]> {
  const cutoff = lastReflectAt === null ? -Infinity : Date.parse(lastReflectAt);
  return (await listMemories(kbPath)).filter((memory) => memory.mtimeMs > cutoff);
}

async function writeLastReflectAt(kbPath: string, value: string): Promise<void> {
  const path = join(kbPath, "kb.yaml");
  const text = await readFile(path, "utf8");
  const next = /^lastReflectAt: .+$/m.test(text)
    ? text.replace(/^lastReflectAt: .+$/m, `lastReflectAt: ${value}`)
    : `${text.trimEnd()}\nlastReflectAt: ${value}\n`;
  await writeFile(path, next);
}

function reflectPlaybook(changed: MemoryInfo[]): string {
  const lines = ["Reflect playbook", `Changed since last reflect: ${changed.length}`];
  if (changed.length > 0) {
    lines.push(...changed.map((memory) => `- ${memory.ref} | ${memory.title}`));
  }
  lines.push(
    "",
    "Agent half:",
    "1. Read exactly the Memory refs listed above.",
    "2. Write any useful cross-memory synthesis back into memories/ as Basic Memory-compatible Memories.",
    "3. Add or update index.md lines only for Memories you actually create or revise.",
    "4. Do not claim contradiction detection, stale-fact judgment, or semantic consolidation as guaranteed by kb reflect.",
  );
  return `${lines.join("\n")}\n`;
}

type DefragCandidates = {
  duplicateSlugs: Array<{ slug: string; refs: string[] }>;
  orphanMemories: string[];
  danglingIndexRefs: string[];
  archivableSupersededRefs: string[];
};

async function defragCandidates(kbPath: string): Promise<DefragCandidates> {
  const memories = await listMemories(kbPath);
  const memoryRefs = new Set(memories.map((memory) => memory.ref));
  const indexRefs = indexEntryLines(await readFile(join(kbPath, "index.md"), "utf8"))
    .map((line) => parseIndexLine(line)?.ref)
    .filter((ref): ref is string => ref !== undefined);
  const indexRefSet = new Set(indexRefs);
  const bySlug = new Map<string, string[]>();

  for (const memory of memories) {
    const refs = bySlug.get(memory.slug) ?? [];
    refs.push(memory.ref);
    bySlug.set(memory.slug, refs);
  }

  return {
    duplicateSlugs: [...bySlug.entries()]
      .filter(([, refs]) => refs.length > 1)
      .map(([slug, refs]) => ({ slug, refs: refs.sort() }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    orphanMemories: [...memoryRefs].filter((ref) => !indexRefSet.has(ref)).sort(),
    danglingIndexRefs: indexRefs.filter((ref) => !memoryRefs.has(ref)).sort(),
    archivableSupersededRefs: memories.filter((memory) => memory.supersededBy !== null).map((memory) => memory.ref).sort(),
  };
}

function defragPlaybook(candidates: DefragCandidates): string {
  return `Defrag playbook
This command prints a defrag playbook only; it does not move, archive, or delete files.
Deterministic candidates:
Duplicate slugs:
${renderCandidateLines(candidates.duplicateSlugs.map((candidate) => `${candidate.slug}: ${candidate.refs.join(", ")}`))}
Orphan memories not in index.md:
${renderCandidateLines(candidates.orphanMemories)}
Dangling index refs:
${renderCandidateLines(candidates.danglingIndexRefs)}
Archivable superseded refs:
${renderCandidateLines(candidates.archivableSupersededRefs.map((ref) => `${ref} -> archive/${ref}`))}

Agent half:
1. Review only the deterministic candidates above.
2. For superseded facts, move the old Memory to archive/memories/ and add a replacement note; do not delete it.
3. Fix index.md so every indexed Memory exists and every kept Memory has one catalog line.
4. Do not claim kb defrag found semantic duplicates, contradictions, or stale facts.
`;
}

function renderCandidateLines(lines: string[]): string {
  return lines.length === 0 ? "- None\n" : `${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function ingestPlaybook(staged: StagedSource): string {
  const rawRef = `raw/${staged.rawFile}`;
  const memoryRef = `memories/${staged.memoryFile}`;
  const urlBehavior = staged.urlReference
    ? "v1 stages a URL reference only; full HTML archiving is deferred."
    : "local file copied verbatim into raw/.";

  const formatLines = memoryFormatPlaybookLines(memoryRef, staged.title);

  return `Ingest playbook
Raw source: ${rawRef}
Memory target: ${memoryRef}
URL behavior: ${urlBehavior}

Agent half:
1. Read ${rawRef} without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. ${formatLines[0]}
4. ${formatLines[1]}
5. ${formatLines[2]}
6. ${formatLines[3]}
7. ${formatLines[4]}
`;
}

function wikiIngestPlaybook(staged: StagedSource): string {
  const rawRef = `raw/${staged.rawFile}`;
  const memoryRef = `memories/${staged.memoryFile}`;
  const urlBehavior = staged.urlReference
    ? "v1 stages a URL reference only; full HTML archiving is deferred."
    : "local file copied verbatim into raw/.";

  return `Wiki ingest playbook
Raw source: ${rawRef}
Memory target: ${memoryRef}
URL behavior: ${urlBehavior}

Agent half:
1. Read ${rawRef} without editing it.
2. Write or update ${memoryRef} in Basic Memory note format.
3. Update related wiki pages in memories/ and index.md while preserving the raw/derived boundary.
4. Print a contradiction checklist for claims the model thinks may conflict; kb does not guarantee semantic contradiction detection.
5. Add or update one index.md line: ${indexLine(memoryRef, staged.title)}
`;
}

type WikiLintIssues = {
  orphanPages: string[];
  danglingLinks: string[];
  missingCrossReferences: string[];
  staleFlags: string[];
  danglingIndexRefs: string[];
};

async function wikiLintIssues(kbPath: string): Promise<WikiLintIssues> {
  const memories = await listMemories(kbPath);
  const memoryRefs = new Set(memories.map((memory) => memory.ref));
  const knownLinks = new Set<string>();
  for (const memory of memories) {
    knownLinks.add(memory.ref);
    knownLinks.add(memory.ref.replace(/^memories\//, ""));
    knownLinks.add(memory.ref.replace(/^memories\//, "").replace(/\.md$/, ""));
    knownLinks.add(memory.title);
    knownLinks.add(memory.slug);
  }

  const indexRefs = indexEntryLines(await readFile(join(kbPath, "index.md"), "utf8"))
    .map((line) => parseIndexLine(line)?.ref)
    .filter((ref): ref is string => typeof ref === "string");
  const indexRefSet = new Set(indexRefs);
  const danglingLinks: string[] = [];
  const missingCrossReferences: string[] = [];
  const staleFlags: string[] = [];

  for (const memory of memories) {
    const text = await readFile(join(kbPath, memory.ref), "utf8");
    const links = wikiLinks(text);
    if (links.length === 0) {
      missingCrossReferences.push(`${memory.ref} has no [[links]]`);
    }
    for (const link of links) {
      if (!knownLinks.has(link)) {
        danglingLinks.push(`${memory.ref} -> ${link}`);
      }
    }
    for (const key of ["review_after", "stale_after"]) {
      const value = readYamlScalar(text, key);
      if (value !== null && isPastDate(value)) {
        staleFlags.push(`${memory.ref} ${key} ${value}`);
      }
    }
  }

  return {
    orphanPages: [...memoryRefs].filter((ref) => !indexRefSet.has(ref)).sort(),
    danglingLinks: danglingLinks.sort(),
    missingCrossReferences: missingCrossReferences.sort(),
    staleFlags: staleFlags.sort(),
    danglingIndexRefs: indexRefs.filter((ref) => !memoryRefs.has(ref)).sort(),
  };
}

function wikiLinks(text: string): string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function isPastDate(value: string): boolean {
  const date = Date.parse(value);
  return Number.isFinite(date) && date < Date.parse(todayIso());
}

function wikiLintReport(issues: WikiLintIssues): string {
  return `Wiki lint
Deterministic structural issues:
Orphan pages not in index.md:
${renderCandidateLines(issues.orphanPages)}Dangling [[links]]:
${renderCandidateLines(issues.danglingLinks)}Missing cross-references:
${renderCandidateLines(issues.missingCrossReferences)}Stale-by-date flags:
${renderCandidateLines(issues.staleFlags)}Dangling index refs:
${renderCandidateLines(issues.danglingIndexRefs)}
Contradiction review playbook:
1. Review related pages and stale flags above.
2. Print a checklist of claims the model thinks may conflict, with file refs.
3. Update derivatives in memories/ only; never edit raw/.
4. Do not claim kb lint proves semantic contradictions or note quality.
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
  return nowInstant().slice(0, 10);
}

function nowInstant(): string {
  const value = process.env.KB_NOW;
  const date = value === undefined ? new Date() : new Date(value);
  return date.toISOString();
}

function advisorSuggestions(config: KbConfig, counts: KbCounts): string[] {
  const suggestions: string[] = [];

  if (config.engineState !== "enabled" && counts.indexEntries >= SEARCH_ADVISOR_INDEX_ENTRY_THRESHOLD) {
    suggestions.push(
      `Try \`kb enable search\`: ${counts.indexEntries} index entries make hybrid search more useful than plain file search.`,
    );
  }

  if (config.lastReflectAt !== null) {
    const days = Math.floor((Date.parse(nowInstant()) - Date.parse(config.lastReflectAt)) / 86_400_000);
    if (days >= 14) {
      suggestions.push(`Run \`kb reflect\`: last reflect was ${days} days ago.`);
    }
  }

  return suggestions;
}

function renderAdvisor(suggestions: string[]): string {
  if (suggestions.length === 0) {
    return "- No suggestions.";
  }
  return suggestions.map((suggestion) => `- ${suggestion}`).join("\n");
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
