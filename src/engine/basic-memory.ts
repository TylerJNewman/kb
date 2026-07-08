import { basename } from "node:path";
import type { EngineConfigPatch, EngineResult, EngineSearchResult, SearchEngineAdapter } from "./types";

type ExternalRun = {
  code: number;
  stdout: string;
  stderr: string;
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

export class BasicMemoryAdapter implements SearchEngineAdapter {
  id = "basic-memory";

  async ensureAvailable(kbPath: string): Promise<EngineResult<void>> {
    if (await commandAvailable("bm", kbPath)) {
      return { ok: true, value: undefined };
    }
    if (!(await commandAvailable("uvx", kbPath))) {
      return { ok: false, message: "uvx is not on PATH. Install uv, then rerun `kb enable search`." };
    }

    const installed = await runExternal("uvx", ["basic-memory", "--version"], kbPath);
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

    const added = await runExternal("bm", ["project", "add", projectName, kbPath], kbPath);
    if (added.code !== 0) {
      return { ok: false, message: `Basic Memory project add failed. ${firstOutputLine(added)}` };
    }

    const reindexed = await runExternal("bm", ["reindex", "--project", projectName, "--search"], kbPath);
    if (reindexed.code !== 0) {
      return { ok: false, message: `Basic Memory reindex failed. ${firstOutputLine(reindexed)}` };
    }

    return {
      ok: true,
      value: { arm: "b1", engineState: "enabled", engineProject: projectName },
    };
  }

  async search(kbPath: string, projectName: string, query: string): Promise<EngineResult<EngineSearchResult[]>> {
    const run = await runExternal("bm", ["tool", "search-notes", query, "--project", projectName], kbPath);
    if (run.code !== 0) {
      return { ok: false, message: firstOutputLine(run) };
    }

    let parsed: BasicMemorySearchResponse;
    try {
      parsed = JSON.parse(run.stdout) as BasicMemorySearchResponse;
    } catch {
      return { ok: false, message: "Basic Memory returned non-JSON output." };
    }

    if (parsed.error !== undefined) {
      return { ok: false, message: String(parsed.error) };
    }
    if (!Array.isArray(parsed.results)) {
      return { ok: false, message: "Basic Memory JSON did not include results." };
    }

    return {
      ok: true,
      value: parsed.results.map((result) => normalizeBasicMemoryResult(result)).filter((result): result is EngineSearchResult => result !== null),
    };
  }
}

async function commandAvailable(cmd: string, cwd: string): Promise<boolean> {
  return (await runExternal(cmd, ["--version"], cwd)).code !== 127;
}

async function runExternal(cmd: string, args: string[], cwd: string): Promise<ExternalRun> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { code: 127, stdout: "", stderr: "" };
    }
    throw error;
  }
}

function firstOutputLine(run: ExternalRun): string {
  return `${run.stderr}\n${run.stdout}`.split("\n").map((line) => line.trim()).find(Boolean) ?? `exit ${run.code}`;
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
