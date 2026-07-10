import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "./file-lock";
import { readKbConfig, updateKbConfig } from "./kb-config";

export type ReflectMemory = {
  ref: string;
  title: string;
  mtimeMs?: number;
};

type ReflectEvent = {
  version: 1;
  transactionId: string;
  instant: string;
  changed: ReflectMemory[];
};

export class ReflectTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectTransitionError";
  }
}

/**
 * Commits reflect history before projecting its instant into kb.yaml.
 *
 * log.md is authoritative: its machine-readable event record identifies a
 * committed transition. The temporary journal exists only while the config
 * projection may need recovery. Holding the event lock also serializes
 * concurrent reflects and other log writers.
 */
export async function commitReflectTransition(
  kbPath: string,
  currentInstant: () => string,
  changedSince: (lastReflectAt: string | null) => Promise<ReflectMemory[]>,
  present: (changed: ReflectMemory[]) => void,
): Promise<void> {
  return withFileLock(
    {
      lockPath: join(kbPath, ".kb-events.lock"),
      label: "reflect",
      createError: (message) => new ReflectTransitionError(message),
    },
    async () => {
      const recovered = await recoverPendingTransition(kbPath);
      if (recovered !== null) {
        await presentAndAcknowledge(kbPath, recovered, present);
        return;
      }
      const history = await readFile(historyPath(kbPath), "utf8");
      const latest = reflectEvents(history).at(-1);
      if (latest !== undefined) {
        await projectCommittedInstant(kbPath, latest.instant);
      }
      const instant = currentInstant();
      const config = await readKbConfig(kbPath);
      const changed = await changedSince(config.lastReflectAt);
      const event: ReflectEvent = {
        version: 1,
        transactionId: transactionId(instant, config.lastReflectAt, changed),
        instant,
        changed: changed.map(({ ref, title, mtimeMs }) => ({ ref, title, ...(mtimeMs === undefined ? {} : { mtimeMs }) })),
      };

      const existing = findEventByTransaction(history, event.transactionId);
      if (existing !== null) {
        await projectCommittedInstant(kbPath, existing.instant);
        present(existing.changed);
        return;
      }

      injectAt("before-prepare");
      await writeAtomically(journalPath(kbPath), `${JSON.stringify(event)}\n`);
      injectAt("after-prepare");

      injectAt("before-history");
      await appendCommittedHistory(kbPath, event);
      injectAt("after-history");

      injectAt("before-config");
      await projectCommittedInstant(kbPath, event.instant);
      injectAt("after-config");
      await presentAndAcknowledge(kbPath, event, present);
    },
  );
}

/** Commit an agent-reviewed pending Reflect handoff through the same journaled
 * history/config projection used by the eager compatibility API above. */
export async function commitPreparedReflectTransition(
  kbPath: string,
  instant: string,
  changed: ReflectMemory[],
): Promise<void> {
  return withFileLock(
    {
      lockPath: join(kbPath, ".kb-events.lock"),
      label: "reflect",
      createError: (message) => new ReflectTransitionError(message),
    },
    async () => {
      const recovered = await recoverPendingTransition(kbPath);
      if (recovered !== null) {
        await presentAndAcknowledge(kbPath, recovered, () => {});
        return;
      }
      const history = await readFile(historyPath(kbPath), "utf8");
      const latest = reflectEvents(history).at(-1);
      if (latest !== undefined) {
        await projectCommittedInstant(kbPath, latest.instant);
      }
      const preparedExisting = reflectEvents(history).find((event) => event.instant === instant
        && sameChangedMemories(event.changed, changed));
      if (preparedExisting !== undefined) {
        await projectCommittedInstant(kbPath, preparedExisting.instant);
        return;
      }
      const config = await readKbConfig(kbPath);
      const event: ReflectEvent = {
        version: 1,
        transactionId: transactionId(instant, config.lastReflectAt, changed),
        instant,
        changed: changed.map(({ ref, title, mtimeMs }) => ({ ref, title, ...(mtimeMs === undefined ? {} : { mtimeMs }) })),
      };
      const existing = findEventByTransaction(history, event.transactionId);
      if (existing !== null) {
        await projectCommittedInstant(kbPath, existing.instant);
        return;
      }
      injectAt("before-prepare");
      await writeAtomically(journalPath(kbPath), `${JSON.stringify(event)}\n`);
      injectAt("after-prepare");
      injectAt("before-history");
      await appendCommittedHistory(kbPath, event);
      injectAt("after-history");
      injectAt("before-config");
      await projectCommittedInstant(kbPath, event.instant);
      injectAt("after-config");
      await presentAndAcknowledge(kbPath, event, () => {});
    },
  );
}

export async function withKbEventLock<T>(kbPath: string, action: () => Promise<T>): Promise<T> {
  return withFileLock(
    {
      lockPath: join(kbPath, ".kb-events.lock"),
      label: "KB event",
      createError: (message) => new ReflectTransitionError(message),
    },
    action,
  );
}

