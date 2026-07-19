import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
});

afterEach(async () => {
  await harness.cleanup();
});

test("kb new removes every ordinary failed transaction and the same command retries", async () => {
  const phases = [
    "after-stage-directory",
    "after-kb-yaml",
    "after-agents-md",
    "after-claude-md",
    "after-index-md",
    "after-log-md",
    "after-raw",
    "after-memories",
    "after-git",
    "after-visibility",
  ];

  for (const [index, phase] of phases.entries()) {
    const name = `failed-${index}`;
    const failed = await harness.run("kb", ["new", name], { env: { KB_FAIL_SCAFFOLD_TRANSACTION: phase } });
    expect(failed.code, phase).toBe(69);
    await expect(stat(join(harness.home, "kb", name)), phase).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(harness.home, "kb", `.kb-${name}.staging`)), phase).rejects.toMatchObject({ code: "ENOENT" });
    const registryPath = join(harness.xdgConfigHome, "kb", "config.yaml");
    if (await exists(registryPath)) {
      expect(await readFile(registryPath, "utf8"), phase).not.toContain(`  ${name}:`);
    }

    const retried = await harness.runKb(["new", name]);
    expect(retried.code, `${phase}: ${retried.stderr}`).toBe(0);
  }
});

test("a failure after Registry publication keeps a complete registered kb new and retry only finalizes", async () => {
  const failed = await harness.run("kb", ["new", "committed"], { env: { KB_FAIL_SCAFFOLD_TRANSACTION: "after-registry" } });
  expect(failed.code).toBe(69);
  expect(await readFile(join(harness.home, "kb", "committed", "kb.yaml"), "utf8")).toContain("schemaVersion: 1");
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toContain("  committed:");
  const retried = await harness.runKb(["new", "committed"]);
  expect(retried.code, retried.stderr).toBe(0);
  expect(await readdir(join(harness.home, "kb", "committed"))).not.toContain(".kb-scaffold-transaction.json");
});

test("kb new resumes a hard interruption after atomic visibility", async () => {
  const interrupted = await harness.run("kb", ["new", "recoverable"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-visibility" },
  });
  expect(interrupted.code).toBe(86);
  expect(await readdir(join(harness.home, "kb", "recoverable"))).toContain(".kb-scaffold-transaction.json");

  const retried = await harness.runKb(["new", "recoverable"]);
  expect(retried.code, retried.stderr).toBe(0);
  expect(await readdir(join(harness.home, "kb", "recoverable"))).not.toContain(".kb-scaffold-transaction.json");
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toContain("recoverable:");
});

