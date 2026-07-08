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
  | { ok: true; help: boolean; version: boolean; kbName: string | null; command: string | null }
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

  if (parsed.help || parsed.command === null) {
    process.stdout.write(helpText());
    return 0;
  }

  if (!PRODUCT_COMMANDS.has(parsed.command)) {
    writeError(`unknown command: ${parsed.command}`);
    return EXIT_USAGE;
  }

  writeError(`command not implemented in this slice: ${parsed.command}`);
  return EXIT_UNAVAILABLE;
}

function parseArgs(argv: string[]): ParseResult {
  let help = false;
  let version = false;
  let kbName: string | null = null;
  let command: string | null = null;

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
      return { ok: false, message: `unexpected argument: ${arg}` };
    }

    command = arg;
  }

  return { ok: true, help, version, kbName, command };
}

function writeError(message: string): void {
  process.stderr.write(`kb: ${message}\n`);
}

function helpText(): string {
  return `kb ${VERSION}

Usage:
  kb [--kb <name>] <command> [flags]
  kb --help
  kb --version

Global flags:
  --kb <name>    Target a named KB from the Registry. Resolution is wired later.
  --help         Print this help text.
  --version      Print the CLI version.

Commands:
  new init list status add note search read log enable reflect defrag lint

Conventions:
  stdout is for requested output and playbooks.
  stderr is for errors and diagnostics.
  usage errors exit 64; unavailable router stubs exit 69.

No product commands are implemented in this slice.
`;
}
