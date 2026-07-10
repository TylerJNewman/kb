import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createKbHarness, type KbHarness } from "./helpers/subprocess";

let harness: KbHarness;

beforeEach(async () => {
  harness = await createKbHarness();
  await harness.writeFakeExecutable("git", "#!/bin/sh\n/bin/mkdir .git\n");
  expect((await harness.runKb(["new", "research"])).code).toBe(0);
  expect((await harness.runKb(["draft", "Recoverable Memory", "--in", "research"])).code).toBe(0);
});

afterEach(async () => {
  await harness.cleanup();
});

test("retry completes a reflect committed to history without duplicating it", async () => {
  const instant = "2026-07-07T12:00:00.000Z";
  const retryInstant = "2026-07-08T12:00:00.000Z";
  const interrupted = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: instant, KB_FAIL_REFLECT_TRANSITION: "after-history" },
  });

  expect(interrupted).toEqual({
    code: 69,
    stdout: "",
    stderr: "kb: reflect transition failed after history commit\n",
  });

  const recovered = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: retryInstant },
  });
  const kbPath = join(harness.home, "kb", "research");
  const history = await readFile(join(kbPath, "log.md"), "utf8");

  expect(recovered.code).toBe(0);
  expect(recovered.stdout).toContain("Changed since last reflect: 1\n");
  expect(history.match(/^## \[2026-07-07\] reflect \| 1 memories/gm)).toHaveLength(1);
  expect(history).toContain(" | at 2026-07-07T12:00:00.000Z | tx ");
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${instant}`);
});

test("retry before acknowledgement uses the durable receipt instead of a new wall-clock instant", async () => {
  const instant = "2026-07-07T12:00:00.000Z";
  const retryInstant = "2026-07-08T12:00:00.000Z";
  const failedBeforeAcknowledgement = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: instant, KB_FAIL_REFLECT_TRANSITION: "before-cleanup" },
  });
  expect(failedBeforeAcknowledgement.code).toBe(69);

  const recovered = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: retryInstant },
  });
  const kbPath = join(harness.home, "kb", "research");

  expect(recovered.code).toBe(0);
  expect(recovered.stdout).toContain("Changed since last reflect: 1\n");
  expect((await readFile(join(kbPath, "log.md"), "utf8")).match(/^## .* reflect \|/gm)).toHaveLength(1);
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${instant}`);
});

test("two acknowledged reflects with no Memory changes create two events and advance the marker", async () => {
  const first = "2026-07-07T12:00:00.000Z";
  const second = "2026-07-08T12:00:00.000Z";
  const kbPath = join(harness.home, "kb", "research");
  const memoryPath = join(kbPath, "memories", "recoverable-memory.md");
  await utimes(memoryPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));

  expect((await harness.run("kb", ["reflect", "--in", "research"], { env: { KB_NOW: first } })).code).toBe(0);
  const next = await harness.run("kb", ["reflect", "--in", "research"], { env: { KB_NOW: second } });

  expect(next.code).toBe(0);
  expect(next.stdout).toContain("Changed since last reflect: 0\n");
  expect((await readFile(join(kbPath, "log.md"), "utf8")).match(/^## .* reflect \|/gm)).toHaveLength(2);
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${second}`);
});

test("failure before the history commit retains the prior event and retry creates one event", async () => {
  const instant = "2026-07-07T12:00:00.000Z";
  const failed = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: instant, KB_FAIL_REFLECT_TRANSITION: "before-history" },
  });
  const kbPath = join(harness.home, "kb", "research");

  expect(failed.code).toBe(69);
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain("lastReflectAt: null");
  expect(await readFile(join(kbPath, "log.md"), "utf8")).not.toContain("reflect |");

  expect((await harness.run("kb", ["reflect", "--in", "research"], { env: { KB_NOW: instant } })).code).toBe(0);
  expect((await readFile(join(kbPath, "log.md"), "utf8")).match(/^## .* reflect \|/gm)).toHaveLength(1);
});

test("concurrent reflects serialize into coherent events", async () => {
  const instant = "2026-07-07T12:00:00.000Z";
  const runs = await Promise.all([
    harness.run("kb", ["reflect", "--in", "research"], { env: { KB_NOW: instant } }),
    harness.run("kb", ["reflect", "--in", "research"], { env: { KB_NOW: instant } }),
  ]);
  const kbPath = join(harness.home, "kb", "research");
  const history = await readFile(join(kbPath, "log.md"), "utf8");

  expect(runs.map((run) => run.code)).toEqual([0, 0]);
  expect(runs.every((run) => run.stdout.includes("Reflect playbook\n"))).toBe(true);
  expect(history.match(/^## .* reflect \|/gm)).toHaveLength(2);
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${instant}`);
});

