import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import { BasicMemoryAdapter } from "./engine/basic-memory";
import { withFileLock } from "./file-lock";
import { FORMAT_VERSION, INDEX_LINE_FORMAT, indexLine, memoryFormatPlaybookLines, memoryTemplate } from "./memory-format";

const packageJson = createRequire(import.meta.url)("../package.json") as { version: string };
export const VERSION = packageJson.version;

const EXIT_USAGE = 64;
const EXIT_DATAERR = 65;
const EXIT_UNAVAILABLE = 69;
const SEARCH_ADVISOR_INDEX_ENTRY_THRESHOLD = 3;
const SCAFFOLD_ARMS = new Set(["wiki", "b0"]);

const PRODUCT_COMMANDS = new Set([
  "start",
  "new",
  "init",
  "list",
  "status",
  "add",
  "draft",
  "search",
  "read",
  "log",
  "enable",
  "reflect",
  "check",
]);

const HIDDEN_COMMAND_ALIASES: Record<string, string> = {
  note: "draft",
  defrag: "check",
  lint: "check",
};

class CliError extends Error {
  constructor(message: string, readonly exitCode = EXIT_USAGE) {
    super(message);
  }
}

type ParseResult =
  | {
      ok: true;
      help: boolean;
      version: boolean;
      kbName: string | null;
      targetFlag: "--in" | "--kb" | null;
      command: string | null;
      args: string[];
      guide: boolean;
      arm: string | null;
      resumeRef: string | null;
      complete: boolean;
    }
  | { ok: false; message: string };

export async function main(argv: string[]): Promise<number> {
  try {
    return await runMain(argv);
  } catch (error) {
    if (error instanceof CliError) {
      writeError(error.message);
      return error.exitCode;
    }
    throw error;
  }
}

async function runMain(argv: string[]): Promise<number> {
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

  if (parsed.help && parsed.command === "init") {
    process.stdout.write(initHelpText());
    return 0;
  }

  if (parsed.help && parsed.command === "start") {
    process.stdout.write(startHelpText());
    return 0;
  }

  if (parsed.help && parsed.command !== null) {
    const text = commandHelpText(parsed.command);
    if (text === null) {
      writeError(`unknown command: ${parsed.command}`);
      return EXIT_USAGE;
    }
    process.stdout.write(text);
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

  if (parsed.targetFlag !== null && ["new", "init", "list", "start"].includes(parsed.command)) {
    writeError(`${parsed.targetFlag} is not valid with kb ${parsed.command}; that command does not target an existing KB`);
    return EXIT_USAGE;
  }

  if (parsed.guide && parsed.command !== "init") {
    writeError("--guide is only valid with kb init");
    return EXIT_USAGE;
  }

  if (parsed.arm !== null && parsed.command !== "new" && parsed.command !== "init") {
    writeError("--arm is only valid with kb new or kb init");
    return EXIT_USAGE;
  }

  if (parsed.resumeRef !== null && parsed.command !== "add" && parsed.command !== "draft") {
    writeError("--resume is only valid with kb add or kb draft");
    return EXIT_USAGE;
  }

  if (parsed.complete && parsed.command !== "add" && parsed.command !== "reflect") {
    writeError("--complete is only valid with kb add or kb reflect");
    return EXIT_USAGE;
  }

  if (parsed.complete && parsed.resumeRef !== null) {
    writeError("--complete and --resume cannot be used together");
    return EXIT_USAGE;
  }

  if (parsed.command === "new") {
    return createKb(parsed.args, parsed.arm);
  }

  if (parsed.command === "start") {
    return startKb(parsed.args);
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
    return addSource(parsed.kbName, parsed.args, parsed.resumeRef, parsed.complete);
  }

  if (parsed.command === "draft") {
    return createMemoryNote(parsed.kbName, parsed.args, parsed.resumeRef);
  }

  if (parsed.command === "log") {
    return logKb(parsed.kbName, parsed.args);
  }

  if (parsed.command === "read") {
    return readMemory(parsed.kbName, parsed.args);
  }

  if (parsed.command === "reflect") {
    return reflectKb(parsed.kbName, parsed.args, parsed.complete);
  }

  if (parsed.command === "check") {
    return checkKb(parsed.kbName, parsed.args);
  }

  writeError(`command not implemented in this slice: ${parsed.command}`);
  return EXIT_UNAVAILABLE;
}

function parseArgs(argv: string[]): ParseResult {
  let help = false;
  let version = false;
  let kbName: string | null = null;
  let targetFlag: "--in" | "--kb" | null = null;
  let command: string | null = null;
  let guide = false;
  let arm: string | null = null;
  let resumeRef: string | null = null;
  let complete = false;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--version" || arg === "-V") {
      version = true;
      continue;
    }

    if (arg === "--in" || arg === "--kb") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: `${arg} requires a name` };
      }
      kbName = value;
      targetFlag = arg;
      i += 1;
      continue;
    }

    if (arg.startsWith("--in=") || arg.startsWith("--kb=")) {
      const flag = arg.startsWith("--in=") ? "--in" : "--kb";
      const value = arg.slice(`${flag}=`.length);
      if (value.length === 0) {
        return { ok: false, message: `${flag} requires a name` };
      }
      kbName = value;
      targetFlag = flag;
      continue;
    }

    if (arg === "--guide") {
      guide = true;
      continue;
    }

    if (arg === "--resume") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, message: "--resume requires a ref" };
      }
      resumeRef = value;
      i += 1;
      continue;
    }

    if (arg === "--complete") {
      complete = true;
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

    command = HIDDEN_COMMAND_ALIASES[arg] ?? arg;
  }

  return { ok: true, help, version, kbName, targetFlag, command, args, guide, arm, resumeRef, complete };
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
  kb <command> [args] [--in <name>]
  kb --help
  kb --version

Global flags:
  --in <name>    Target a named KB from the Registry.
  --help         Print this help text.
  --version      Print the CLI version.
  -V             Print the CLI version.

Learning:
  start          Prints a first-run walkthrough; does not modify files.

