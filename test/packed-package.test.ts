import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
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

const repoRoot = resolve(import.meta.dir, "..");

async function run(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
): Promise<CommandResult> {
  const process = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { code, stdout, stderr };
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
      { cwd: repoRoot, env: npmEnv },
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
      { cwd, env: npmEnv },
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
    const kb = (args: string[], commandCwd = cwd) => run(packedKb, args, { cwd: commandCwd, env: cliEnv });

    const version = await kb(["--version"]);
    expect(version).toEqual({ code: 0, stdout: `kb ${packed!.version}\n`, stderr: "" });

    const start = await kb(["start"]);
    expectSuccess(start);
    expect(start.stdout).toContain("First run");

    const created = await kb(["new", "packed-smoke"]);
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
    const added = await kb(["add", source, "--in", "packed-smoke"]);
    expectSuccess(added);
    expect(added.stdout).toContain("Add playbook");

    const drafted = await kb(["draft", "Packed Memory", "--in", "packed-smoke"]);
    expect(drafted).toEqual({ code: 0, stdout: "Created memories/packed-memory.md\n", stderr: "" });
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

    const searched = await kb(["search", "packed workflow", "--in", "packed-smoke"]);
    expectSuccess(searched);
    expect(searched.stdout).toContain("1. memories/packed-memory.md | Packed Memory");

    const status = await kb(["status", "--in", "packed-smoke"]);
    expectSuccess(status);
    expect(status.stdout).toContain("Search: plain files");
    expect(status.stdout).toContain("Sources: 1");
    expect(status.stdout).toContain("Memories: 1");
  });
}, 30_000);

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