async function recoverPendingTransition(kbPath: string): Promise<ReflectEvent | null> {
  let text: string;
  try {
    text = await readFile(journalPath(kbPath), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const pending = parseEventJson(text, "reflect transaction journal");
  const history = await readFile(historyPath(kbPath), "utf8");
  const committed = findEventByTransaction(history, pending.transactionId);
  if (committed !== null) {
    await projectCommittedInstant(kbPath, committed.instant);
    return committed;
  }
  await rm(journalPath(kbPath), { force: true });
  return null;
}

async function presentAndAcknowledge(
  kbPath: string,
  event: ReflectEvent,
  present: (changed: ReflectMemory[]) => void,
): Promise<void> {
  present(event.changed);
  injectAt("before-cleanup");
  await rm(journalPath(kbPath), { force: true });
  injectAt("after-cleanup");
}

async function projectCommittedInstant(kbPath: string, instant: string): Promise<void> {
  const config = await readKbConfig(kbPath);
  if (config.lastReflectAt === instant
    || (config.lastReflectAt !== null && Date.parse(config.lastReflectAt) > Date.parse(instant))) {
    return;
  }
  await updateKbConfig(kbPath, (current) => ({ ...current, lastReflectAt: instant }));
}

async function appendCommittedHistory(kbPath: string, event: ReflectEvent): Promise<void> {
  const current = await readFile(historyPath(kbPath), "utf8");
  if (findEventByTransaction(current, event.transactionId) !== null) {
    return;
  }
  const date = event.instant.slice(0, 10);
  const prefix = `## [${date}] reflect | ${event.changed.length} memories | at ${event.instant} | tx ${event.transactionId}\n`;
  const metadata = `<!-- kb-reflect-v1 ${Buffer.from(JSON.stringify(event)).toString("base64url")} -->\n`;
  await writeAtomically(historyPath(kbPath), `${current}${prefix}${metadata}`);
}

function findEventByTransaction(history: string, transaction: string): ReflectEvent | null {
  return reflectEvents(history).find((event) => event.transactionId === transaction) ?? null;
}

function reflectEvents(history: string): ReflectEvent[] {
  const events: ReflectEvent[] = [];
  for (const match of history.matchAll(/^<!-- kb-reflect-v1 ([A-Za-z0-9_-]+) -->$/gm)) {
    try {
      events.push(parseEventJson(Buffer.from(match[1]!, "base64url").toString("utf8"), "reflect history metadata"));
    } catch (error) {
      if (error instanceof ReflectTransitionError) {
        throw error;
      }
      throw new ReflectTransitionError("invalid reflect history metadata");
    }
  }
  return events;
}

function parseEventJson(text: string, label: string): ReflectEvent {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReflectTransitionError(`invalid ${label}`);
  }
  if (!isReflectEvent(value)) {
    throw new ReflectTransitionError(`invalid ${label}`);
  }
  return value;
}

function isReflectEvent(value: unknown): value is ReflectEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ReflectEvent>;
  return candidate.version === 1
    && typeof candidate.transactionId === "string"
    && typeof candidate.instant === "string"
    && Number.isFinite(Date.parse(candidate.instant))
    && new Date(candidate.instant).toISOString() === candidate.instant
    && Array.isArray(candidate.changed)
    && candidate.changed.every((memory) => typeof memory === "object" && memory !== null
      && typeof (memory as ReflectMemory).ref === "string"
      && typeof (memory as ReflectMemory).title === "string"
      && ((memory as ReflectMemory).mtimeMs === undefined || typeof (memory as ReflectMemory).mtimeMs === "number"));
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, content, { flag: "wx" });
    await rename(tmp, path);
  } catch (error) {
    if (error instanceof ReflectTransitionError) {
      throw error;
    }
    throw new ReflectTransitionError(`reflect transition commit failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(tmp, { force: true });
  }
}

function injectAt(phase: string): void {
  if (process.env.KB_EXIT_REFLECT_TRANSITION === phase) {
    process.exit(86);
  }
  if (process.env.KB_FAIL_REFLECT_TRANSITION === phase) {
    const label = phase === "after-history" ? "after history commit" : phase.replaceAll("-", " ");
    throw new ReflectTransitionError(`reflect transition failed ${label}`);
  }
}

function transactionId(instant: string, previousInstant: string | null, changed: ReflectMemory[]): string {
  const revisions = changed
    .map((memory) => [memory.ref, memory.title, memory.mtimeMs ?? null])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  return createHash("sha256")
    .update(JSON.stringify(["kb-reflect-v1", instant, previousInstant, revisions]))
    .digest("hex")
    .slice(0, 16);
}

function sameChangedMemories(left: ReflectMemory[], right: ReflectMemory[]): boolean {
  const normalize = (values: ReflectMemory[]) => values
    .map(({ ref, title, mtimeMs }) => [ref, title, mtimeMs ?? null])
    .sort(([leftRef], [rightRef]) => String(leftRef).localeCompare(String(rightRef)));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function historyPath(kbPath: string): string {
  return join(kbPath, "log.md");
}

function journalPath(kbPath: string): string {
  return join(kbPath, ".kb-reflect-transaction.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