Create:
  new            Create a KB under KB Home.
  init           Initialize a KB in the current directory.

Add:
  add            Bring in a raw source.
  draft          Create a blank Memory for the agent to write.

Ask:
  search         Search the current or targeted KB.
  read           Read one Memory by ref.
  status         Show KB state and Advisor suggestions.
  list           List known KBs.
  log            Read or append the KB log.

Maintain:
  enable search  Enable Basic Memory search over existing files.
  reflect        Print a reflect plan for changed Memories.
  check          Print deterministic structural candidates and an agent playbook.

Targeting:
  Default target: the KB you're inside (cwd), else your default KB.
  Use --in <name> only to target another KB.

Rules of thumb:
  Start with: kb start
  kb start prints the first-run path: new -> add -> agent writes Memory -> search -> status.
  kb new creates under KB Home: ~/kb/<name>/; kb init scaffolds the cwd.
  The default Arm is b0: plain markdown, engine-compatible Memory format, Engine disabled.
  Scaffold Arms: wiki, b0. b1 is reached with kb enable search; b2 is deferred.
  Retrieval favors b0/b1; curation favors wiki.
  Drift tax rises with eager wiki curation; use kb check and reflect when it does.

Conventions:
  stdout is for requested output and playbooks.
  stderr is for errors and diagnostics.
  usage errors exit 64; unavailable dependency/integration failures exit 69.
`;
}

function startHelpText(): string {
  return `kb start

Print a non-interactive first-run walkthrough for a new user or their agent.

Usage:
  kb start

What it teaches:
  new -> add an existing source -> agent follows the playbook -> status/search

Rules of thumb:
  Optional and read-only: prints text; does not create or change files.
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
  Search: plain files
  Git: initialized silently unless the KB is already inside a git repo
  Use --arm wiki only when the human has explicitly chosen that Arm.

Usage:
  kb new <name> [--arm wiki|b0]

Rules of thumb:
  Git must be on PATH because kb new initializes the KB as a git repo.
  Omit --arm for the default b0 KB. Use --arm wiki only when the human has explicitly chosen it.
  Name must be one path segment, for example: research, papers-2026.
`;
}

function initHelpText(): string {
  return `kb init

Initialize a KB in the current directory.

Usage:
  kb init [--guide] [--arm wiki|b0]

Rules of thumb:
  Use this inside an existing project or folder you already want as a KB.
  Use kb new <name> when you want kb to choose ~/kb/<name>/ for you.
  --guide prints the non-interactive Arm chooser and does not modify files.
`;
}

function commandHelpText(command: string): string | null {
  const help: Record<string, string> = {
    list: `kb list

List known KBs from the Registry.

Usage:
  kb list

Rules of thumb:
  Does not target a KB. If none exist, create one with kb new <name>.
`,
    add: `kb add <file-or-url>

Bring in one raw source, then print the Add playbook for the agent.

Usage:
  kb add <file-or-url> [--in <name>]
  kb add --resume <raw-ref> [--in <name>]
  kb add --complete <raw-ref> <memory-ref> [--in <name>]

Rules of thumb:
  add preserves raw/ and prints the complete agent playbook.
  The agent normally runs --complete after writing the Memory and index line.
  Use --resume when the original printed playbook was lost.
`,
    draft: `kb draft <title...>

Create a blank Memory in kb's structured markdown format for the agent to write.

Usage:
  kb draft <title...> [--in <name>]

Rules of thumb:
  add = bring in a raw source.
  draft = create a blank Memory for the agent to write.
`,
    search: `kb search <query...>

Search index.md and Memories, or Basic Memory when search is enabled.

Usage:
  kb search <query...> [--in <name>]

Rules of thumb:
  Start broad, then read cited Memories with kb read <ref>.
`,
    read: `kb read <ref>

Read one Memory by ref.

Usage:
  kb read <ref> [--in <name>]

Rules of thumb:
  Use refs from kb search or index.md.
`,
    status: `kb status

Show KB state and Advisor suggestions.

Usage:
  kb status [--in <name>]

Rules of thumb:
  Human labels explain the Arm and search mode; config details stay in kb.yaml.
`,
    log: `kb log [entry...]

Read the KB log, or append one manual single-line entry.

Usage:
  kb log [entry...] [--in <name>]

Rules of thumb:
  Log entries are append-only and greppable.
`,
    enable: `kb enable search

Enable Basic Memory search over existing files.

Usage:
  kb enable search [--in <name>]

Rules of thumb:
  Existing raw/, memories/, index.md, and log.md stay unchanged.
`,
    reflect: `kb reflect

Compute changed Memories and print a reflect plan for the agent.

Usage:
  kb reflect [--in <name>]

Rules of thumb:
  kb writes lastReflectAt and the log entry; the agent does the synthesis.
`,
    check: `kb check

Print deterministic structural candidates and an agent review playbook.

Usage:
  kb check [--in <name>]

Rules of thumb:
  check does not prove semantic duplicates or contradictions.
  Wiki KBs also include wiki-link and stale-date checks.
`,
  };
  return help[command] ?? null;
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

async function startKb(args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb start");
    return EXIT_USAGE;
  }

  const kbHome = join(homedir(), "kb");
  const kbRoot = join(kbHome, "research");
  process.stdout.write(`First run

KB Home: ${kbHome}

Prerequisite: Git must be on PATH because kb new initializes a git repository.
   git --version

1. Create your first KB.
   kb new research

2. Create and stage one harmless source. kb files it, then prints an Add playbook.
   sample_dir="$(mktemp -d)"
   printf '%s\\n' 'Vector search helps with fuzzy recall.' > "$sample_dir/hello.txt"
   kb add "$sample_dir/hello.txt" --in research

3. Agent step: give the complete printed playbook to your AI agent.
   Playbook paths such as raw/... and memories/... are relative to ${kbRoot}.
   The agent writes the Memory and index line, runs the final kb add --complete command,
   and returns the Completed Add handoff receipt.

