import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  EngineConfigPatch,
  EngineProject,
  EngineResult,
  EngineSchemaDiff,
  EngineSchemaDriftField,
  EngineSchemaFieldFrequency,
  EngineSchemaFieldResult,
  EngineSchemaInference,
  EngineSchemaNoteValidation,
  EngineSchemaValidation,
  EngineSchemaValidationTarget,
  EngineSearchResult,
  SchemaEngineAdapter,
} from "./types";

type ExternalRun = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
  missingDependency: boolean;
  interrupted: NodeJS.Signals | null;
};

type EngineOperation = {
  label: string;
  timeoutMs: number;
};

type EngineRunner = {
  command: string;
  argsPrefix: string[];
  dependency: "bm" | "uvx";
};

type JsonRecord = Record<string, unknown>;

export const SUPPORTED_BASIC_MEMORY_VERSION = "0.22.1";
export const SUPPORTED_BASIC_MEMORY_PACKAGE = `basic-memory==${SUPPORTED_BASIC_MEMORY_VERSION}`;

const DEFAULT_ENGINE_TIMEOUT_MS = 30_000;
const REINDEX_TIMEOUT_MS = 300_000;

// Engine subprocesses need filesystem/runtime discovery, not the caller's full
// credential set. Keep this list explicit so adding a new inherited capability
// is a reviewed contract change instead of an ambient side effect.
const ENGINE_OPERATIONAL_ENV_KEYS = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "UV_CACHE_DIR",
  "UV_PYTHON",
  "UV_PYTHON_INSTALL_DIR",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "BASIC_MEMORY_CONFIG_DIR",
  "FASTEMBED_CACHE_PATH",
  "UV_SYSTEM_CERTS",
  "UV_NATIVE_TLS",
] as const;

// A restricted parent must not accidentally grant the child network access,
// configuration discovery, or managed-Python downloads by omitting the flag
// that imposed the restriction.
const ENGINE_CAPABILITY_DENIAL_ENV_KEYS = [
  "UV_OFFLINE",
  "UV_NO_CONFIG",
  "UV_NO_SYSTEM_CONFIG",
  "UV_PYTHON_DOWNLOADS",
] as const;

const ENGINE_CHILD_ENV_KEYS = [
  ...ENGINE_OPERATIONAL_ENV_KEYS,
  ...ENGINE_CAPABILITY_DENIAL_ENV_KEYS,
] as const;

