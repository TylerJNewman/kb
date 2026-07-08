import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type KbRun = {
  code: number;
  stdout: string;
  stderr: string;
};

export type KbHarness = {
  root: string;
  home: string;
  xdgConfigHome: string;
  cwd: string;
  pathDir: string;
  runKb: (args: string[]) => Promise<KbRun>;
  run: (cmd: string, args: string[], options?: { cwd?: string }) => Promise<KbRun>;
  writeFakeExecutable: (name: string, body: string) => Promise<string>;
  listCwd: () => Promise<string[]>;
  cleanup: () => Promise<void>;
};

const repoRoot = resolve(import.meta.dir, "../..");
const kbBin = join(repoRoot, "bin/kb");

export async function createKbHarness(): Promise<KbHarness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kb-cli-test-")));
  const home = join(root, "home");
  const xdgConfigHome = join(root, "xdg");
  const cwd = join(root, "cwd");
  const pathDir = join(root, "path");

  await Promise.all([mkdir(home), mkdir(xdgConfigHome), mkdir(cwd), mkdir(pathDir)]);

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    PATH: pathDir,
    BUN_BIN: process.execPath,
    KB_BIN: kbBin,
  };

  const writeFakeExecutable = async (name: string, body: string): Promise<string> => {
    const path = join(pathDir, name);
    await writeFile(path, body, { mode: 0o755 });
    return path;
  };

  await writeFakeExecutable(
    "kb",
    "#!/bin/sh\nexec \"$BUN_BIN\" \"$KB_BIN\" \"$@\"\n",
  );

  const run = async (cmd: string, args: string[], options?: { cwd?: string }): Promise<KbRun> => {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: options?.cwd ?? cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { code, stdout, stderr };
  };

  return {
    root,
    home,
    xdgConfigHome,
    cwd,
    pathDir,
    runKb: (args) => run("kb", args),
    run,
    writeFakeExecutable,
    listCwd: () => readdir(cwd),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