4. Only after that receipt, confirm, search, and optionally remove the sample.
   kb status --in research
   kb search "vector search" --in research
   rm -rf "$sample_dir"

Coming back or retrying?
  Do not recreate an existing KB. Run: kb status --in research
  If status lists unfinished Add work, recover its playbook with:
    kb add --resume <raw-ref> --in research
  Give the complete resumed playbook to the agent. "KB already exists" is a safe refusal.
  If create failed with "git init failed", run: git -C ${kbRoot} init
  Then rerun kb new research to register the repaired scaffold before checking status.

Rules of thumb:
  kb start is optional and read-only; it only prints this text.
  Input paths passed to kb add are relative to cwd or absolute; --in makes the tutorial target explicit.
  Playbook paths are relative to the selected KB root.
  kb does bookkeeping; the agent reads raw/, writes memories/, and updates index.md.
`);
  return 0;
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
    const result = await withFileLock(scaffoldLockPath(kbDir), `KB ${name} scaffold`, async () => {
      if (await isCompleteKbRoot(kbDir)) {
        await readKbConfig(kbDir);
        if (await isRegisteredKb(name, kbDir)) {
          const error = new Error("KB already exists") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
        const becameDefault = await registerKb(name, kbDir);
        return { kind: "recovered" as const, becameDefault };
      }
      await scaffoldKb(kbDir, name, selectedArm);
      const becameDefault = await registerKb(name, kbDir);
      return { kind: "created" as const, becameDefault };
    });
    process.stdout.write(`${result.kind === "created" ? "Created" : "Recovered"} KB: ${name}
Path: ${kbDir}
${result.becameDefault ? `Default: ${name}\n` : ""}Next: kb add <file-or-url>
`);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
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
    const kind = await withFileLock(scaffoldLockPath(cwd), `KB ${name} scaffold`, async () => {
      if (await isCompleteKbRoot(cwd)) {
        await readKbConfig(cwd);
        await registerKb(name, cwd);
        return "adopted" as const;
      }
      await scaffoldKb(cwd, name, selectedArm);
      await registerKb(name, cwd);
      return "created" as const;
    });
    process.stdout.write(kind === "adopted"
      ? `Registered existing KB: ${name}\nPath: ${cwd}\n`
      : `Initialized KB in ${cwd}
Next: kb add <file-or-url>
`);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith("Registry name conflict:")) {
      writeError(error.message);
      return EXIT_USAGE;
    }
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
  if (!(await exists(kbDir))) {
    await mkdir(kbDir);
  }
  await ensureScaffoldFile(join(kbDir, "kb.yaml"), kbYaml(arm, name));
  await ensureScaffoldFile(join(kbDir, "AGENTS.md"), agentsMd());
  await ensureScaffoldFile(join(kbDir, "index.md"), indexMd());
  await ensureScaffoldFile(join(kbDir, "log.md"), logMd(name));
  await ensureScaffoldDirectory(join(kbDir, "raw"));
  await ensureScaffoldDirectory(join(kbDir, "memories"));

  if (!(await isInsideGitRepo(kbDir))) {
    const code = await runSilent("git", ["init"], kbDir);
    if (code !== 0) {
      throw new Error("git init failed");
    }
  }
}

async function ensureScaffoldFile(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw error;
    }
    const metadata = await stat(path);
    if (!metadata.isFile() || await readFile(path, "utf8") !== content) {
      throw new Error(`damaged or conflicting scaffold artifact: ${path}`);
    }
  }
}

async function ensureScaffoldDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST" || !(await stat(path)).isDirectory()) {
      throw error;
    }
  }
}

function scaffoldLockPath(kbPath: string): string {
  const root = dirname(registryPath());
  return join(root, "scaffold-transactions", `${shortHash(resolve(kbPath))}.lock`);
}

async function listKbs(): Promise<number> {
  const registry = await loadRegistry();
  if (registry.kbs.size === 0) {
    process.stdout.write("No KBs found. Run kb new <name> to create one.\n");
    return 0;
  }

  process.stdout.write(`${renderRegistryLines(registry)}\n`);
  return 0;
}

async function statusKb(kbName: string | null): Promise<number> {
  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  let config: KbConfig;
  try {
    config = await readKbConfig(target.path);
  } catch (error) {
    if (error instanceof CliError && error.exitCode === EXIT_DATAERR) {
      process.stdout.write(`KB: ${target.name}\nPath: ${target.path}\nHealth: ${error.message}\n`);
      return EXIT_DATAERR;
    }
    throw error;
  }
  const counts = await countKbFiles(target.path);
  const inspection = await inspectHandoffs(target.path);
  const structuralHealth = await healthSummary(target.path);
  const health = structuralHealth !== "ok"
    ? structuralHealth
    : inspection.invalidMetadata.length > 0
      ? `invalid pending handoff metadata: ${inspection.invalidMetadata[0]}`
      : hasUnfinishedWork(inspection)
        ? "unfinished work"
        : "ok";
  const advisor = advisorSuggestions(config, counts);

  process.stdout.write(`KB: ${target.name}
Path: ${target.path}
Arm: ${armLabel(config.arm)}
Search: ${config.engineState === "enabled" ? "Basic Memory enabled" : "plain files"}
Sources: ${counts.sources}
Memories: ${counts.memories}
Index entries: ${counts.indexEntries}
Index size: ${counts.indexBytes} bytes
Health: ${health}
${renderUnfinishedWork(target.name, inspection)}Advisor:
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
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  return withFileLock(join(target.path, ".kb-state.lock"), `KB ${target.name} state`, async () => {
    const config = await readKbConfig(target.path);
    if (config.engineState === "enabled") {
      process.stdout.write(`Search already enabled for ${target.name}.\n`);
      return 0;
    }
    if (config.arm === "wiki") {
      writeError("search enablement requires Arm b0; wiki curation was not changed. Arm migration is not available in v1.");
      return EXIT_USAGE;
    }

    const enabled = await new BasicMemoryAdapter().enable(target.path, target.name);
    if (!enabled.ok) {
      writeError(`cannot enable search: ${enabled.message}`);
      return EXIT_UNAVAILABLE;
    }

    const latest = await readKbConfig(target.path);
    await writeKbConfig(target.path, { ...latest, ...enabled.value });
    process.stdout.write(`Search enabled for ${target.name}. Arm: b1. Existing files unchanged.\n`);
    return 0;
  });
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
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
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

  results = await excludeUntouchedDraftResults(target.path, results);
  const inspection = await inspectHandoffs(target.path);
  await appendLogEntry(target.path, "query", query);

  process.stdout.write(renderSearchResults(target.name, query, results, hasUnfinishedWork(inspection)));
  return 0;
}