const ENGINE_OPERATIONS = {
  bmAvailability: { label: "Basic Memory availability", timeoutMs: 5_000 },
  uvxAvailability: { label: "uvx availability", timeoutMs: 5_000 },
  installCheck: { label: "Basic Memory install check", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  projectList: { label: "Basic Memory project list", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  projectAdd: { label: "Basic Memory project add", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  reindex: { label: "Basic Memory reindex", timeoutMs: REINDEX_TIMEOUT_MS },
  search: { label: "Basic Memory search", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  schemaInfer: { label: "Basic Memory schema infer", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  schemaValidate: { label: "Basic Memory schema validate", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
  schemaDiff: { label: "Basic Memory schema diff", timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS },
} as const satisfies Record<string, EngineOperation>;

const BARE_BM_RUNNER: EngineRunner = {
  command: "bm",
  argsPrefix: [],
  dependency: "bm",
};

const UVX_RUNNER: EngineRunner = {
  command: "uvx",
  argsPrefix: ["--from", SUPPORTED_BASIC_MEMORY_PACKAGE, "bm"],
  dependency: "uvx",
};

export function buildBasicMemoryCommand(args: string[]): string[] {
  return [UVX_RUNNER.command, ...UVX_RUNNER.argsPrefix, ...args];
}

export class BasicMemoryAdapter implements SchemaEngineAdapter {
  id = "basic-memory";
  private runner: EngineRunner | null = null;
  private runnerResolution: Promise<EngineResult<EngineRunner>> | null = null;

  async ensureAvailable(kbPath: string): Promise<EngineResult<void>> {
    const runner = await this.resolveRunner(kbPath);
    return runner.ok === true ? { ok: true, value: undefined } : runner;
  }

  async enable(kbPath: string, projectName: string): Promise<EngineResult<EngineConfigPatch>> {
    const runner = await this.resolveRunner(kbPath);
    if (runner.ok === false) {
      return runner;
    }

    const listed = await this.listProjects(kbPath);
    if (listed.ok === false) {
      return listed;
    }
    const canonicalPath = await canonicalProjectPath(kbPath);
    const canonicalProjects = await Promise.all(listed.value.map(async (project) => ({
      project,
      path: await canonicalProjectPath(project.localPath),
    })));
    const named = canonicalProjects.find(({ project }) => project.name === projectName);
    if (named !== undefined && named.path !== canonicalPath) {
      return projectConflict(projectName, named.project.localPath, canonicalPath);
    }
    const registeredPath = canonicalProjects.find(({ path }) => path === canonicalPath);
    let selectedName = registeredPath?.project.name ?? projectName;

    if (registeredPath === undefined) {
      const added = await this.runWithRunner(
        runner.value,
        ["project", "add", selectedName, kbPath],
        kbPath,
        ENGINE_OPERATIONS.projectAdd,
      );
      const addFailure = operationFailure(ENGINE_OPERATIONS.projectAdd, added, runner.value);
      const relisted = await this.listProjects(kbPath);
      if (relisted.ok === false) {
        return relisted;
      }
      const winner = relisted.value.find((project) => project.name === projectName);
      if (winner === undefined) {
        return addFailure ?? { ok: false, message: "Basic Memory project add did not register the project." };
      }
      const winnerPath = await canonicalProjectPath(winner.localPath);
      if (winnerPath !== canonicalPath) {
        return projectConflict(projectName, winner.localPath, canonicalPath);
      }
      selectedName = winner.name;
    }

    const reindexed = await this.reindex(kbPath, selectedName);
    if (reindexed.ok === false) {
      return reindexed;
    }

    return {
      ok: true,
      value: { arm: "b1", engineState: "enabled", engineProject: selectedName },
    };
  }

  async listProjects(kbPath: string): Promise<EngineResult<EngineProject[]>> {
    const run = await this.run(
      ["project", "list", "--local", "--json"],
      kbPath,
      ENGINE_OPERATIONS.projectList,
    );
    if (run.ok === false) {
      return run;
    }
    if (run.value.stdout.trim() === "null") {
      return malformedJsonFailure(ENGINE_OPERATIONS.projectList, "projects");
    }
    const parsed = parseEngineJson(run.value, ENGINE_OPERATIONS.projectList);
    if (parsed.ok === false) {
      return parsed;
    }
    const entries = parsed.value.projects;
    if (!Array.isArray(entries)) {
      return malformedJsonFailure(ENGINE_OPERATIONS.projectList, "projects");
    }
    const projects: EngineProject[] = [];
    for (const [index, value] of entries.entries()) {
      const project = parseProject(value);
      if (project === null) {
        return { ok: false, message: `Basic Memory project list JSON contained a malformed project at index ${index}.` };
      }
      projects.push(project);
    }
    return { ok: true, value: projects };
  }

  async reindex(kbPath: string, projectName: string): Promise<EngineResult<void>> {
    const run = await this.run(
      ["reindex", "--project", projectName, "--search"],
      kbPath,
      ENGINE_OPERATIONS.reindex,
    );
    return run.ok === true ? { ok: true, value: undefined } : run;
  }

  async search(
    kbPath: string,
    projectName: string,
    query: string,
  ): Promise<EngineResult<EngineSearchResult[]>> {
    const run = await this.run(
      ["tool", "search-notes", query, "--project", projectName],
      kbPath,
      ENGINE_OPERATIONS.search,
    );
    if (run.ok === false) {
      return run;
    }
    const parsed = parseEngineJson(run.value, ENGINE_OPERATIONS.search);
    if (parsed.ok === false) {
      return parsed;
    }
    if (!Array.isArray(parsed.value.results)) {
      return malformedJsonFailure(ENGINE_OPERATIONS.search, "results");
    }

    const results: EngineSearchResult[] = [];
    for (const [index, value] of parsed.value.results.entries()) {
      if (!isJsonRecord(value) || typeof value.file_path !== "string" || value.file_path.length === 0) {
        return { ok: false, message: `Basic Memory search JSON contained a malformed result at index ${index}.` };
      }
      if (!value.file_path.startsWith("memories/")) {
        continue;
      }
      const normalized = normalizeBasicMemoryResult(value);
      if (normalized === null) {
        return { ok: false, message: `Basic Memory search JSON contained a malformed Memory result at index ${index}.` };
      }
      results.push(normalized);
    }
    return { ok: true, value: results };
  }

  async inferSchema(
    kbPath: string,
    projectName: string,
    noteType: string,
    threshold: number,
  ): Promise<EngineResult<EngineSchemaInference>> {
    const refreshed = await this.reindex(kbPath, projectName);
    if (refreshed.ok === false) {
      return refreshed;
    }
    const run = await this.run(
      [
        "schema",
        "infer",
        noteType,
        "--project",
        projectName,
        "--threshold",
        String(threshold),
        "--json",
        "--local",
      ],
      kbPath,
      ENGINE_OPERATIONS.schemaInfer,
    );
    if (run.ok === false) {
      return run;
    }
    const parsed = parseEngineJson(run.value, ENGINE_OPERATIONS.schemaInfer);
    return parsed.ok === true ? normalizeInference(parsed.value) : parsed;
  }

  async validateSchema(
    kbPath: string,
    projectName: string,
    target: EngineSchemaValidationTarget,
  ): Promise<EngineResult<EngineSchemaValidation>> {
    const refreshed = await this.reindex(kbPath, projectName);
    if (refreshed.ok === false) {
      return refreshed;
    }
    const targetArgs = target.kind === "all"
      ? []
      : [target.kind === "type" ? target.type : target.ref];
    const run = await this.run(
      ["schema", "validate", ...targetArgs, "--project", projectName, "--json", "--local"],
      kbPath,
      ENGINE_OPERATIONS.schemaValidate,
    );
    if (run.ok === false) {
      return run;
    }
    const parsed = parseEngineJson(run.value, ENGINE_OPERATIONS.schemaValidate);
    return parsed.ok === true ? normalizeValidation(parsed.value) : parsed;
  }

  async diffSchema(
    kbPath: string,
    projectName: string,
    noteType: string,
  ): Promise<EngineResult<EngineSchemaDiff>> {
    const refreshed = await this.reindex(kbPath, projectName);
    if (refreshed.ok === false) {
      return refreshed;
    }
    const run = await this.run(
      ["schema", "diff", noteType, "--project", projectName, "--json", "--local"],
      kbPath,
      ENGINE_OPERATIONS.schemaDiff,
    );
    if (run.ok === false) {
      return run;
    }
    const parsed = parseEngineJson(run.value, ENGINE_OPERATIONS.schemaDiff);
    return parsed.ok === true ? normalizeDiff(parsed.value) : parsed;
  }

  private async run(
    args: string[],
    cwd: string,
    operation: EngineOperation,
  ): Promise<EngineResult<ExternalRun>> {
    const runner = await this.resolveRunner(cwd);
    if (runner.ok === false) {
      return runner;
    }
    const result = await this.runWithRunner(runner.value, args, cwd, operation);
    const failure = operationFailure(operation, result, runner.value);
    return failure ?? { ok: true, value: result };
  }

  private async resolveRunner(cwd: string): Promise<EngineResult<EngineRunner>> {
    if (this.runner !== null) {
      return { ok: true, value: this.runner };
    }
    if (this.runnerResolution === null) {
      this.runnerResolution = this.discoverRunner(cwd);
    }
    const resolved = await this.runnerResolution;
    this.runnerResolution = null;
    if (resolved.ok) {
      this.runner = resolved.value;
    }
    return resolved;
  }

  private async discoverRunner(cwd: string): Promise<EngineResult<EngineRunner>> {
    const bare = await this.runWithRunner(BARE_BM_RUNNER, ["--version"], cwd, ENGINE_OPERATIONS.bmAvailability);
    if (bare.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.bmAvailability, bare) };
    }
    if (bare.interrupted !== null) {
      return interruptedFailure(ENGINE_OPERATIONS.bmAvailability, bare);
    }
    if (!bare.missingDependency && bare.code === 0 && reportsSupportedBasicMemoryVersion(bare)) {
      return { ok: true, value: BARE_BM_RUNNER };
    }

    const uvx = await runExternal(
      "uvx",
      ["--version"],
      cwd,
      ENGINE_OPERATIONS.uvxAvailability,
    );
    if (uvx.timedOut) {
      return { ok: false, message: timeoutMessage(ENGINE_OPERATIONS.uvxAvailability, uvx) };
    }
    if (uvx.interrupted !== null) {
      return interruptedFailure(ENGINE_OPERATIONS.uvxAvailability, uvx);
    }
    if (uvx.missingDependency) {
      return { ok: false, message: "uvx availability failed. uvx is not on PATH. Install uv, then rerun `kb enable search`." };
    }
    if (uvx.code !== 0) {
      return { ok: false, message: `uvx availability failed. ${firstOutputLine(uvx)}` };
    }

    const installed = await this.runWithRunner(
      UVX_RUNNER,
      ["--version"],
      cwd,
      ENGINE_OPERATIONS.installCheck,
    );
    const failure = operationFailure(ENGINE_OPERATIONS.installCheck, installed, UVX_RUNNER);
    return failure ?? { ok: true, value: UVX_RUNNER };
  }

  private runWithRunner(
    runner: EngineRunner,
    args: string[],
    cwd: string,
    operation: EngineOperation,
  ): Promise<ExternalRun> {
    return runExternal(runner.command, [...runner.argsPrefix, ...args], cwd, operation);
  }
}

async function runExternal(
  command: string,
  args: string[],
  cwd: string,
  operation: EngineOperation,
): Promise<ExternalRun> {
  const timeoutMs = engineTimeoutMs(operation);
  let timedOut = false;
  let interrupted: NodeJS.Signals | null = null;
  let escalation: Promise<void> | null = null;
  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      detached: true,
      env: engineChildEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stopProcessGroup = (signal: NodeJS.Signals) => {
      killProcessGroup(proc.pid, signal);
      escalation ??= scheduleProcessGroupEscalation(proc.pid);
    };
    const onInt = () => {
      interrupted ??= "SIGINT";
      stopProcessGroup("SIGINT");
    };
    const onTerm = () => {
      interrupted ??= "SIGTERM";
      stopProcessGroup("SIGTERM");
    };
    process.once("SIGINT", onInt);
    process.once("SIGTERM", onTerm);
    const timeout = setTimeout(() => {
      timedOut = true;
      stopProcessGroup("SIGTERM");
    }, timeoutMs);
    timeout.unref?.();
    try {
      const [stdout, stderr, childCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (escalation !== null) {
        await escalation;
      }
      const code = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : childCode;
      return {
        code,
        stdout,
        stderr,
        timedOut,
        timeoutMs,
        missingDependency: false,
        interrupted,
      };
    } finally {
      clearTimeout(timeout);
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        code: 127,
        stdout: "",
        stderr: "",
        timedOut: false,
        timeoutMs,
        missingDependency: true,
        interrupted: null,
      };
    }
    throw error;
  }
}

function engineChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENGINE_CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function operationFailure(
  operation: EngineOperation,
  run: ExternalRun,
  runner: EngineRunner,
): EngineResult<never> | null {
  if (run.timedOut) {
    return { ok: false, message: timeoutMessage(operation, run) };
  }
  if (run.interrupted !== null) {
    return interruptedFailure(operation, run);
  }
  if (run.missingDependency) {
    const dependency = runner.dependency === "uvx" ? "uvx" : "Basic Memory";
    return { ok: false, message: `${operation.label} failed. ${dependency} is not on PATH.` };
  }
  if (run.code !== 0) {
    return { ok: false, message: `${operation.label} failed. ${firstOutputLine(run)}` };
  }
  return null;
}

function parseEngineJson(
  run: ExternalRun,
  operation: EngineOperation,
): EngineResult<JsonRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return { ok: false, message: `${operation.label} returned non-JSON output.` };
  }
  if (!isJsonRecord(parsed)) {
    return { ok: false, message: `${operation.label} returned malformed JSON.` };
  }
  if (parsed.error !== undefined) {
    return { ok: false, message: `${operation.label} returned an error. ${String(parsed.error)}` };
  }
  return { ok: true, value: parsed };
}

function normalizeInference(value: JsonRecord): EngineResult<EngineSchemaInference> {
  const operation = ENGINE_OPERATIONS.schemaInfer;
  if (
    typeof value.note_type !== "string"
    || !isNonNegativeInteger(value.notes_analyzed)
    || !Array.isArray(value.field_frequencies)
    || !isJsonRecord(value.suggested_schema)
    || !isStringArray(value.suggested_required)
    || !isStringArray(value.suggested_optional)
    || !isStringArray(value.excluded)
  ) {
    return malformedJsonFailure(operation, "required inference fields");
  }
  const fieldFrequencies: EngineSchemaFieldFrequency[] = [];
  for (const [index, field] of value.field_frequencies.entries()) {
    const normalized = normalizeFrequency(field);
    if (normalized === null) {
      return { ok: false, message: `${operation.label} JSON contained a malformed field frequency at index ${index}.` };
    }
    fieldFrequencies.push(normalized);
  }
  return {
    ok: true,
    value: {
      noteType: value.note_type,
      notesAnalyzed: value.notes_analyzed,
      fieldFrequencies,
      suggestedSchema: value.suggested_schema,
      suggestedRequired: value.suggested_required,
      suggestedOptional: value.suggested_optional,
      excluded: value.excluded,
    },
  };
}

function normalizeValidation(value: JsonRecord): EngineResult<EngineSchemaValidation> {
  const operation = ENGINE_OPERATIONS.schemaValidate;
  if (
    !(value.note_type === undefined || value.note_type === null || typeof value.note_type === "string")
    || !isNonNegativeInteger(value.total_notes)
    || !isNonNegativeInteger(value.total_entities)
    || !isNonNegativeInteger(value.valid_count)
    || !isNonNegativeInteger(value.warning_count)
    || !isNonNegativeInteger(value.error_count)
    || !Array.isArray(value.results)
  ) {
    return malformedJsonFailure(operation, "required validation fields");
  }
  const results: EngineSchemaNoteValidation[] = [];
  for (const [index, result] of value.results.entries()) {
    const normalized = normalizeNoteValidation(result);
    if (normalized === null) {
      return { ok: false, message: `${operation.label} JSON contained a malformed note result at index ${index}.` };
    }
    results.push(normalized);
  }
  return {
    ok: true,
    value: {
      noteType: typeof value.note_type === "string" ? value.note_type : null,
      totalNotes: value.total_notes,
      totalEntities: value.total_entities,
      validCount: value.valid_count,
      warningCount: value.warning_count,
      errorCount: value.error_count,
      results,
    },
  };
}

function normalizeDiff(value: JsonRecord): EngineResult<EngineSchemaDiff> {
  const operation = ENGINE_OPERATIONS.schemaDiff;
  if (
    typeof value.note_type !== "string"
    || typeof value.schema_found !== "boolean"
    || !Array.isArray(value.new_fields)
    || !Array.isArray(value.dropped_fields)
    || !isStringArray(value.cardinality_changes)
  ) {
    return malformedJsonFailure(operation, "required diff fields");
  }
  const newFields = normalizeDriftFields(value.new_fields);
  const droppedFields = normalizeDriftFields(value.dropped_fields);
  if (newFields === null || droppedFields === null) {
    return { ok: false, message: `${operation.label} JSON contained a malformed drift field.` };
  }
  return {
    ok: true,
    value: {
      noteType: value.note_type,
      schemaFound: value.schema_found,
      newFields,
      droppedFields,
      cardinalityChanges: value.cardinality_changes,
      hasDrift: newFields.length > 0 || droppedFields.length > 0 || value.cardinality_changes.length > 0,
    },
  };
}

function normalizeFrequency(value: unknown): EngineSchemaFieldFrequency | null {
  if (
    !isJsonRecord(value)
    || typeof value.name !== "string"
    || !isSchemaSource(value.source)
    || !isNonNegativeInteger(value.count)
    || !isNonNegativeInteger(value.total)
    || !isPercentage(value.percentage)
    || !isStringArray(value.sample_values)
    || typeof value.is_array !== "boolean"
    || !(value.target_type === undefined || value.target_type === null || typeof value.target_type === "string")
  ) {
    return null;
  }
  return {
    name: value.name,
    source: value.source,
    count: value.count,
    total: value.total,
    percentage: value.percentage,
    sampleValues: value.sample_values,
    isArray: value.is_array,
    targetType: typeof value.target_type === "string" ? value.target_type : null,
  };
}

function normalizeNoteValidation(value: unknown): EngineSchemaNoteValidation | null {
  if (
    !isJsonRecord(value)
    || typeof value.note_identifier !== "string"
    || typeof value.schema_entity !== "string"
    || typeof value.passed !== "boolean"
    || !Array.isArray(value.field_results)
    || !isNumberRecord(value.unmatched_observations)
    || !isStringArray(value.unmatched_relations)
    || !isStringArray(value.warnings)
    || !isStringArray(value.errors)
  ) {
    return null;
  }
  const fieldResults: EngineSchemaFieldResult[] = [];
  for (const field of value.field_results) {
    const normalized = normalizeFieldResult(field);
    if (normalized === null) {
      return null;
    }
    fieldResults.push(normalized);
  }
  return {
    noteIdentifier: value.note_identifier,
    schemaEntity: value.schema_entity,
    passed: value.passed,
    fieldResults,
    unmatchedObservations: value.unmatched_observations,
    unmatchedRelations: value.unmatched_relations,
    warnings: value.warnings,
    errors: value.errors,
  };
}

function normalizeFieldResult(value: unknown): EngineSchemaFieldResult | null {
  if (
    !isJsonRecord(value)
    || typeof value.field_name !== "string"
    || typeof value.field_type !== "string"
    || typeof value.required !== "boolean"
    || typeof value.status !== "string"
    || !isStringArray(value.values)
    || !(value.message === undefined || value.message === null || typeof value.message === "string")
  ) {
    return null;
  }
  return {
    fieldName: value.field_name,
    fieldType: value.field_type,
    required: value.required,
    status: value.status,
    values: value.values,
    message: typeof value.message === "string" ? value.message : null,
  };
}

function normalizeDriftFields(values: unknown[]): EngineSchemaDriftField[] | null {
  const results: EngineSchemaDriftField[] = [];
  for (const value of values) {
    if (
      !isJsonRecord(value)
      || typeof value.name !== "string"
      || !isSchemaSource(value.source)
      || !isNonNegativeInteger(value.count)
      || !isNonNegativeInteger(value.total)
      || !isPercentage(value.percentage)
    ) {
      return null;
    }
    results.push({
      name: value.name,
      source: value.source,
      count: value.count,
      total: value.total,
      percentage: value.percentage,
    });
  }
  return results;
}

function parseProject(value: unknown): EngineProject | null {
  if (!isJsonRecord(value) || typeof value.name !== "string" || typeof value.local_path !== "string") {
    return null;
  }
  if (value.name.length === 0 || value.local_path.length === 0) {
    return null;
  }
  return { name: value.name, localPath: value.local_path };
}

async function canonicalProjectPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function projectConflict(projectName: string, registeredPath: string, expectedPath: string): EngineResult<never> {
  return {
    ok: false,
    message: `Basic Memory project conflict: project '${projectName}' points to ${registeredPath}, not ${expectedPath}.`,
  };
}

function normalizeBasicMemoryResult(value: JsonRecord): EngineSearchResult | null {
  if (typeof value.file_path !== "string" || !/^memories\/[^/.][^/]*\.md$/.test(value.file_path)) {
    return null;
  }
  const title = typeof value.title === "string" && value.title.length > 0
    ? value.title.replace(/^summary:\s*/i, "").replace(/\.\.\.$/, "")
    : titleFromSlug(basename(value.file_path, ".md"));
  const match = typeof value.matched_chunk === "string" && value.matched_chunk.length > 0
    ? value.matched_chunk
    : typeof value.content === "string" ? value.content : "";
  return {
    ref: value.file_path,
    title,
    match,
    score: typeof value.score === "number" && Number.isFinite(value.score) ? value.score : 0,
  };
}

function malformedJsonFailure(operation: EngineOperation, missing: string): EngineResult<never> {
  return { ok: false, message: `${operation.label} JSON did not include valid ${missing}.` };
}

function interruptedFailure(operation: EngineOperation, run: ExternalRun): EngineResult<never> {
  const exitCode = run.interrupted === "SIGINT" ? 130 : 143;
  return { ok: false, message: `${operation.label} was interrupted (exit ${exitCode}).`, exitCode };
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
    .find((line) => line.length > 0 && !/\b(Terminated|Killed):?\s*\d*\b/.test(line)) ?? null;
}

function reportsSupportedBasicMemoryVersion(run: ExternalRun): boolean {
  return `${run.stdout}\n${run.stderr}`
    .split("\n")
    .some((line) => line.trim() === `Basic Memory version: ${SUPPORTED_BASIC_MEMORY_VERSION}`);
}

function engineTimeoutMs(operation: EngineOperation): number {
  const reindexOverride = Number(process.env.KB_ENGINE_REINDEX_TIMEOUT_MS);
  if (operation === ENGINE_OPERATIONS.reindex && Number.isInteger(reindexOverride) && reindexOverride > 0) {
    return reindexOverride;
  }
  const override = Number(process.env.KB_ENGINE_TIMEOUT_MS);
  if (
    operation !== ENGINE_OPERATIONS.bmAvailability
    && operation !== ENGINE_OPERATIONS.uvxAvailability
    && Number.isInteger(override)
    && override > 0
  ) {
    return override;
  }
  return operation.timeoutMs;
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  Bun.spawnSync(["/bin/kill", `-${signal}`, "--", `-${pid}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

function scheduleProcessGroupEscalation(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      killProcessGroup(pid, "SIGKILL");
      resolve();
    }, 100);
    timer.unref?.();
  });
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isJsonRecord(value) && Object.values(value).every((entry) => isNonNegativeInteger(entry));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSchemaSource(value: unknown): value is "observation" | "relation" {
  return value === "observation" || value === "relation";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
