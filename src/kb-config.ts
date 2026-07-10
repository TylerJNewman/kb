import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FORMAT_VERSION } from "./memory-format";

export type KbConfig = {
  arm: "wiki" | "b0" | "b1";
  engineState: "disabled" | "enabled";
  lastReflectAt: string | null;
  engineProject: string | null;
};

export class KbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbConfigError";
  }
}

export class KbConfigCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbConfigCommitError";
  }
}

export async function readKbConfig(kbPath: string): Promise<KbConfig> {
  return parseKbConfig(await readFile(configPath(kbPath), "utf8"));
}

export async function updateKbConfig(kbPath: string, transform: (config: KbConfig) => KbConfig): Promise<KbConfig> {
  return withConfigLock(kbPath, async () => {
    const current = await readKbConfig(kbPath);
    const next = validateKbConfig(transform(current));
    await writeConfigAtomically(kbPath, serializeKbConfig(next));
    return next;
  });
}

export function serializeKbConfig(config: KbConfig): string {
  const validated = validateKbConfig(config);
  return `schemaVersion: 1
formatVersion: ${FORMAT_VERSION}
arm: ${validated.arm}
engine:
  basicMemory:
    state: ${validated.engineState}
    project: ${validated.engineProject ?? "null"}
lastReflectAt: ${validated.lastReflectAt ?? "null"}
`;
}

function parseKbConfig(text: string): KbConfig {
  const entries = parseConfigEntries(text);
  validateConfigEntryShapes(entries);
  requireUniqueMapping(entries, ["engine"]);
  requireUniqueMapping(entries, ["engine", "basicMemory"]);

  const schemaVersion = requiredUniqueScalar(entries, ["schemaVersion"]);
  if (schemaVersion !== "1") {
    throw new KbConfigError(`unsupported schemaVersion: ${schemaVersion}`);
  }

  const formatVersion = requiredUniqueScalar(entries, ["formatVersion"]);
  if (formatVersion !== FORMAT_VERSION) {
    throw new KbConfigError(`unsupported formatVersion: ${formatVersion}`);
  }

  const arm = requiredUniqueScalar(entries, ["arm"]);
  if (!isArm(arm)) {
    throw new KbConfigError(`unknown arm: ${arm}`);
  }

  const engineState = requiredUniqueScalar(entries, ["engine", "basicMemory", "state"]);
  if (!isEngineState(engineState)) {
    throw new KbConfigError(`unknown Engine state: ${engineState}`);
  }

  const projectValue = requiredUniqueScalar(entries, ["engine", "basicMemory", "project"]);
  const engineProject = projectValue === "null" ? null : projectValue;
  if (engineProject !== null && engineProject.length === 0) {
    throw new KbConfigError("empty Engine project");
  }

  const lastReflectValue = requiredUniqueScalar(entries, ["lastReflectAt"]);
  const lastReflectAt = lastReflectValue === "null" ? null : parseTimestamp("lastReflectAt", lastReflectValue);

  return validateKbConfig({ arm, engineState, engineProject, lastReflectAt });
}

function validateKbConfig(config: KbConfig): KbConfig {
  if (config.lastReflectAt !== null) {
    parseTimestamp("lastReflectAt", config.lastReflectAt);
  }
  if (config.engineState === "disabled" && config.engineProject !== null) {
    throw new KbConfigError("disabled Engine requires project null");
  }
  if (config.engineState === "enabled" && config.engineProject === null) {
    throw new KbConfigError("enabled Engine requires project");
  }
  if (config.arm === "b1") {
    if (config.engineState !== "enabled" || config.engineProject === null) {
      throw new KbConfigError("unsupported state combination: arm b1 requires enabled Engine with a project");
    }
    return config;
  }
  if (config.engineState !== "disabled") {
    throw new KbConfigError(`unsupported state combination: arm ${config.arm} requires disabled Engine`);
  }
  return config;
}

type ConfigEntry = {
  path: string[];
  value: string | null;
};

const CONFIG_SCHEMA = new Map<string, "mapping" | "scalar">([
  ["schemaVersion", "scalar"],
  ["formatVersion", "scalar"],
  ["arm", "scalar"],
  ["engine", "mapping"],
  ["engine.basicMemory", "mapping"],
  ["engine.basicMemory.state", "scalar"],
  ["engine.basicMemory.project", "scalar"],
  ["lastReflectAt", "scalar"],
]);