async function addSource(
  kbName: string | null,
  args: string[],
  resumeRef: string | null,
  complete: boolean,
): Promise<number> {
  if ((!complete && resumeRef === null && args.length !== 1)
    || (resumeRef !== null && args.length !== 0)
    || (complete && args.length !== 2)) {
    writeError("usage: kb add <file-or-url>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }
  const config = await readKbConfig(target.path);

  if (resumeRef !== null) {
    const record = await readPendingAdd(target.path, resumeRef);
    if (record === null) {
      writeError(`no pending Add handoff for ${resumeRef}`);
      return EXIT_USAGE;
    }
    process.stdout.write(`Resuming pending Add\n\n${renderPendingAddPlaybook(record, target.name)}`);
    return 0;
  }

  if (complete) {
    const [rawRef, memoryRef] = args;
    const record = await readPendingAdd(target.path, rawRef);
    if (record === null) {
      writeError(`no pending Add handoff for ${rawRef}`);
      return EXIT_USAGE;
    }
    if (!isKbRef(target.path, rawRef, "raw") || !(await exists(join(target.path, rawRef)))) {
      writeError(`cannot complete Add: Raw source not found: ${rawRef}`);
      return EXIT_USAGE;
    }
    if (!isKbRef(target.path, memoryRef, "memories") || !(await exists(join(target.path, memoryRef)))) {
      writeError(`cannot complete Add: Memory not found: ${memoryRef}`);
      return EXIT_USAGE;
    }
    const indexRefs = new Set(
      indexEntryLines(await readFile(join(target.path, "index.md"), "utf8"))
        .map((line) => parseIndexLine(line)?.ref)
        .filter((ref): ref is string => ref !== undefined),
    );
    if (!indexRefs.has(memoryRef)) {
      writeError(`cannot complete Add: index.md does not reference ${memoryRef}`);
      return EXIT_USAGE;
    }
    await rm(pendingAddPath(target.path, rawRef), { force: true });
    await appendLogEntry(target.path, "handoff-complete", `add ${rawRef} -> ${memoryRef}`);
    process.stdout.write(`Completed Add handoff: ${rawRef} -> ${memoryRef}\n`);
    return 0;
  }

  const input = args[0];
  const staged = isUrl(input) ? await stageUrlReference(target.path, input) : await stageFileSource(target.path, input);
  if (staged === null) {
    return EXIT_USAGE;
  }

  const rawRef = `raw/${staged.rawFile}`;
  const existing = await readPendingAdd(target.path, rawRef);
  const record: PendingAdd = existing ?? {
    schemaVersion: 1,
    kind: "add",
    rawRef,
    suggestedMemoryRef: `memories/${staged.memoryFile}`,
    title: staged.title,
    urlReference: staged.urlReference,
    arm: config.arm,
    createdAt: nowInstant(),
  };
  await writePendingAdd(target.path, record);
  if (staged.created) {
    await appendLogEntry(target.path, "add", staged.rawFile);
  }
  const playbook = renderPendingAddPlaybook(record, target.name);
  process.stdout.write(staged.created ? playbook : `Raw source already present: raw/${staged.rawFile}\n\n${playbook}`);
  return 0;
}

async function createMemoryNote(kbName: string | null, args: string[], resumeRef: string | null): Promise<number> {
  if ((resumeRef === null && args.length === 0) || (resumeRef !== null && args.length !== 0)) {
    writeError("usage: kb draft <title...>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  if (resumeRef !== null) {
    if (!isKbRef(target.path, resumeRef, "memories") || !(await exists(join(target.path, resumeRef)))) {
      writeError(`draft not found: ${resumeRef}`);
      return EXIT_USAGE;
    }
    const text = await readFile(join(target.path, resumeRef), "utf8");
    if (!isUntouchedDraft(text)) {
      writeError(`draft has been edited: ${resumeRef}; run kb check --in ${target.name}`);
      return EXIT_USAGE;
    }
    process.stdout.write(draftPlaybook(resumeRef, target.name));
    return 0;
  }

  const title = args.join(" ").trim();
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

  process.stdout.write(`Created memories/${file}\n\n${draftPlaybook(`memories/${file}`, target.name)}`);
  return 0;
}

async function logKb(kbName: string | null, args: string[]): Promise<number> {
  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  if (args.length === 0) {
    process.stdout.write(await readFile(join(target.path, "log.md"), "utf8"));
    return 0;
  }

  const entry = args.join(" ");
  if (!isSingleLine(entry)) {
    writeError("log entry must be a single line");
    return EXIT_USAGE;
  }

  await appendFile(join(target.path, "log.md"), `## [${todayIso()}] ${entry}\n`);
  return 0;
}

async function readMemory(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 1) {
    writeError("usage: kb read <ref>");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const memoryPath = await resolveMemoryRef(target.path, args[0]);
  if (memoryPath === null) {
    writeError(`memory not found: ${args[0]}; try kb search "${args[0]}" or inspect index.md`);
    return EXIT_USAGE;
  }

  process.stdout.write(`Tiered read order: index.md -> executive summary -> derivatives in memories/ -> raw sources only when needed.\n\n`);
  process.stdout.write(await readFile(memoryPath, "utf8"));
  return 0;
}

async function reflectKb(kbName: string | null, args: string[], complete: boolean): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb reflect");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  return withFileLock(join(target.path, ".kb-state.lock"), `KB ${target.name} state`, async () => {
  const pending = await readPendingReflect(target.path);
  if (complete) {
    if (pending === null) {
      writeError(`no pending Reflect handoff; run \`kb reflect --in ${target.name}\` first`);
      return EXIT_USAGE;
    }
    await writeLastReflectAt(target.path, pending.startedAt);
    await appendLogEntry(target.path, "reflect", `${pending.memories.length} memories`);
    await rm(pendingReflectPath(target.path), { force: true });
    process.stdout.write(
      `Completed Reflect handoff: ${pending.memories.length} ${pending.memories.length === 1 ? "Memory" : "Memories"}\n`
      + `Checkpoint: ${pending.startedAt}\n`,
    );
    return 0;
  }

  if (pending !== null) {
    process.stdout.write(`Resuming pending Reflect\n\n${reflectPlaybook(pending.memories, target.name, true)}`);
    return 0;
  }

  const now = nowInstant();
  const config = await readKbConfig(target.path);
  const changed = await changedMemoriesSince(target.path, config.lastReflectAt, now);
  if (changed.length === 0) {
    await writeLastReflectAt(target.path, now);
    await appendLogEntry(target.path, "reflect", "0 memories");
    process.stdout.write(reflectPlaybook(changed, target.name, false));
    return 0;
  }
  const record: PendingReflect = {
    schemaVersion: 1,
    kind: "reflect",
    previousReflectAt: config.lastReflectAt,
    startedAt: now,
    memories: changed.map(({ ref, title }) => ({ ref, title })),
  };
  await writeJsonAtomic(pendingReflectPath(target.path), record);
  process.stdout.write(reflectPlaybook(record.memories, target.name, true));
  return 0;
  });
}

