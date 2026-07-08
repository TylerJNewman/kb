import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

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

  writeError(`command not implemented in this slice: ${parsed.command}`);
  return EXIT_UNAVAILABLE;
}

function parseArgs(argv: string[]): ParseResult {
  let help = false;
  let version = false;
  let kbName: string | null = null;
  let command: string | null = null;
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

    if (arg.startsWith("-")) {
      return { ok: false, message: `unknown flag: ${arg}` };
    }

    if (command !== null) {
      args.push(arg);
      continue;
    }

    command = arg;
  }

  return { ok: true, help, version, kbName, command, args };
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
  --kb <name>    Target a named KB from the Registry. Resolution is wired later.
  --help         Print this help text.
  --version      Print the CLI version.

Commands:
  new init list status add note search read log enable reflect defrag lint

Rules of thumb:
  Start with: kb new research
  kb new creates under KB Home: ~/kb/<name>/
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
    await mkdir(kbDir);
    await Promise.all([
      writeFile(join(kbDir, "kb.yaml"), kbYaml()),
      writeFile(join(kbDir, "AGENTS.md"), agentsMd()),
      writeFile(join(kbDir, "index.md"), indexMd()),
      writeFile(join(kbDir, "log.md"), logMd(name)),
      mkdir(join(kbDir, "raw")),
      mkdir(join(kbDir, "memories")),
    ]);

    if (!(await isInsideGitRepo(kbDir))) {
      const code = await runSilent("git", ["init"], kbDir);
      if (code !== 0) {
        writeError("git init failed");
        return EXIT_UNAVAILABLE;
      }
    }
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
