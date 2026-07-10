import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type Owner = {
  pid: number;
  createdAt: number;
  token: string;
};

export async function withFileLock<T>(
  lockPath: string,
  label: string,
  action: () => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const owner: Owner = { pid: process.pid, createdAt: Date.now(), token: randomUUID() };
  const deadline = Date.now() + timeoutMs;

  while (!(await tryClaim(lockPath, owner))) {
    await recoverStaleClaim(lockPath);
    if (Date.now() >= deadline) {
      throw new Error(`${label} lock acquisition timed out`);
    }
    await Bun.sleep(25);
  }

  try {
    return await action();
  } finally {
    await releaseIfOwned(lockPath, owner);
  }
}

async function tryClaim(lockPath: string, owner: Owner): Promise<boolean> {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }

  try {
    await writeFile(join(lockPath, "owner"), `${JSON.stringify(owner)}\n`, { flag: "wx" });
    return true;
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
}

async function recoverStaleClaim(lockPath: string): Promise<void> {
  let owner: Owner | null = null;
  try {
    const value = JSON.parse(await readFile(join(lockPath, "owner"), "utf8")) as Partial<Owner>;
    if (typeof value.pid === "number" && typeof value.createdAt === "number" && typeof value.token === "string") {
      owner = value as Owner;
    }
  } catch {
    // An interrupted claimant may leave an ownerless directory briefly.
  }

  if (owner !== null) {
    if (isPidAlive(owner.pid)) {
      return;
    }
    const current = await readOwner(lockPath);
    if (current?.token === owner.token) {
      await rm(lockPath, { recursive: true, force: true });
    }
    return;
  }

  try {
    const metadata = await stat(lockPath);
    if (Date.now() - metadata.mtimeMs >= 250 && (await readOwner(lockPath)) === null) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function releaseIfOwned(lockPath: string, owner: Owner): Promise<void> {
  const current = await readOwner(lockPath);
  if (current?.token === owner.token && current.pid === owner.pid) {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function readOwner(lockPath: string): Promise<Owner | null> {
  try {
    const value = JSON.parse(await readFile(join(lockPath, "owner"), "utf8")) as Partial<Owner>;
    return typeof value.pid === "number" && typeof value.createdAt === "number" && typeof value.token === "string"
      ? value as Owner
      : null;
  } catch {
    return null;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
