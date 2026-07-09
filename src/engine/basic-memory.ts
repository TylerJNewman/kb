import { basename } from "node:path";
import type { EngineConfigPatch, EngineResult, EngineSearchResult, SearchEngineAdapter } from "./types";

type ExternalRun = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
  missingDependency: boolean;
};

type EngineOperation = {
  label: string;
  timeoutMs: number;
};

type BasicMemorySearchResult = {
  title?: unknown;
  score?: unknown;
  file_path?: unknown;
  matched_chunk?: unknown;
  content?: unknown;
};

type BasicMemorySearchResponse = {
  results?: unknown;
  error?: unknown;
};

export const SUPPORTED_BASIC_MEMORY_PACKAGE = "basic-memory==0.22.1";

const DEFAULT_ENGINE_TIMEOUT_MS = 30_000;

const ENGINE_OPERATIONS = {
  uvxAvailability: { label: "uvx availability", timeoutMs: 5_000 },
  installCheck: { label: "Basic Memory install check", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  projectAdd: { label: "Basic Memory project add", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  reindex: { label: "Basic Memory reindex", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  search: { label: "Basic Memory search", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
} as const satisfies Record<string, EngineOperation>;

export function buildBasicMemoryCommand(args: string[]): string[] {
  return ["uvx", "--from", SUPPORTED_BASIC_MEMORY_PACKAGE, "bm", ...args];
}

export class BasicMemoryAdapter implements SearchEngineAdapter {
  id = "basic-memory";

  async ensureAvailable(kbPath: string): Promise<EngineResult<void>> {
    const uvx = await commandAvailable("uvx", kbPath);
    if (uvx.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.uvxAvailability, uvx) };
    }
    if (uvx.code === 127) {
      return { ok: false, message: "uvx is not on PATH. Install uv, then rerun `kb enable search`." };
    }
    if (uvx.code !== 0) {
      return { ok: false, message: `uvx availability failed. ${firstOutputLine(uvx)}` };
    }

    const installed = await runBasicMemory(["--version"], kbPath, ENGINE_OPERATIONS.installCheck);
    if (installed.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.installCheck, installed) };
    }
    if (installed.code !== 0) {
      return { ok: false, message: `Basic Memory install check failed. ${firstOutputLine(installed)}` };
    }
    return { ok: true, value: undefined };
  }

  async enable(kbPath: string, projectName: string): Promise<EngineResult<EngineConfigPatch>> {
    const available = await this.ensureAvailable(kbPath);
    if (!available.ok) {
      return available;
    }

    const added = await runBasicMemory(["project", "add", projectName, kbPath], kbPath, ENGINE_OPERATIONS.projectAdd);
    if (added.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.projectAdd, added) };
    }
    if (added.code !== 0) {
      return { ok: false, message: `Basic Memory project add failed. ${firstOutputLine(added)}` };
    }

    const reindexed = await runBasicMemory(["reindex", "--project", projectName, "--search"], kbPath, ENGINE_OPERATIONS.reindex);
    if (reindexed.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.reindex, reindexed) };
    }
    if (reindexed.code !== 0) {
      return { ok: false, message: `Basic Memory reindex failed. ${firstOutputLine(reindexed)}` };
    }

    return {
      ok: true,
      value: { arm: "b1", engineState: "enabled", engineProject: projectName },
    };
  }

  async search(kbPath: string, projectName: string, query: string): Promise<EngineResult<EngineSearchResult[]>> {
    const run = await runBasicMemory(["tool", "search-notes", query, "--project", projectName], kbPath, ENGINE_OPERATIONS.search);
    if (run.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.search, run) };
    }
    if (run.missingDependency) {
      return { ok: false, message: "uvx is not on PATH. Install uv, then rerun this command." };
    }
    if (run.code !== 0) {
      return { ok: false, message: `Basic Memory search failed. ${firstOutputLine(run)}` };
    }

    let parsed: BasicMemorySearchResponse;
    try {
      parsed = JSON.parse(run.stdout) as BasicMemorySearchResponse;
    } catch {
      return { ok: false, message: "Basic Memory search returned non-JSON output." };
    }

    if (parsed.error !== undefined) {
      return { ok: false, message: `Basic Memory search returned an error. ${String(parsed.error)}` };
    }
    if (!Array.isArray(parsed.results)) {
      return { ok: false, message: "Basic Memory search JSON did not include results." };
    }

    return {
      ok: true,
      value: parsed.results.map((result) => normalizeBasicMemoryResult(result)).filter((result): result is EngineSearchResult => result !== null),
    };
  }
}

