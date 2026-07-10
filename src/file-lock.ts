import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type FileLockOptions = {
  lockPath: string;
  label: string;
  createError: (message: string) => Error;
  timeoutMs?: number;
  staleMs?: number;
  beforeOwnerWrite?: () => void;
  beforeRecoveryOwnerWrite?: () => void;
};

class LegacyFileLockError extends Error {}

export function withFileLock<T>(options: FileLockOptions, action: () => Promise<T>): Promise<T>;
export function withFileLock<T>(
  lockPath: string,
  label: string,
  action: () => Promise<T>,
  timeoutMs?: number,
): Promise<T>;
export async function withFileLock<T>(
  optionsOrPath: FileLockOptions | string,
  actionOrLabel: (() => Promise<T>) | string,
  legacyAction?: () => Promise<T>,
  legacyTimeoutMs?: number,
): Promise<T> {
  const options: FileLockOptions = typeof optionsOrPath === "string"
    ? {
        lockPath: optionsOrPath,
        label: actionOrLabel as string,
        timeoutMs: legacyTimeoutMs,
        createError: (message) => new LegacyFileLockError(message),
      }
    : optionsOrPath;
  const action = (typeof actionOrLabel === "function" ? actionOrLabel : legacyAction)!;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const staleMs = options.staleMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  const recoveryPath = `${options.lockPath}.recovery`;
  await mkdir(dirname(options.lockPath), { recursive: true });

  while (true) {
    if (await pathExists(recoveryPath)) {
      await recoverStaleRecoveryMarker(recoveryPath, staleMs);
      if (await pathExists(recoveryPath)) {
        await waitForRetry(options, deadline);
        continue;
      }
    }
    try {
      await mkdir(options.lockPath);
      try {
        options.beforeOwnerWrite?.();
        await writeFile(join(options.lockPath, "owner"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } catch (error) {
        await rm(options.lockPath, { recursive: true, force: true });
        throw options.createError(`${options.label} lock owner write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    } catch (error) {
      if (isLockError(error, options.createError)) {
        throw error;
      }
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw options.createError(`${options.label} lock acquisition failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await recoverStaleLock(options, recoveryPath, staleMs);
      await waitForRetry(options, deadline);
    }
  }

  try {
    return await action();
  } finally {
    await rm(options.lockPath, { recursive: true, force: true });
  }
}

async function recoverStaleLock(options: FileLockOptions, recoveryPath: string, staleMs: number): Promise<void> {
  try {
    await mkdir(recoveryPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return;
    }
    throw error;
  }

  try {
    try {
      options.beforeRecoveryOwnerWrite?.();
      await writeFile(join(recoveryPath, "owner"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    } catch (error) {
      await rm(recoveryPath, { recursive: true, force: true });
      throw options.createError(
        `${options.label} recovery lock owner write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await recoverStaleLockWhileSerialized(options.lockPath, staleMs);
  } finally {
    await rm(recoveryPath, { recursive: true, force: true });
  }
}

async function recoverStaleRecoveryMarker(recoveryPath: string, staleMs: number): Promise<void> {
  let owner: { pid?: unknown; createdAt?: unknown };
  try {
    owner = JSON.parse(await readFile(join(recoveryPath, "owner"), "utf8")) as { pid?: unknown; createdAt?: unknown };
  } catch {
    await removeIfStale(recoveryPath, staleMs);
    return;
  }

  if (typeof owner.pid !== "number" || typeof owner.createdAt !== "number") {
    await removeIfStale(recoveryPath, staleMs);
    return;
  }
  if (Date.now() - owner.createdAt < staleMs || isPidAlive(owner.pid)) {
    return;
  }
  await rm(recoveryPath, { recursive: true, force: true });
}

async function recoverStaleLockWhileSerialized(lockPath: string, staleMs: number): Promise<void> {
  let owner: { pid?: unknown; createdAt?: unknown };
  try {
    owner = JSON.parse(await readFile(join(lockPath, "owner"), "utf8")) as { pid?: unknown; createdAt?: unknown };
  } catch {
    await removeIfStale(lockPath, staleMs);
    return;
  }

  if (typeof owner.pid !== "number" || typeof owner.createdAt !== "number") {
    await removeIfStale(lockPath, staleMs);
    return;
  }
  if (isPidAlive(owner.pid)) {
    return;
  }
  await rm(lockPath, { recursive: true, force: true });
}

async function waitForRetry(options: FileLockOptions, deadline: number): Promise<void> {
  if (Date.now() >= deadline) {
    throw options.createError(`${options.label} lock acquisition timed out`);
  }
  await Bun.sleep(25);
}

async function pathExists(path: string): Promise<boolean> {
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

async function removeIfStale(lockPath: string, staleMs: number): Promise<void> {
  try {
    const lock = await stat(lockPath);
    if (Date.now() - lock.mtimeMs >= staleMs) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch {
    return;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isLockError(error: unknown, createError: (message: string) => Error): boolean {
  return error instanceof (createError("").constructor as new (...args: unknown[]) => Error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