function validateConfigEntryShapes(entries: ConfigEntry[]): void {
  for (const entry of entries) {
    const path = entry.path.join(".");
    const expected = CONFIG_SCHEMA.get(path);
    if (expected === undefined) {
      throw new KbConfigError(`unknown configuration field: ${path}`);
    }
    const actual = entry.value === null ? "mapping" : "scalar";
    if (actual !== expected) {
      throw new KbConfigError(`expected ${expected}: ${path}`);
    }
  }
}

function parseConfigEntries(text: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const parents: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const match = /^( *)([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(line);
    if (match === null || match[1]!.length % 2 !== 0) {
      throw new KbConfigError(`invalid configuration line: ${line}`);
    }
    const depth = match[1]!.length / 2;
    if (depth > parents.length) {
      throw new KbConfigError(`invalid configuration nesting: ${line.trim()}`);
    }
    parents.length = depth;
    const key = match[2]!;
    const rawValue = match[3]?.trim() ?? "";
    const value = rawValue === "" ? null : rawValue;
    const path = [...parents, key];
    entries.push({ path, value });
    if (value === null) {
      parents.push(key);
    }
  }

  return entries;
}

function requireUniqueMapping(entries: ConfigEntry[], path: string[]): void {
  const matches = entries.filter((entry) => entry.value === null && pathsEqual(entry.path, path));
  const label = path.at(-1)!;
  if (matches.length === 0) {
    throw new KbConfigError(`missing ${label}`);
  }
  if (matches.length > 1) {
    throw new KbConfigError(`duplicate ${label}`);
  }
}

function requiredUniqueScalar(entries: ConfigEntry[], path: string[]): string {
  const matches = entries.filter((entry) => entry.value !== null && pathsEqual(entry.path, path));
  const key = path.at(-1)!;
  if (matches.length === 0) {
    throw new KbConfigError(`missing ${key}`);
  }
  if (matches.length > 1) {
    throw new KbConfigError(`duplicate ${key}`);
  }
  return matches[0]!.value!;
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function parseTimestamp(field: string, value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new KbConfigError(`invalid ${field}: ${value}`);
  }
  return value;
}

async function withConfigLock<T>(kbPath: string, action: () => Promise<T>): Promise<T> {
  if (process.env.KB_FAIL_CONFIG_LOCK === "1") {
    throw new KbConfigCommitError("config lock acquisition failed");
  }

  const lockPath = join(kbPath, ".kb.yaml.lock");
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      await mkdir(lockPath);
      try {
        if (process.env.KB_FAIL_CONFIG_LOCK === "after-mkdir") {
          throw new Error("injected owner write failure");
        }
        await writeFile(join(lockPath, "owner"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw new KbConfigCommitError(`config lock owner write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    } catch (error) {
      if (error instanceof KbConfigCommitError) {
        throw error;
      }
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw new KbConfigCommitError(`config lock acquisition failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await recoverStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new KbConfigCommitError("config lock acquisition timed out");
      }
      await Bun.sleep(25);
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function recoverStaleLock(lockPath: string): Promise<void> {
  let owner: { pid?: unknown; createdAt?: unknown } = {};
  try {
    owner = JSON.parse(await readFile(join(lockPath, "owner"), "utf8")) as { pid?: unknown; createdAt?: unknown };
  } catch {
    return;
  }

  if (typeof owner.pid !== "number" || typeof owner.createdAt !== "number") {
    return;
  }
  if (Date.now() - owner.createdAt < 10_000) {
    return;
  }
  if (isPidAlive(owner.pid)) {
    return;
  }
  await rm(lockPath, { recursive: true, force: true });
}

async function writeConfigAtomically(kbPath: string, content: string): Promise<void> {
  const path = configPath(kbPath);
  const tmp = join(kbPath, `.kb.yaml.${process.pid}.${Date.now()}.tmp`);
  try {
    if (process.env.KB_FAIL_CONFIG_COMMIT === "before-write") {
      throw new KbConfigCommitError("config commit failed before temporary write");
    }
    await writeFile(tmp, content, { flag: "wx" });
    if (process.env.KB_FAIL_CONFIG_COMMIT === "before-rename") {
      throw new KbConfigCommitError("config commit failed before atomic replacement");
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    if (error instanceof KbConfigCommitError) {
      throw error;
    }
    throw new KbConfigCommitError(`config commit failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await stat(path);
}

function configPath(kbPath: string): string {
  return join(kbPath, "kb.yaml");
}

function isArm(value: string): value is KbConfig["arm"] {
  return value === "wiki" || value === "b0" || value === "b1";
}

function isEngineState(value: string): value is KbConfig["engineState"] {
  return value === "disabled" || value === "enabled";
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
