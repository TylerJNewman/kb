import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type PackedFile = {
  path: string;
  mode: number;
};

type PackResult = {
  filename: string;
  files: PackedFile[];
  version: string;
};

type AcceptanceStage = {
  label: string;
  timeoutMs: number;
};

const repoRoot = resolve(import.meta.dir, "..");
const PACKED_CLI_TIMEOUT_MS = 5_000;
const ACCEPTANCE_STAGES = {
  npmPack: { label: "npm pack", timeoutMs: 30_000 },
  npmInstall: { label: "npm install", timeoutMs: 30_000 },
  repositoryVersion: { label: "repository kb --version", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedVersion: { label: "packed kb --version", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedStart: { label: "packed kb start", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedNew: { label: "packed kb new", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedAdd: { label: "packed kb add", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedDraft: { label: "packed kb draft", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedSearch: { label: "packed kb search", timeoutMs: PACKED_CLI_TIMEOUT_MS },
  packedStatus: { label: "packed kb status", timeoutMs: PACKED_CLI_TIMEOUT_MS },
} as const satisfies Record<string, AcceptanceStage>;

async function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stage: AcceptanceStage },
): Promise<CommandResult> {
  let timedOut = false;
  let escalation: Promise<void> | null = null;
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    detached: true,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    killProcessGroup(proc.pid, "SIGTERM");
    escalation = new Promise((resolve) => {
      const killWithSigkill = setTimeout(() => {
        killProcessGroup(proc.pid, "SIGKILL");
        resolve();
      }, 100);
      killWithSigkill.unref?.();
    });
  }, options.stage.timeoutMs);
  timeout.unref?.();
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);
  if (escalation !== null) {
    await escalation;
  }
  if (timedOut) {
    return {
      code: 124,
      stdout,
      stderr: `${stderr}${stderr.length > 0 && !stderr.endsWith("\n") ? "\n" : ""}packed acceptance: ${options.stage.label} timed out after ${options.stage.timeoutMs}ms\n`,
    };
  }
  return { code, stdout, stderr };
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  Bun.spawnSync(["/bin/kill", `-${signal}`, "--", `-${pid}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

function processExists(pid: number): boolean {
  const result = Bun.spawnSync(["/bin/kill", "-0", String(pid)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

function expectSuccess(result: CommandResult): void {
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
}

async function withAcceptanceSandbox<T>(runInSandbox: (root: string) => Promise<T>): Promise<T> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kb-packed-acceptance-")));
  try {
    return await runInSandbox(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the real npm tarball passes the clean-home core workflow", async () => {
  await withAcceptanceSandbox(async (root) => {
    const packDir = join(root, "pack");
    const installPrefix = join(root, "install");
    const home = join(root, "home");
    const xdgConfigHome = join(root, "xdg");
    const cwd = join(root, "cwd");
    const pathDir = join(root, "path");
    const npmCache = join(root, "npm-cache");

    await Promise.all([
      mkdir(packDir),
      mkdir(installPrefix),
      mkdir(home),
      mkdir(xdgConfigHome),
      mkdir(cwd),
      mkdir(pathDir),
    ]);

    const npmEnv = {
      ...process.env,
      HOME: home,
      npm_config_cache: npmCache,
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    };
    const pack = await run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
      { cwd: repoRoot, env: npmEnv, stage: ACCEPTANCE_STAGES.npmPack },
    );
    expect(pack.code, pack.stderr).toBe(0);
    const [packed] = JSON.parse(pack.stdout) as PackResult[];
    expect(packed).toBeDefined();

    const tarball = join(packDir, packed!.filename);
    expect((await stat(tarball)).isFile()).toBe(true);
    expect(
      packed!.files.every(({ path }) =>
        path === "LICENSE"
        || path === "README.md"
        || path === "package.json"
        || path === "bin/kb"
        || path.startsWith("src/"),
      ),
    ).toBe(true);
    expect(packed!.files.map(({ path }) => path)).toContain("package.json");
    expect(packed!.files.map(({ path }) => path)).toContain("src/cli.ts");
    expect(packed!.files.find(({ path }) => path === "bin/kb")?.mode).toBe(0o755);

    const install = await run(
      "npm",
      ["install", "--ignore-scripts", "--no-package-lock", "--prefix", installPrefix, tarball],
      { cwd, env: npmEnv, stage: ACCEPTANCE_STAGES.npmInstall },
    );
    expect(install.code, install.stderr).toBe(0);

    const packedKb = join(installPrefix, "node_modules/.bin/kb");
    const installedEntrypoint = await realpath(packedKb);
    expect(installedEntrypoint.startsWith(`${installPrefix}/`)).toBe(true);
    expect(installedEntrypoint.startsWith(`${repoRoot}/`)).toBe(false);
    expect((await stat(installedEntrypoint)).mode & 0o111).not.toBe(0);

    await writeFile(join(pathDir, "bun"), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
    await writeFile(join(pathDir, "git"), "#!/bin/sh\n[ \"$1\" = init ] && /bin/mkdir .git\n", { mode: 0o755 });
    const cliEnv = {
      HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      PATH: pathDir,
      TMPDIR: join(root, "tmp"),
    };
    await mkdir(cliEnv.TMPDIR);
    const kb = (stage: AcceptanceStage, args: string[], commandCwd = cwd) =>
      run(packedKb, args, { cwd: commandCwd, env: cliEnv, stage });

    const version = await kb(ACCEPTANCE_STAGES.packedVersion, ["--version"]);
    expect(version).toEqual({ code: 0, stdout: `kb ${packed!.version}\n`, stderr: "" });
    const repositoryVersion = await run(process.execPath, [join(repoRoot, "bin/kb"), "--version"], {
      cwd,
      env: cliEnv,
      stage: ACCEPTANCE_STAGES.repositoryVersion,
    });
    expect(repositoryVersion).toEqual(version);

    const start = await kb(ACCEPTANCE_STAGES.packedStart, ["start"]);
    expectSuccess(start);
    expect(start.stdout).toContain("First run");

    const created = await kb(ACCEPTANCE_STAGES.packedNew, ["new", "packed-smoke"]);
    expectSuccess(created);
    const kbDir = join(home, "kb", "packed-smoke");
    expect(created.stdout).toContain(`Path: ${kbDir}`);
    for (const file of ["kb.yaml", "AGENTS.md", "index.md", "log.md"]) {
      expect((await stat(join(kbDir, file))).isFile()).toBe(true);
    }
    for (const directory of ["raw", "memories"]) {
      expect((await stat(join(kbDir, directory))).isDirectory()).toBe(true);
    }

    const source = join(cwd, "packed-source.md");
    await writeFile(source, "# Packed source\n\nThe packed workflow is isolated.\n");
    const added = await kb(ACCEPTANCE_STAGES.packedAdd, ["add", source, "--in", "packed-smoke"]);
    expectSuccess(added);
    expect(added.stdout).toContain("Add playbook");

    const drafted = await kb(ACCEPTANCE_STAGES.packedDraft, ["draft", "Packed Memory", "--in", "packed-smoke"]);
    expect(drafted.code).toBe(0);
    expect(drafted.stderr).toBe("");
    expect(drafted.stdout).toContain("Created memories/packed-memory.md\n");
    expect(drafted.stdout).toContain("Draft playbook");
    await writeFile(join(kbDir, "memories/packed-memory.md"), `---
title: Packed Memory
type: note
tags:
  - acceptance
permalink: packed-memory
---

## Summary

The packed workflow is isolated.
`);
    await writeFile(join(kbDir, "index.md"), `# KB Index

Line format:
- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>
- [[memories/packed-memory.md|Packed Memory]] | category: acceptance | summary: The packed workflow is isolated.
`);

    const searched = await kb(ACCEPTANCE_STAGES.packedSearch, ["search", "packed workflow", "--in", "packed-smoke"]);
    expectSuccess(searched);
    expect(searched.stdout).toContain("1. memories/packed-memory.md | Packed Memory");

    const status = await kb(ACCEPTANCE_STAGES.packedStatus, ["status", "--in", "packed-smoke"]);
    expectSuccess(status);
    expect(status.stdout).toContain("Search: plain files");
    expect(status.stdout).toContain("Sources: 1");
    expect(status.stdout).toContain("Memories: 1");
  });
}, 120_000);

test("the packed acceptance sandbox is removed when verification fails", async () => {
  let sandboxRoot = "";

  await expect(
    withAcceptanceSandbox(async (root) => {
      sandboxRoot = root;
      await writeFile(join(root, "failure-artifact"), "temporary\n");
      throw new Error("injected acceptance failure");
    }),
  ).rejects.toThrow("injected acceptance failure");

  expect(await Bun.file(join(sandboxRoot, "failure-artifact")).exists()).toBe(false);
  expect(await Bun.file(sandboxRoot).exists()).toBe(false);
});

test("a packed acceptance stage reports its name when it times out", async () => {
  const result = await run("/bin/sleep", ["0.3"], {
    cwd: repoRoot,
    env: { ...process.env },
    stage: { label: "packed test stage", timeoutMs: 50 },
  });

  expect(result).toEqual({
    code: 124,
    stdout: "",
    stderr: "packed acceptance: packed test stage timed out after 50ms\n",
  });
});

test("a timed-out stage terminates descendants and removes its acceptance sandbox", async () => {
  let sandboxRoot = "";
  const outcome = await withAcceptanceSandbox(async (root) => {
    sandboxRoot = root;
    const script = join(root, "forking-stage");
    const childScript = join(root, "term-resistant-child");
    const parentPidFile = join(root, "parent.pid");
    const childPidFile = join(root, "child.pid");
    const termFile = join(root, "term-signals");
    await writeFile(childScript, `#!/bin/sh
echo $$ > "$CHILD_PID_FILE"
trap 'printf "child\\n" >> "$TERM_FILE"' TERM
while :; do /bin/sleep 1; done
`, { mode: 0o755 });
    await writeFile(script, `#!/bin/sh
echo $$ > "$PARENT_PID_FILE"
trap 'printf "parent\\n" >> "$TERM_FILE"' TERM
"$CHILD_SCRIPT" &
while :; do wait; done
`, { mode: 0o755 });

    const result = await run(script, [], {
      cwd: root,
      env: {
        ...process.env,
        PARENT_PID_FILE: parentPidFile,
        CHILD_PID_FILE: childPidFile,
        TERM_FILE: termFile,
        CHILD_SCRIPT: childScript,
      },
      stage: { label: "forking packed stage", timeoutMs: 500 },
    });
    expect(await Bun.file(parentPidFile).exists(), JSON.stringify(result)).toBe(true);
    expect(await Bun.file(childPidFile).exists(), JSON.stringify(result)).toBe(true);
    return {
      result,
      parentPid: Number((await readFile(parentPidFile, "utf8")).trim()),
      childPid: Number((await readFile(childPidFile, "utf8")).trim()),
      termSignals: await readFile(termFile, "utf8"),
    };
  });

  const survivors = [outcome.parentPid, outcome.childPid].filter(processExists);
  for (const pid of survivors) {
    Bun.spawnSync(["/bin/kill", "-KILL", String(pid)]);
  }

  expect(outcome.result.code).toBe(124);
  expect(outcome.result.stdout).toBe("");
  expect(outcome.result.stderr).toContain("packed acceptance: forking packed stage timed out after 500ms\n");
  expect(outcome.termSignals).toContain("parent\n");
  expect(outcome.termSignals).toContain("child\n");
  expect(survivors).toEqual([]);
  expect(await Bun.file(sandboxRoot).exists()).toBe(false);
});