async function commandAvailable(cmd: string, cwd: string): Promise<ExternalRun> {
  return runExternal(cmd, ["--version"], cwd, ENGINE_OPERATIONS.uvxAvailability);
}

async function runBasicMemory(args: string[], cwd: string, operation: EngineOperation): Promise<ExternalRun> {
  const [cmd, ...runnerArgs] = buildBasicMemoryCommand(args);
  return runExternal(cmd, runnerArgs, cwd, operation);
}

async function runExternal(cmd: string, args: string[], cwd: string, operation: EngineOperation): Promise<ExternalRun> {
  const timeoutMs = engineTimeoutMs(operation);
  let timedOut = false;
  let killWithSigkill: ReturnType<typeof setTimeout> | null = null;
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(proc.pid, "SIGTERM");
      killWithSigkill = setTimeout(() => killProcessTree(proc.pid, "SIGKILL"), 100);
      killWithSigkill.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);
    if (killWithSigkill !== null) {
      clearTimeout(killWithSigkill);
    }
    return { code, stdout, stderr, timedOut, timeoutMs, missingDependency: false };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { code: 127, stdout: "", stderr: "", timedOut: false, timeoutMs, missingDependency: true };
    }
    throw error;
  }
}

function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  const quotedSignal = signal.replace(/[^A-Z0-9]/g, "");
  Bun.spawnSync([
    "/bin/sh",
    "-c",
    `kill_tree() {
  for child in $(/usr/bin/pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  /bin/kill -${quotedSignal} "$1" 2>/dev/null || true
}
kill_tree "$1"`,
    "kill-tree",
    String(pid),
  ]);
}

function engineTimeoutMs(operation: EngineOperation): number {
  const override = Number(process.env.KB_ENGINE_TIMEOUT_MS);
  if (operation !== ENGINE_OPERATIONS.uvxAvailability && Number.isInteger(override) && override > 0) {
    return override;
  }
  return operation.timeoutMs;
}

function timeoutMessage(operation: EngineOperation, run: ExternalRun): string {
  const diagnostic = firstOutputLineOrNull(run);
  return `${operation.label} timed out after ${run.timeoutMs}ms.${diagnostic === null ? "" : ` ${diagnostic}`}`;
}

function firstOutputLine(run: ExternalRun): string {
  return firstOutputLineOrNull(run) ?? `exit ${run.code}`;
}

function firstOutputLineOrNull(run: ExternalRun): string | null {
  return `${run.stderr}\n${run.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !isSignalNoise(line)) ?? null;
}

function isSignalNoise(line: string): boolean {
  return /\b(Terminated|Killed):?\s*\d*\b/.test(line);
}

function normalizeBasicMemoryResult(value: unknown): EngineSearchResult | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const result = value as BasicMemorySearchResult;
  if (typeof result.file_path !== "string" || result.file_path.length === 0) {
    return null;
  }

  const title = typeof result.title === "string" && result.title.length > 0
    ? result.title.replace(/^summary:\s*/i, "").replace(/\.\.\.$/, "")
    : titleFromSlug(basename(result.file_path, ".md"));
  const match = typeof result.matched_chunk === "string" && result.matched_chunk.length > 0
    ? result.matched_chunk
    : typeof result.content === "string" ? result.content : "";

  return {
    ref: result.file_path,
    title,
    match,
    score: typeof result.score === "number" ? result.score : 0,
  };
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