async function checkKb(kbName: string | null, args: string[]): Promise<number> {
  if (args.length !== 0) {
    writeError("usage: kb check");
    return EXIT_USAGE;
  }

  const target = await resolveTargetKb(kbName);
  if (target === null) {
    writeError(kbName === null ? "no KB found; run `kb new <name>` or use --in <name>" : `unknown KB: ${kbName}`);
    return EXIT_USAGE;
  }

  const config = await readKbConfig(target.path);
  const defrag = await defragCandidates(target.path);
  const wiki = config.arm === "wiki" ? await wikiLintIssues(target.path) : null;
  process.stdout.write(checkPlaybook(defrag, wiki));
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
  created: boolean;
};

type PendingAdd = {
  schemaVersion: 1;
  kind: "add";
  rawRef: string;
  suggestedMemoryRef: string;
  title: string;
  urlReference: boolean;
  arm: string;
  createdAt: string;
};

type PendingReflect = {
  schemaVersion: 1;
  kind: "reflect";
  previousReflectAt: string | null;
  startedAt: string;
  memories: Array<{ ref: string; title: string }>;
};

type HandoffInspection = {
  adds: Array<{
    record: PendingAdd;
    state: "raw-missing" | "memory-missing" | "index-missing" | "ready-to-confirm";
  }>;
  drafts: string[];
  reflect: PendingReflect | null;
  invalidMetadata: string[];
};

function pendingAddPath(kbPath: string, rawRef: string): string {
  return join(kbPath, ".kb", "pending", "add", `${shortHash(rawRef)}.json`);
}

