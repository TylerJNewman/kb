import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BasicMemoryAdapter, buildBasicMemoryCommand } from "../src/engine/basic-memory";

// Forced seam: the implementation spec defines the Engine subprocess boundary separately
// from the public CLI. These tests observe runner selection, process-tree timeout, and signal
// forwarding that cannot be asserted through CLI output without coupling to private temp state.
// Public schema behavior is covered through the CLI subprocess in test/schema-cli.test.ts.

const fixtureDir = resolve(import.meta.dir, "fixtures", "basic-memory-contract");

let root = "";
let binDir = "";
let kbDir = "";
let originalPath: string | undefined;
let originalTimeout: string | undefined;
let originalSecretSentinel: string | undefined;
const controlledEngineEnvKeys = [
  "HOME",
  "BASIC_MEMORY_CONFIG_DIR",
  "FASTEMBED_CACHE_PATH",
  "UV_SYSTEM_CERTS",
  "UV_NATIVE_TLS",
  "UV_OFFLINE",
  "UV_NO_CONFIG",
  "UV_NO_SYSTEM_CONFIG",
  "UV_PYTHON_DOWNLOADS",
] as const;
let originalControlledEngineEnv = new Map<string, string | undefined>();

test("Basic Memory fallback command construction stays pinned", () => {
  expect(buildBasicMemoryCommand(["tool", "search-notes", "durable observation", "--project", "research"])).toEqual([
    "uvx",
    "--from",
    "basic-memory==0.22.1",
    "bm",
    "tool",
    "search-notes",
    "durable observation",
    "--project",
    "research",
  ]);
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-engine-test-"));
  binDir = join(root, "bin");
  kbDir = join(root, "kb");
  await Promise.all([mkdir(binDir), mkdir(kbDir)]);
  originalPath = process.env.PATH;
  originalTimeout = process.env.KB_ENGINE_TIMEOUT_MS;
  originalSecretSentinel = process.env.KB_ENGINE_SECRET_SENTINEL;
  originalControlledEngineEnv = new Map(controlledEngineEnvKeys.map((key) => [key, process.env[key]]));
  process.env.PATH = binDir;
  delete process.env.KB_ENGINE_TIMEOUT_MS;
  delete process.env.KB_ENGINE_SECRET_SENTINEL;
});

afterEach(async () => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalTimeout === undefined) {
    delete process.env.KB_ENGINE_TIMEOUT_MS;
  } else {
    process.env.KB_ENGINE_TIMEOUT_MS = originalTimeout;
  }
  if (originalSecretSentinel === undefined) {
    delete process.env.KB_ENGINE_SECRET_SENTINEL;
  } else {
    process.env.KB_ENGINE_SECRET_SENTINEL = originalSecretSentinel;
  }
  for (const [key, value] of originalControlledEngineEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(root, { recursive: true, force: true });
});

test.serial("bm and uvx preserve reviewed operational and denial settings without ambient secrets", async () => {
  const expectedValues = {
    HOME: join(root, "engine-home"),
    BASIC_MEMORY_CONFIG_DIR: join(root, "basic-memory-config"),
    FASTEMBED_CACHE_PATH: join(root, "fastembed-cache"),
    UV_SYSTEM_CERTS: "true",
    UV_NATIVE_TLS: "true",
    UV_OFFLINE: "true",
    UV_NO_CONFIG: "true",
    UV_NO_SYSTEM_CONFIG: "true",
    UV_PYTHON_DOWNLOADS: "never",
  } as const;
  for (const [key, value] of Object.entries(expectedValues)) process.env[key] = value;
  process.env.KB_ENGINE_SECRET_SENTINEL = "must-not-reach-engine";
  const assertEnvironment = `
if [ -n "$KB_ENGINE_SECRET_SENTINEL" ]; then echo 'ambient secret reached Engine subprocess' >&2; exit 93; fi
if [ "$HOME" != '${expectedValues.HOME}' ]; then exit 81; fi
if [ "$BASIC_MEMORY_CONFIG_DIR" != '${expectedValues.BASIC_MEMORY_CONFIG_DIR}' ]; then exit 82; fi
if [ "$FASTEMBED_CACHE_PATH" != '${expectedValues.FASTEMBED_CACHE_PATH}' ]; then exit 83; fi
if [ "$UV_SYSTEM_CERTS" != 'true' ] || [ "$UV_NATIVE_TLS" != 'true' ]; then exit 84; fi
if [ "$UV_OFFLINE" != 'true' ] || [ "$UV_NO_CONFIG" != 'true' ]; then exit 85; fi
if [ "$UV_NO_SYSTEM_CONFIG" != 'true' ] || [ "$UV_PYTHON_DOWNLOADS" != 'never' ]; then exit 86; fi
`;
  await fakeExecutable("bm", `#!/bin/sh
${assertEnvironment}
printf 'bm' > '${join(root, "bm-environment-ok")}'
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "project" ] && [ "$2" = "list" ]; then printf '{"projects":[]}\\n'; exit 0; fi
exit 92
`);

  expect(await new BasicMemoryAdapter().listProjects(kbDir)).toEqual({ ok: true, value: [] });
  expect(await readFile(join(root, "bm-environment-ok"), "utf8")).toBe("bm");

  await rm(join(binDir, "bm"));
  await fakeExecutable("uvx", `#!/bin/sh
${assertEnvironment}
printf 'uvx' > '${join(root, "uvx-environment-ok")}'
if [ "$1" = "--version" ]; then echo 'uvx 0.8.0'; exit 0; fi
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ] && [ "$4" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "--from" ] && [ "$4" = "project" ] && [ "$5" = "list" ]; then printf '{"projects":[]}\\n'; exit 0; fi
exit 92
`);

  expect(await new BasicMemoryAdapter().listProjects(kbDir)).toEqual({ ok: true, value: [] });
  expect(await readFile(join(root, "uvx-environment-ok"), "utf8")).toBe("uvx");
});