test("kb new recovers an artifact created in the journal update crash gap", async () => {
  const interrupted = await harness.run("kb", ["new", "gap"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-create-kb-yaml" },
  });
  expect(interrupted.code).toBe(86);
  expect(await readFile(join(harness.home, "kb", ".kb-gap.staging", "kb.yaml"), "utf8")).toContain("schemaVersion: 1");

  const retried = await harness.runKb(["new", "gap"]);
  expect(retried.code, retried.stderr).toBe(0);
  await expect(stat(join(harness.home, "kb", ".kb-gap.staging"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("initial atomic receipt temp is recoverable for new and init", async () => {
  const interruptedNew = await harness.run("kb", ["new", "temp-gap"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-receipt-temp" },
  });
  expect(interruptedNew.code).toBe(86);
  expect(await readdir(join(harness.home, "kb", ".kb-temp-gap.staging"))).toContain(".kb-scaffold-transaction.json.tmp");
  expect((await harness.runKb(["new", "temp-gap"])).code).toBe(0);

  const initCwd = join(harness.root, "temp-init");
  await mkdir(initCwd);
  const interruptedInit = await harness.run("kb", ["init"], {
    cwd: initCwd,
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-receipt-temp" },
  });
  expect(interruptedInit.code).toBe(86);
  expect(await readdir(initCwd)).toContain(".kb-scaffold-transaction.json.tmp");
  const retriedInit = await harness.run("kb", ["init"], { cwd: initCwd });
  expect(retriedInit.code, retriedInit.stderr).toBe(0);
});

test("a legacy schema-version-1 receipt past index.md recovers and adds the Claude shim", async () => {
  const interrupted = await harness.run("kb", ["init"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-index-md" },
  });
  expect(interrupted.code).toBe(86);
  const receiptPath = join(harness.cwd, ".kb-scaffold-transaction.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { schemaVersion: number; artifacts: Array<{ path: string }> };
  expect(receipt.schemaVersion).toBe(1);
  receipt.artifacts = receipt.artifacts.filter((artifact) => artifact.path !== "CLAUDE.md");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await rm(join(harness.cwd, "CLAUDE.md"));

  const recovered = await harness.runKb(["init"]);

  expect(recovered.code, recovered.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
});

test("a complete legacy receipt preserves its original log across a UTC date boundary", async () => {
  const failed = await harness.run("kb", ["init"], {
    env: { KB_NOW: "2026-07-18T23:59:00.000Z", KB_FAIL_SCAFFOLD_TRANSACTION: "after-registry" },
  });
  expect(failed.code).toBe(69);
  const receiptPath = join(harness.cwd, ".kb-scaffold-transaction.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { schemaVersion: number; phase: string; artifacts: Array<{ path: string }> };
  expect(receipt.schemaVersion).toBe(1);
  expect(receipt.phase).toBe("registered");
  receipt.artifacts = receipt.artifacts.filter((artifact) => artifact.path !== "CLAUDE.md");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await rm(join(harness.cwd, "CLAUDE.md"));

  const normalizationInterrupted = await harness.run("kb", ["init"], {
    env: {
      KB_NOW: "2026-07-19T00:01:00.000Z",
      KB_FAIL_SCAFFOLD_TRANSACTION: "after-legacy-normalization",
    },
  });
  expect(normalizationInterrupted.code).toBe(69);
  expect(await readFile(join(harness.cwd, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");

  const recovered = await harness.run("kb", ["init"], {
    env: { KB_NOW: "2026-07-20T00:01:00.000Z" },
  });

  expect(recovered.code, recovered.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, "log.md"), "utf8")).toContain("## [2026-07-18] created | cwd");
  expect(await readFile(join(harness.cwd, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  expect(await readdir(harness.cwd)).not.toContain(".kb-scaffold-transaction.json");
});

test("same-name kb new commands serialize the target transaction", async () => {
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/sleep 0.15\n/bin/mkdir .git\n");
  const results = await Promise.all([harness.runKb(["new", "one-winner"]), harness.runKb(["new", "one-winner"])]);
  expect(results.map((result) => result.code).sort(), results.map((result) => result.stderr).join(" | ")).toEqual([0, 64]);
  expect(await readFile(join(harness.xdgConfigHome, "kb", "config.yaml"), "utf8")).toContain("  one-winner:");
  expect(await readdir(join(harness.home, "kb"))).not.toContain(".kb-one-winner.staging");
});

test("kb new preserves a target a user creates before the visibility commit", async () => {
  const marker = join(harness.root, "visibility-ready");
  const running = harness.run("kb", ["new", "user-won"], {
    env: { KB_TEST_SCAFFOLD_VISIBILITY_MARKER: marker, KB_TEST_PAUSE_SCAFFOLD_VISIBILITY_MS: "300" },
  });
  await waitForFile(marker);
  const target = join(harness.home, "kb", "user-won");
  await mkdir(target);
  await writeFile(join(target, "keep"), "user bytes\n");
  const result = await running;
  expect(result.code).toBe(64);
  expect(await readFile(join(target, "keep"), "utf8")).toBe("user bytes\n");
  expect(await readdir(join(harness.home, "kb"))).not.toContain(".kb-user-won.staging");
});

test("a crafted recovery receipt cannot escape the scaffold artifact allowlist", async () => {
  await writeFile(join(harness.cwd, "keep.txt"), "do not delete\n");
  const interrupted = await harness.run("kb", ["init"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-kb-yaml" },
  });
  expect(interrupted.code).toBe(86);
  const receiptPath = join(harness.cwd, ".kb-scaffold-transaction.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { artifacts: Array<{ path: string }> };
  receipt.artifacts[0]!.path = "../keep.txt";
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);

  const retried = await harness.runKb(["init"]);
  expect(retried.code).toBe(69);
  expect(retried.stderr).toContain("invalid scaffold artifact");
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("do not delete\n");
});

test("a truncated durable receipt fails closed without cleaning user-visible paths", async () => {
  const interrupted = await harness.run("kb", ["new", "truncated"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-kb-yaml" },
  });
  expect(interrupted.code).toBe(86);
  const staging = join(harness.home, "kb", ".kb-truncated.staging");
  await writeFile(join(staging, ".kb-scaffold-transaction.json"), "{\n");

  const retried = await harness.runKb(["new", "truncated"]);
  expect(retried.code).toBe(69);
  expect(retried.stderr).toContain("cannot read scaffold recovery receipt");
  expect(await readFile(join(staging, "kb.yaml"), "utf8")).toContain("schemaVersion: 1");
});

test("kb new refuses pre-existing files, directories, and symlinks without changing bytes", async () => {
  const kbHome = join(harness.home, "kb");
  await mkdir(kbHome);
  await writeFile(join(kbHome, "file"), Buffer.from([0, 1, 2, 255]));
  await mkdir(join(kbHome, "directory"));
  await writeFile(join(kbHome, "directory", "keep"), "keep\n");
  await symlink(join(kbHome, "directory"), join(kbHome, "link"));

  for (const name of ["file", "directory", "link"]) {
    const before = name === "file" ? await readFile(join(kbHome, name)) : null;
    const result = await harness.runKb(["new", name]);
    expect(result.code, `${name}: ${result.stderr}`).toBe(64);
    if (before !== null) {
      expect(await readFile(join(kbHome, name))).toEqual(before);
    }
  }
  expect(await readFile(join(kbHome, "directory", "keep"), "utf8")).toBe("keep\n");
});

test("kb init preflights every owned name with lstat before writing", async () => {
  await writeFile(join(harness.cwd, "keep.bin"), Buffer.from([0, 255, 3]));
  await mkdir(join(harness.cwd, "elsewhere"));
  await symlink(join(harness.cwd, "elsewhere"), join(harness.cwd, "raw"));

  const result = await harness.runKb(["init"]);
  expect(result.code).toBe(64);
  expect(await readFile(join(harness.cwd, "keep.bin"))).toEqual(Buffer.from([0, 255, 3]));
  expect((await readdir(harness.cwd)).sort()).toEqual(["elsewhere", "keep.bin", "raw"]);
});

test("kb init preserves every byte of pre-existing repository metadata", async () => {
  await mkdir(join(harness.cwd, ".git"));
  await writeFile(join(harness.cwd, ".git", "HEAD"), "ref: refs/heads/custom\n");
  await writeFile(join(harness.cwd, "keep.txt"), "keep\n");
  await harness.writeFakeExecutable("git", "#!/bin/sh\necho must-not-run >&2\nexit 1\n");

  const result = await harness.runKb(["init"]);
  expect(result.code, result.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/custom\n");
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("keep\n");
});

test("kb init removes only its artifacts after Registry failure and retries beside original content", async () => {
  await writeFile(join(harness.cwd, "keep.txt"), "original bytes\n");
  const failed = await harness.run("kb", ["init"], { env: { KB_FAIL_REGISTRY_COMMIT: "before-rename" } });
  expect(failed.code).toBe(69);
  expect((await readdir(harness.cwd)).sort()).toEqual(["keep.txt"]);
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("original bytes\n");

  const retried = await harness.runKb(["init"]);
  expect(retried.code, retried.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("original bytes\n");
});

test("Registry committed-then-error is compare-removed before scaffold cleanup", async () => {
  const failed = await harness.run("kb", ["new", "after-rename"], { env: { KB_FAIL_REGISTRY_COMMIT: "after-rename" } });
  expect(failed.code).toBe(69);
  await expect(stat(join(harness.home, "kb", "after-rename"))).rejects.toMatchObject({ code: "ENOENT" });
  const registryPath = join(harness.xdgConfigHome, "kb", "config.yaml");
  if (await exists(registryPath)) expect(await readFile(registryPath, "utf8")).not.toContain("after-rename");
  const retried = await harness.runKb(["new", "after-rename"]);
  expect(retried.code, retried.stderr).toBe(0);
});

test("a pre-commit Registry lock failure cleans the scaffold without a second lock attempt", async () => {
  const failed = await harness.run("kb", ["new", "lock-failed"], { env: { KB_FAIL_REGISTRY_LOCK: "after-mkdir" } });
  expect(failed.code).toBe(69);
  await expect(stat(join(harness.home, "kb", "lock-failed"))).rejects.toMatchObject({ code: "ENOENT" });
  const retried = await harness.runKb(["new", "lock-failed"]);
  expect(retried.code, retried.stderr).toBe(0);
});

test("kb init rolls back every injected scaffold phase and retries in the same existing folder", async () => {
  const phases = ["after-kb-yaml", "after-agents-md", "after-claude-md", "after-index-md", "after-log-md", "after-raw", "after-memories", "after-git"];

  for (const [index, phase] of phases.entries()) {
    const cwd = join(harness.root, `init-${index}`);
    await mkdir(cwd);
    await writeFile(join(cwd, "keep.bin"), Buffer.from([index, 0, 255]));
    const failed = await harness.run("kb", ["init"], { cwd, env: { KB_FAIL_SCAFFOLD_TRANSACTION: phase } });
    expect(failed.code, phase).toBe(69);
    expect((await readdir(cwd)).sort(), phase).toEqual(["keep.bin"]);
    expect(await readFile(join(cwd, "keep.bin")), phase).toEqual(Buffer.from([index, 0, 255]));

    const retried = await harness.run("kb", ["init"], { cwd });
    expect(retried.code, `${phase}: ${retried.stderr}`).toBe(0);
  }
});

test("kb init captures and removes partial git metadata after git init fails", async () => {
  await writeFile(join(harness.cwd, "keep.txt"), "keep\n");
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\nprintf partial > .git/partial\nexit 1\n");

  const failed = await harness.runKb(["init"]);
  expect(failed.code).toBe(69);
  expect(failed.stderr).toBe("kb: git init failed\n");
  expect((await readdir(harness.cwd)).sort()).toEqual(["keep.txt"]);

  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  expect((await harness.runKb(["init"])).code).toBe(0);
});

test("kb init preserves concurrent edits, remains needs-attention, and retries after the user moves the edit", async () => {
  const marker = join(harness.root, "cleanup-ready");
  await writeFile(join(harness.cwd, "keep.txt"), "keep\n");
  const running = harness.run("kb", ["init"], {
    env: {
      KB_FAIL_REGISTRY_COMMIT: "before-rename",
      KB_TEST_SCAFFOLD_CLEANUP_MARKER: marker,
      KB_TEST_PAUSE_SCAFFOLD_CLEANUP_MS: "300",
    },
  });
  await waitForFile(marker);
  await writeFile(join(harness.cwd, "kb.yaml"), "concurrent user edit\n");
  const failed = await running;

  expect(failed.code).toBe(69);
  expect(failed.stderr).toContain("cleanup preserved changed content");
  expect(failed.stderr).toContain("Inspect it, keep or move those files");
  expect(await readFile(join(harness.cwd, "kb.yaml"), "utf8")).toBe("concurrent user edit\n");
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("keep\n");
  expect(await readdir(harness.cwd)).toContain("AGENTS.md");
  expect(await readFile(join(harness.cwd, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");

  const stillBlocked = await harness.runKb(["init"]);
  expect(stillBlocked.code).toBe(69);
  expect(stillBlocked.stderr).toContain("previous cleanup detected changed content");
  await rename(join(harness.cwd, "kb.yaml"), join(harness.cwd, "keep-user-kb.yaml"));
  const retried = await harness.runKb(["init"]);
  expect(retried.code, retried.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, "keep-user-kb.yaml"), "utf8")).toBe("concurrent user edit\n");
});

test("kb init recovers a hard interruption during scaffold creation and retries", async () => {
  await writeFile(join(harness.cwd, "keep.txt"), "keep\n");
  const interrupted = await harness.run("kb", ["init"], {
    env: { KB_EXIT_SCAFFOLD_TRANSACTION: "after-index-md" },
  });
  expect(interrupted.code).toBe(86);
  expect(await readdir(harness.cwd)).toContain(".kb-scaffold-transaction.json");

  const retried = await harness.runKb(["init"]);
  expect(retried.code, retried.stderr).toBe(0);
  expect(await readFile(join(harness.cwd, "keep.txt"), "utf8")).toBe("keep\n");
  expect(await readdir(harness.cwd)).not.toContain(".kb-scaffold-transaction.json");
});

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await stat(path);
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
