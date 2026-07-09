import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

type FileLockOptions = {
  lockPath: string;
  label: string;
  createError: (message: string) => Error;
  timeoutMs?: number;
  staleMs?: number;
  beforeOwnerWrite?: () => void;
};

export async function withFileLock<T>(options: FileLockOptions, action: () => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const staleMs = options.staleMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
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
      await recoverStaleLock(options.lockPath, staleMs);
      if (Date.now() >= deadline) {
        throw options.createError(`${options.label} lock acquisition timed out`);
      }
      await Bun.sleep(25);
    }
  }

  try {
    return await action();
  } finally {
    await rm(options.lockPath, { recursive: true, force: true });
  }
}

async function recoverStaleLock(lockPath: string, staleMs: number): Promise<void> {
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
  if (Date.now() - owner.createdAt < staleMs) {
    return;
  }
  if (isPidAlive(owner.pid)) {
    return;
  }
  await rm(lockPath, { recursive: true, force: true });
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