test.serial("uvx fallback stays pinned for availability, reindex, and read-only schema inference", async () => {
  await fakeExecutable("uvx", `#!/bin/sh
printf '%s\\n' "$*" >> '${join(root, "calls")}'
if [ "$1" = "--version" ]; then echo 'uvx 0.8.0'; exit 0; fi
if [ "$1" != "--from" ] || [ "$2" != "basic-memory==0.22.1" ] || [ "$3" != "bm" ]; then exit 91; fi
shift 3
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "reindex" ]; then exit 0; fi
if [ "$1" = "schema" ] && [ "$2" = "infer" ]; then /bin/cat '${join(fixtureDir, "schema-infer.json")}'; exit 0; fi
exit 92
`);

  const adapter = new BasicMemoryAdapter();
  const result = await adapter.inferSchema(kbDir, "research", "meeting", 0.4);

  expect(result).toEqual({
    ok: true,
    value: {
      noteType: "meeting",
      notesAnalyzed: 4,
      fieldFrequencies: [{
        name: "summary",
        source: "observation",
        count: 4,
        total: 4,
        percentage: 1,
        sampleValues: ["Discussed launch timing"],
        isArray: false,
        targetType: null,
      }],
      suggestedSchema: { summary: "string, meeting summary" },
      suggestedRequired: ["summary"],
      suggestedOptional: [],
      excluded: [],
    },
  });
  expect(await readFile(join(root, "calls"), "utf8")).toBe(`--version
--from basic-memory==0.22.1 bm --version
--from basic-memory==0.22.1 bm reindex --project research --search
--from basic-memory==0.22.1 bm schema infer meeting --project research --threshold 0.4 --json --local
`);
});

test.serial("an unsupported ambient bm is rejected in favor of the pinned uvx runner", async () => {
  await fakeExecutable("bm", `#!/bin/sh
echo 'Basic Memory version: 99.0.0'
`);
  await fakeExecutable("uvx", `#!/bin/sh
printf '%s\\n' "$*" >> '${join(root, "calls")}'
if [ "$1" = "--version" ]; then echo 'uvx 0.8.0'; exit 0; fi
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ] && [ "$4" = "--version" ]; then
  echo 'Basic Memory version: 0.22.1'
  exit 0
fi
if [ "$1" = "--from" ] && [ "$4" = "tool" ]; then /bin/cat '${join(fixtureDir, "search-empty.json")}'; exit 0; fi
exit 92
`);

  expect(await new BasicMemoryAdapter().search(kbDir, "research", "meeting")).toEqual({ ok: true, value: [] });
  expect(await readFile(join(root, "calls"), "utf8")).toBe(`--version
--from basic-memory==0.22.1 bm --version
--from basic-memory==0.22.1 bm tool search-notes meeting --project research
`);
});

test.serial("schema validation and diff normalize JSON without passing mutation or cloud flags", async () => {
  await fakeExecutable("bm", `#!/bin/sh
printf '%s\\n' "$*" >> '${join(root, "calls")}'
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "reindex" ]; then exit 0; fi
if [ "$1" = "schema" ] && [ "$2" = "validate" ]; then /bin/cat '${join(fixtureDir, "schema-validate.json")}'; exit 0; fi
if [ "$1" = "schema" ] && [ "$2" = "diff" ]; then /bin/cat '${join(fixtureDir, "schema-diff.json")}'; exit 0; fi
exit 92
`);

  const adapter = new BasicMemoryAdapter();
  const validation = await adapter.validateSchema(kbDir, "research", { kind: "type", type: "meeting" });
  const diff = await adapter.diffSchema(kbDir, "research", "meeting");

  expect(validation.ok).toBe(true);
  if (validation.ok) {
    expect(validation.value).toMatchObject({
      noteType: "meeting",
      totalNotes: 1,
      warningCount: 1,
      errorCount: 0,
      results: [{ noteIdentifier: "meetings/launch.md", passed: true }],
    });
  }
  expect(diff).toEqual({
    ok: true,
    value: {
      noteType: "meeting",
      schemaFound: true,
      newFields: [{ name: "decision", source: "observation", count: 3, total: 4, percentage: 0.75 }],
      droppedFields: [],
      cardinalityChanges: [],
      hasDrift: true,
    },
  });
  const calls = await readFile(join(root, "calls"), "utf8");
  expect(calls).toContain("schema validate meeting --project research --json --local\n");
  expect(calls).toContain("schema diff meeting --project research --json --local\n");
  expect(calls).not.toContain("--save");
  expect(calls).not.toContain("--cloud");
});

