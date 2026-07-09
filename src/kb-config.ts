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
  return `schemaVersion: 1
formatVersion: ${FORMAT_VERSION}
arm: ${config.arm}
engine:
  basicMemory:
    state: ${config.engineState}
    project: ${config.engineProject ?? "null"}
lastReflectAt: ${config.lastReflectAt ?? "null"}
`;
}

function parseKbConfig(text: string): KbConfig {
  const schemaVersion = requiredUniqueScalar(text, "schemaVersion", "top");
  if (schemaVersion !== "1") {
    throw new KbConfigError(`unsupported schemaVersion: ${schemaVersion}`);
  }

  const formatVersion = requiredUniqueScalar(text, "formatVersion", "top");
  if (formatVersion !== FORMAT_VERSION) {
    throw new KbConfigError(`unsupported formatVersion: ${formatVersion}`);
  }

  const arm = requiredUniqueScalar(text, "arm", "top");
  if (!isArm(arm)) {
    throw new KbConfigError(`unknown arm: ${arm}`);
  }

  const engineState = requiredUniqueScalar(text, "state", "engine");
  if (!isEngineState(engineState)) {
    throw new KbConfigError(`unknown Engine state: ${engineState}`);
  }

  const projectValue = requiredUniqueScalar(text, "project", "engine");
  const engineProject = projectValue === "null" ? null : projectValue;
  if (engineProject !== null && engineProject.length === 0) {
    throw new KbConfigError("empty Engine project");
  }

  const lastReflectValue = requiredUniqueScalar(text, "lastReflectAt", "top");
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

function requiredUniqueScalar(text: string, key: string, scope: "top" | "engine"): string {
  const pattern = scope === "top"
    ? new RegExp(`^${key}:\\s*(.+)$`, "gm")
    : new RegExp(`^    ${key}:\\s*(.+)$`, "gm");
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    throw new KbConfigError(`missing ${key}`);
  }
  if (matches.length > 1) {
    throw new KbConfigError(`duplicate ${key}`);
  }
  return matches[0]![1]!.trim();
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
      await writeFile(join(lockPath, "owner"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      break;
    } catch (error) {
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