function pendingReflectPath(kbPath: string): string {
  return join(kbPath, ".kb", "pending", "reflect.json");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temp, value, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

async function writePendingAdd(kbPath: string, record: PendingAdd): Promise<void> {
  await writeJsonAtomic(pendingAddPath(kbPath, record.rawRef), record);
}

async function readPendingAdd(kbPath: string, rawRef: string): Promise<PendingAdd | null> {
  try {
    return JSON.parse(await readFile(pendingAddPath(kbPath, rawRef), "utf8")) as PendingAdd;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readPendingReflect(kbPath: string): Promise<PendingReflect | null> {
  try {
    return JSON.parse(await readFile(pendingReflectPath(kbPath), "utf8")) as PendingReflect;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function inspectHandoffs(kbPath: string): Promise<HandoffInspection> {
  const adds: HandoffInspection["adds"] = [];
  const drafts: string[] = [];
  const invalidMetadata: string[] = [];
  const indexRefs = new Set(
    indexEntryLines(await readOptionalFile(join(kbPath, "index.md")))
      .map((line) => parseIndexLine(line)?.ref)
      .filter((ref): ref is string => ref !== undefined),
  );
  const addDir = join(kbPath, ".kb", "pending", "add");

  try {
    for (const entry of await readdir(addDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const ref = `.kb/pending/add/${entry.name}`;
      try {
        const record = JSON.parse(await readFile(join(addDir, entry.name), "utf8")) as PendingAdd;
        if (record.schemaVersion !== 1 || record.kind !== "add" || typeof record.rawRef !== "string"
          || typeof record.suggestedMemoryRef !== "string") {
          invalidMetadata.push(ref);
          continue;
        }
        const rawExists = await exists(join(kbPath, record.rawRef));
        const memoryExists = await exists(join(kbPath, record.suggestedMemoryRef));
        const state = !rawExists
          ? "raw-missing"
          : !memoryExists
            ? "memory-missing"
            : !indexRefs.has(record.suggestedMemoryRef)
              ? "index-missing"
              : "ready-to-confirm";
        adds.push({ record, state });
      } catch {
        invalidMetadata.push(ref);
      }
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    for (const entry of await readdir(join(kbPath, "memories"), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const ref = `memories/${entry.name}`;
      const text = await readFile(join(kbPath, ref), "utf8");
      if (isUntouchedDraft(text)) {
        drafts.push(ref);
      }
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  let reflect: PendingReflect | null = null;
  try {
    reflect = await readPendingReflect(kbPath);
    if (reflect !== null && (reflect.schemaVersion !== 1 || reflect.kind !== "reflect"
      || !Array.isArray(reflect.memories))) {
      invalidMetadata.push(".kb/pending/reflect.json");
      reflect = null;
    }
  } catch {
    invalidMetadata.push(".kb/pending/reflect.json");
  }

  adds.sort((a, b) => a.record.rawRef.localeCompare(b.record.rawRef));
  drafts.sort();
  return { adds, drafts, reflect, invalidMetadata };
}

function isUntouchedDraft(text: string): boolean {
  const title = readYamlScalar(text, "title");
  const permalink = readYamlScalar(text, "permalink");
  return title !== null && permalink !== null && text === memoryTemplate(title, permalink);
}

function hasUnfinishedWork(inspection: HandoffInspection): boolean {
  return inspection.adds.length > 0 || inspection.drafts.length > 0 || inspection.reflect !== null
    || inspection.invalidMetadata.length > 0;
}

async function stageFileSource(kbPath: string, input: string): Promise<StagedSource | null> {
  const sourcePath = resolve(input);
  try {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) {
      writeError(`source is not a file: ${input}`);
      return null;
    }
    const bytes = await readFile(sourcePath);
    const parsed = parse(sourcePath);
    const identity = sourceMemoryIdentity(parsed.name);
    const hash = shortHash(bytes);
    const rawFile = `${slugify(parsed.name)}-${hash}${parsed.ext}`;
    const created = await writeRawIfMissing(kbPath, rawFile, bytes);
    return {
      rawFile,
      memoryFile: `${identity.memoryStem}.md`,
      title: identity.title,
      urlReference: false,
      created,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      writeError(`source not found: ${input}`);
      return null;
    }
    if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
      writeError(`cannot read source: ${input}`);
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
  const created = await writeRawIfMissing(kbPath, rawFile, content);
  return {
    rawFile,
    memoryFile: `${slug}.md`,
    title: titleFromSlug(slug),
    urlReference: true,
    created,
  };
}

async function writeRawIfMissing(kbPath: string, rawFile: string, content: string | Buffer): Promise<boolean> {
  const path = join(kbPath, "raw", rawFile);
  try {
    await writeFile(path, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
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
  const scalar = (pattern: RegExp, label: string): string => {
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1 || matches[0]?.[1] === undefined) {
      throw new CliError(`invalid kb.yaml: expected exactly one ${label}`, EXIT_DATAERR);
    }
    return matches[0][1].trim();
  };
  if (scalar(/^schemaVersion:\s*(.+)$/gm, "schemaVersion") !== "1") {
    throw new CliError("invalid kb.yaml: unsupported schemaVersion", EXIT_DATAERR);
  }
  if (scalar(/^formatVersion:\s*(.+)$/gm, "formatVersion") !== "basic-memory-note-v1") {
    throw new CliError("invalid kb.yaml: unsupported formatVersion", EXIT_DATAERR);
  }
  const arm = scalar(/^arm:\s*(.+)$/gm, "arm");
  const engineState = scalar(/^ {4}state:\s*(.+)$/gm, "engine.basicMemory.state");
  const projectValue = scalar(/^ {4}project:\s*(.+)$/gm, "engine.basicMemory.project");
  const reflectValue = scalar(/^lastReflectAt:\s*(.+)$/gm, "lastReflectAt");
  const engineProject = projectValue === "null" ? null : projectValue;
  const lastReflectAt = reflectValue === "null" ? null : reflectValue;
  const validCombination = (arm === "wiki" || arm === "b0")
    ? engineState === "disabled" && engineProject === null
    : arm === "b1" && engineState === "enabled" && engineProject !== null && engineProject.length > 0;
  if (!validCombination) {
    throw new CliError("invalid kb.yaml: Arm and search engine state are inconsistent", EXIT_DATAERR);
  }
  if (lastReflectAt !== null) {
    const parsed = new Date(lastReflectAt);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== lastReflectAt) {
      throw new CliError("invalid kb.yaml: lastReflectAt must be a canonical ISO instant or null", EXIT_DATAERR);
    }
  }
  return { arm, engineState, lastReflectAt, engineProject };
}

async function writeKbConfig(kbPath: string, config: KbConfig): Promise<void> {
  await writeTextAtomic(join(kbPath, "kb.yaml"), `schemaVersion: 1
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
    if (isUntouchedDraft(text)) {
      continue;
    }
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

async function excludeUntouchedDraftResults(kbPath: string, results: SearchResult[]): Promise<SearchResult[]> {
  const filtered: SearchResult[] = [];
  for (const result of results) {
    if (result.ref.startsWith("memories/")) {
      const text = await readOptionalFile(join(kbPath, result.ref));
      if (text.length > 0 && isUntouchedDraft(text)) {
        continue;
      }
    }
    filtered.push(result);
  }
  return filtered;
}

function renderSearchResults(
  kbName: string,
  query: string,
  results: SearchResult[],
  unfinished = false,
): string {
  const lines = [`Search results`, `KB: ${kbName}`, `Query: ${query}`, `Results: ${results.length}`];
  if (results.length === 0) {
    lines.push(unfinished
      ? `Next: this KB has unfinished work. Run \`kb status --in ${kbName}\` for exact recovery commands.`
      : "Next: try broader terms, check index.md, or kb status for the Advisor.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.ref} | ${result.title}`);
    lines.push(`   Matched in: ${result.source}`);
    lines.push(`   Match: ${singleLineMatch(result.match)}`);
  });
  return `${lines.join("\n")}\n`;
}

function singleLineMatch(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= 240 ? oneLine : `${oneLine.slice(0, 237)}...`;
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

async function changedMemoriesSince(
  kbPath: string,
  lastReflectAt: string | null,
  through: string | null = null,
): Promise<MemoryInfo[]> {
  const cutoff = lastReflectAt === null ? -Infinity : Date.parse(lastReflectAt);
  const upper = through === null ? Infinity : Date.parse(through);
  return (await listMemories(kbPath)).filter((memory) => memory.mtimeMs > cutoff && memory.mtimeMs <= upper);
}

async function writeLastReflectAt(kbPath: string, value: string): Promise<void> {
  const config = await readKbConfig(kbPath);
  await writeKbConfig(kbPath, { ...config, lastReflectAt: value });
}

function reflectPlaybook(
  changed: Array<{ ref: string; title: string }>,
  targetName: string,
  pending: boolean,
): string {
  const lines = ["Reflect playbook", `Changed since last reflect: ${changed.length}`];
  if (changed.length > 0) {
    lines.push(...changed.map((memory) => `- ${memory.ref} | ${memory.title}`));
  }
  lines.push(
    "",
    "Agent half:",
    "1. Read exactly the Memory refs listed above.",
    "2. Write any useful cross-memory synthesis back into memories/ as structured markdown Memories.",
    "3. Add or update index.md lines only for Memories you actually create or revise.",
    "4. Do not claim contradiction detection, stale-fact judgment, or semantic consolidation as guaranteed by kb reflect.",
  );
  if (pending) {
    lines.push(
      "5. When the Agent half is complete, run:",
      `   kb reflect --complete --in ${targetName}`,
      "",
      "If this output is lost, run:",
      `  kb reflect --in ${targetName}`,
    );
  }
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

function checkPlaybook(candidates: DefragCandidates, wiki: WikiLintIssues | null): string {
  const wikiSection = wiki === null ? "" : `Wiki structural candidates:
Dangling [[links]]:
${renderCandidateLines(wiki.danglingLinks)}Missing cross-references:
${renderCandidateLines(wiki.missingCrossReferences)}Stale-by-date flags:
${renderCandidateLines(wiki.staleFlags)}
`;

  return `Check playbook
This command prints deterministic structural candidates and an agent review playbook only; it does not move, archive, delete, or prove semantic issues.
Deterministic candidates:
Duplicate slugs:
${renderCandidateLines(candidates.duplicateSlugs.map((candidate) => `${candidate.slug}: ${candidate.refs.join(", ")}`))}
Orphan memories not in index.md:
${renderCandidateLines(candidates.orphanMemories)}
Dangling index refs:
${renderCandidateLines(candidates.danglingIndexRefs)}
Archivable superseded refs:
${renderCandidateLines(candidates.archivableSupersededRefs.map((ref) => `${ref} -> archive/${ref}`))}
${wikiSection}

Agent half:
1. Review only the deterministic candidates above.
2. For superseded facts, move the old Memory to archive/memories/ and add a replacement note; do not delete it.
3. Fix index.md so every indexed Memory exists and every kept Memory has one catalog line.
4. Do not claim kb check found semantic duplicates, contradictions, or stale facts.
`;
}

function renderCandidateLines(lines: string[]): string {
  return lines.length === 0 ? "- None\n" : `${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function renderPendingAddPlaybook(record: PendingAdd, targetName: string): string {
  const staged: StagedSource = {
    rawFile: record.rawRef.replace(/^raw\//, ""),
    memoryFile: record.suggestedMemoryRef.replace(/^memories\//, ""),
    title: record.title,
    urlReference: record.urlReference,
    created: false,
  };
  return record.arm === "wiki"
    ? wikiIngestPlaybook(staged, targetName)
    : ingestPlaybook(staged, targetName);
}

function ingestPlaybook(staged: StagedSource, targetName: string): string {
  const rawRef = `raw/${staged.rawFile}`;
  const memoryRef = `memories/${staged.memoryFile}`;
  const urlBehavior = staged.urlReference
    ? "v1 stages a URL reference only; full HTML archiving is deferred."
    : "local file copied verbatim into raw/.";

  const formatLines = memoryFormatPlaybookLines(memoryRef, staged.title);

  return `Add playbook
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
8. When the Memory exists and its index.md line is present, run:
   kb add --complete ${rawRef} ${memoryRef} --in ${targetName}

If this output is lost, run:
  kb add --resume ${rawRef} --in ${targetName}
`;
}

function wikiIngestPlaybook(staged: StagedSource, targetName: string): string {
  const rawRef = `raw/${staged.rawFile}`;
  const memoryRef = `memories/${staged.memoryFile}`;
  const urlBehavior = staged.urlReference
    ? "v1 stages a URL reference only; full HTML archiving is deferred."
    : "local file copied verbatim into raw/.";

  return `Wiki add playbook
Raw source: ${rawRef}
Memory target: ${memoryRef}
URL behavior: ${urlBehavior}

Agent half:
1. Read ${rawRef} without editing it.
2. Write or update ${memoryRef} in kb's structured markdown Memory format.
3. Update related wiki pages in memories/ and index.md while preserving the raw/derived boundary.
4. Print a contradiction checklist for claims the model thinks may conflict; kb does not guarantee semantic contradiction detection.
5. Add or update one index.md line: ${indexLine(memoryRef, staged.title)}
6. When the Memory exists and its index.md line is present, run:
   kb add --complete ${rawRef} ${memoryRef} --in ${targetName}

If this output is lost, run:
  kb add --resume ${rawRef} --in ${targetName}
`;
}

function draftPlaybook(memoryRef: string, targetName: string): string {
  return `Draft playbook
Agent half:
1. Replace every TODO and placeholder relation in ${memoryRef}.
2. Add one index.md line for ${memoryRef}.
3. Recheck with: kb status --in ${targetName}

If this output is lost, run:
  kb draft --resume ${memoryRef} --in ${targetName}
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

function sourceMemoryIdentity(stem: string): { memoryStem: string; title: string } {
  const baseSlug = slugify(stem);
  if (/^[\x00-\x7F]*$/.test(stem)) {
    return { memoryStem: baseSlug, title: titleFromSlug(baseSlug) };
  }
  const normalized = stem.normalize("NFC");
  return {
    memoryStem: `${baseSlug}-${shortHash(normalized)}`,
    title: normalized,
  };
}

function isKbRef(kbPath: string, ref: string, directory: "raw" | "memories"): boolean {
  const base = resolve(kbPath, directory);
  const candidate = resolve(kbPath, ref);
  return candidate.startsWith(`${base}/`);
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

function renderUnfinishedWork(targetName: string, inspection: HandoffInspection): string {
  const lines: string[] = [];
  for (const { record, state } of inspection.adds) {
    const stateText = state === "raw-missing"
      ? `Raw source missing: ${record.rawRef}`
      : state === "memory-missing"
        ? `Memory missing: ${record.suggestedMemoryRef}`
        : state === "index-missing"
          ? `Memory not cataloged: ${record.suggestedMemoryRef}`
          : "Ready for completion confirmation";
    lines.push(`- Add: ${record.rawRef}`);
    lines.push(`  State: ${stateText}`);
    lines.push(`  Resume: kb add --resume ${record.rawRef} --in ${targetName}`);
  }
  for (const ref of inspection.drafts) {
    lines.push(`- Draft: ${ref}`);
    lines.push("  State: Untouched TODO template");
    lines.push(`  Resume: kb draft --resume ${ref} --in ${targetName}`);
  }
  if (inspection.reflect !== null) {
    lines.push(`- Reflect: ${inspection.reflect.memories.length} saved ${inspection.reflect.memories.length === 1 ? "Memory" : "Memories"}`);
    lines.push(`  Resume: kb reflect --in ${targetName}`);
  }
  if (lines.length === 0) {
    return "";
  }
  const count = inspection.adds.length + inspection.drafts.length + (inspection.reflect === null ? 0 : 1);
  return `Unfinished work: ${count}\n${lines.join("\n")}\n`;
}

function armLabel(arm: string): string {
  if (arm === "b0") {
    return "b0 (plain markdown)";
  }
  if (arm === "b1") {
    return "b1 (Basic Memory search)";
  }
  if (arm === "wiki") {
    return "wiki (curated pages)";
  }
  return arm;
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

function sortedRegistryEntries(registry: Registry): [string, string][] {
  return [...registry.kbs.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderRegistryLines(registry: Registry): string {
  return sortedRegistryEntries(registry)
    .map(([name, path]) => `${name === registry.defaultKb ? "* " : "  "}${name} ${path}`)
    .join("\n");
}

function renderStartNextStep(name: string, counts: KbCounts, advisor: string[]): string {
  if (advisor.length > 0) {
    return `- ${advisor[0]}`;
  }
  if (counts.sources === 0) {
    return "- Add a source: kb add <file-or-url>";
  }
  if (counts.memories === 0) {
    return "- Follow the last add Playbook and write the first Memory in memories/.";
  }
  return `- Ask a question: kb search "hello world"`;
}

async function registerKb(name: string, path: string): Promise<boolean> {
  return withFileLock(`${registryPath()}.lock`, "Registry", async () => {
    const registry = await loadRegistryUnlocked(true);
    const existing = registry.kbs.get(name);
    if (existing !== undefined && resolve(existing) !== resolve(path)) {
      throw new Error(`Registry name conflict: ${name} already points to ${existing}`);
    }
    const becameDefault = registry.defaultKb === null;
    registry.kbs.set(name, path);
    registry.defaultKb ??= name;
    await writeRegistry(registry);
    return becameDefault || registry.defaultKb === name && existing === path;
  });
}

async function isRegisteredKb(name: string, path: string): Promise<boolean> {
  const registry = await loadRegistry();
  const existing = registry.kbs.get(name);
  return existing !== undefined && resolve(existing) === resolve(path);
}

async function isCompleteKbRoot(path: string): Promise<boolean> {
  try {
    const [config, agents, index, log, raw, memories] = await Promise.all([
      stat(join(path, "kb.yaml")),
      stat(join(path, "AGENTS.md")),
      stat(join(path, "index.md")),
      stat(join(path, "log.md")),
      stat(join(path, "raw")),
      stat(join(path, "memories")),
    ]);
    return config.isFile() && agents.isFile() && index.isFile() && log.isFile()
      && raw.isDirectory() && memories.isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function loadRegistry(): Promise<Registry> {
  try {
    return await loadRegistryUnlocked(false);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  return withFileLock(`${registryPath()}.lock`, "Registry", () => loadRegistryUnlocked(true));
}

async function loadRegistryUnlocked(rebuild: boolean): Promise<Registry> {
  try {
    return parseRegistry(await readFile(registryPath(), "utf8"));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
    if (!rebuild) {
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
  const lines = [`default: ${registry.defaultKb ?? "null"}`, "kbs:"];
  for (const [name, path] of [...registry.kbs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name}: ${path}`);
  }
  await writeTextAtomic(registryPath(), `${lines.join("\n")}\n`);
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
  if (kbName !== null) {
    const registry = await loadRegistry();
    const path = registry.kbs.get(kbName);
    return path === undefined ? null : { name: kbName, path };
  }

  const cwdKb = await findContainingKb(process.cwd());
  if (cwdKb !== null) {
    return cwdKb;
  }

  const registry = await loadRegistry();
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
    if (await hasDamagedKbSignature(current)) {
      throw new CliError(
        `damaged containing KB at ${current}: missing kb.yaml; restore it or run \`cd ${current} && kb init\` to recover`,
      );
    }
    if (current === root) {
      return null;
    }
    current = dirname(current);
  }
}

async function hasDamagedKbSignature(path: string): Promise<boolean> {
  const entries: Array<[string, "file" | "directory"]> = [
    ["AGENTS.md", "file"],
    ["index.md", "file"],
    ["log.md", "file"],
    ["raw", "directory"],
    ["memories", "directory"],
  ];
  for (const [entry, kind] of entries) {
    try {
      const metadata = await stat(join(path, entry));
      if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
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
    let interrupted: NodeJS.Signals | null = null;
    const forward = (signal: NodeJS.Signals) => {
      interrupted = signal;
      proc.kill(signal);
    };
    const onInt = () => forward("SIGINT");
    const onTerm = () => forward("SIGTERM");
    process.once("SIGINT", onInt);
    process.once("SIGTERM", onTerm);
    try {
      const code = await proc.exited;
      return interrupted === null ? code : interrupted === "SIGINT" ? 130 : 143;
    } finally {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    }
  } catch {
    return 127;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