test.serial("project listing normalizes local projects and rejects top-level Engine errors", async () => {
  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "project" ]; then
  echo '{"projects":[{"name":"research","local_path":"${kbDir}"}]}'
  exit 0
fi
exit 92
`);

  expect(await new BasicMemoryAdapter().listProjects(kbDir)).toEqual({
    ok: true,
    value: [{ name: "research", localPath: kbDir }],
  });

  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
/bin/cat '${join(fixtureDir, "project-error.json")}'
`);
  expect(await new BasicMemoryAdapter().listProjects(kbDir)).toEqual({
    ok: false,
    message: "Basic Memory project list returned an error. project registry unavailable",
  });
});

test.serial("schema operations reject JSON that omits required normalized fields", async () => {
  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "reindex" ]; then exit 0; fi
/bin/cat '${join(fixtureDir, "schema-infer-missing-fields.json")}'
`);

  expect(await new BasicMemoryAdapter().inferSchema(kbDir, "research", "meeting", 0.25)).toEqual({
    ok: false,
    message: "Basic Memory schema infer JSON did not include valid required inference fields.",
  });
});

test.serial("search keeps Memory results, filters infrastructure, and rejects malformed Memory results", async () => {
  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
if [ "$1" = "tool" ]; then
  /bin/cat '${join(fixtureDir, "search-mixed.json")}'
  exit 0
fi
exit 92
`);

  const adapter = new BasicMemoryAdapter();
  expect(await adapter.search(kbDir, "research", "meeting")).toEqual({
    ok: true,
    value: [{ ref: "memories/meeting.md", title: "Meeting", match: "fact", score: 0.8 }],
  });

  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
/bin/cat '${join(fixtureDir, "search-malformed-memory.json")}'
`);
  const malformed = await new BasicMemoryAdapter().search(kbDir, "research", "meeting");
  expect(malformed).toEqual({
    ok: false,
    message: "Basic Memory search JSON contained a malformed Memory result at index 0.",
  });
});

test.serial("a timed-out Engine operation terminates its descendant process group", async () => {
  const childPidPath = join(root, "child-pid");
  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
/bin/sleep 30 &
child=$!
printf '%s' "$child" > '${childPidPath}'
wait "$child"
`);
  process.env.KB_ENGINE_TIMEOUT_MS = "50";

  const result = await new BasicMemoryAdapter().search(kbDir, "research", "meeting");

  expect(result).toEqual({
    ok: false,
    message: "Basic Memory search timed out after 50ms.",
  });
  const childPid = Number(await readFile(childPidPath, "utf8"));
  await Bun.sleep(50);
  expect(Bun.spawnSync(["/bin/kill", "-0", String(childPid)], { stdout: "ignore", stderr: "ignore" }).exitCode).not.toBe(0);
});

test.serial("SIGTERM is forwarded to the Engine process group and remains distinguishable", async () => {
  const enginePidPath = join(root, "engine-pid");
  await fakeExecutable("bm", `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'Basic Memory version: 0.22.1'; exit 0; fi
printf '%s' "$$" > '${enginePidPath}'
/bin/sleep 30
`);
  const helper = join(root, "signal-helper.ts");
  await writeFile(helper, `
import { BasicMemoryAdapter } from ${JSON.stringify(resolve(import.meta.dir, "../src/engine/basic-memory.ts"))};
const result = await new BasicMemoryAdapter().search(${JSON.stringify(kbDir)}, "research", "meeting");
console.log(JSON.stringify(result));
`);
  const proc = Bun.spawn([process.execPath, helper], {
    env: { ...process.env, PATH: binDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForFile(enginePidPath);
  proc.kill("SIGTERM");
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({
    ok: false,
    message: "Basic Memory search was interrupted (exit 143).",
    exitCode: 143,
  });
  const enginePid = Number(await readFile(enginePidPath, "utf8"));
  expect(Bun.spawnSync(["/bin/kill", "-0", String(enginePid)], { stdout: "ignore", stderr: "ignore" }).exitCode).not.toBe(0);
});

async function fakeExecutable(name: string, body: string): Promise<void> {
  await writeFile(join(binDir, name), body, { mode: 0o755 });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}