test("a process death before acknowledgement is recovered from the durable receipt", async () => {
  const instant = "2026-07-07T12:00:00.000Z";
  const retryInstant = "2026-07-08T12:00:00.000Z";
  const exited = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: instant, KB_EXIT_REFLECT_TRANSITION: "before-cleanup" },
  });
  const kbPath = join(harness.home, "kb", "research");
  const lockOwner = join(kbPath, ".kb-events.lock", "owner");

  expect(exited.code).toBe(86);
  await writeFile(lockOwner, JSON.stringify({ pid: 2_147_483_647, createdAt: 0 }));

  const recovered = await harness.run("kb", ["reflect", "--in", "research"], {
    env: { KB_NOW: retryInstant },
  });
  const history = await readFile(join(kbPath, "log.md"), "utf8");

  expect(recovered.code).toBe(0);
  expect(history.match(/^## .* reflect \|/gm)).toHaveLength(1);
  expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${instant}`);
});

test("every transition boundary recovers after ordinary failure and process death", async () => {
  const phases = [
    "before-prepare",
    "after-prepare",
    "before-history",
    "after-history",
    "before-config",
    "after-config",
    "before-cleanup",
    "after-cleanup",
  ];
  let scenario = 0;

  for (const injection of ["KB_FAIL_REFLECT_TRANSITION", "KB_EXIT_REFLECT_TRANSITION"] as const) {
    for (const phase of phases) {
      const name = `boundary-${scenario}`;
      const instant = `2026-07-${String(10 + scenario).padStart(2, "0")}T12:00:00.000Z`;
      expect((await harness.runKb(["new", name])).code).toBe(0);
      expect((await harness.runKb(["draft", "Boundary Memory", "--in", name])).code).toBe(0);
      const kbPath = join(harness.home, "kb", name);
      await writeFile(join(kbPath, "raw", "invariant.md"), "raw bytes stay fixed\n");

      const interrupted = await harness.run("kb", ["reflect", "--in", name], {
        env: { KB_NOW: instant, [injection]: phase },
      });
      expect(interrupted.code).toBe(injection === "KB_FAIL_REFLECT_TRANSITION" ? 69 : 86);

      if (injection === "KB_EXIT_REFLECT_TRANSITION") {
        await writeFile(
          join(kbPath, ".kb-events.lock", "owner"),
          JSON.stringify({ pid: 2_147_483_647, createdAt: 0 }),
        );
      }

      const recovered = await harness.run("kb", ["reflect", "--in", name], { env: { KB_NOW: instant } });
      expect(recovered.code).toBe(0);
      expect((await readFile(join(kbPath, "log.md"), "utf8")).match(/^## .* reflect \|/gm)).toHaveLength(
        phase === "after-cleanup" ? 2 : 1,
      );
      expect(await readFile(join(kbPath, "kb.yaml"), "utf8")).toContain(`lastReflectAt: ${instant}`);
      expect(await readFile(join(kbPath, "raw", "invariant.md"), "utf8")).toBe("raw bytes stay fixed\n");
      scenario += 1;
    }
  }
}, 30_000);
