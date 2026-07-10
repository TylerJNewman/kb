import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withFileLock } from "../src/file-lock";

class TestLockError extends Error {}

test("a process death while claiming stale-lock recovery cannot permanently strand the lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-file-lock-death-"));
  const lockPath = join(root, "resource.lock");
  const recoveryPath = `${lockPath}.recovery`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner"), JSON.stringify({ pid: 2_147_483_647, createdAt: 0 }));

  const moduleUrl = pathToFileURL(resolve(import.meta.dir, "../src/file-lock.ts")).href;
  const script = `
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    class TestLockError extends Error {}
    await withFileLock({
      lockPath: ${JSON.stringify(lockPath)},
      label: "test",
      staleMs: 0,
      createError: (message) => new TestLockError(message),
      beforeRecoveryOwnerWrite: () => process.exit(86),
    }, async () => {});
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [childCode, childStderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (childCode !== 86) {
    throw new Error(`expected recovery claimant to exit 86, got ${childCode}: ${childStderr}`);
  }
  expect(await stat(recoveryPath)).toBeDefined();

  await utimes(recoveryPath, new Date(0), new Date(0));
  let entered = false;
  await withFileLock(
    {
      lockPath,
      label: "test",
      timeoutMs: 500,
      staleMs: 1,
      createError: (message) => new TestLockError(message),
    },
    async () => {
      entered = true;
    },
  );

  expect(entered).toBe(true);
  await expect(readFile(join(recoveryPath, "owner"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await rm(root, { recursive: true, force: true });
});

test("stale recovery detection never steals a recovery marker from a live owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-file-lock-live-"));
  const lockPath = join(root, "resource.lock");
  const recoveryPath = `${lockPath}.recovery`;
  await mkdir(lockPath);
  await mkdir(recoveryPath);
  await writeFile(join(recoveryPath, "owner"), JSON.stringify({ pid: process.pid, createdAt: 0 }));

  await expect(withFileLock(
    {
      lockPath,
      label: "test",
      timeoutMs: 50,
      staleMs: 0,
      createError: (message) => new TestLockError(message),
    },
    async () => {},
  )).rejects.toThrow("test lock acquisition timed out");
  expect(JSON.parse(await readFile(join(recoveryPath, "owner"), "utf8"))).toMatchObject({ pid: process.pid });
  await rm(root, { recursive: true, force: true });
});
