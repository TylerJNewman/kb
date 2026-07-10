import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  parseBasicMemoryDocument,
  parseCatalog,
  type DecodedCatalogEntry,
  type DecodedMemory,
} from "./memory-format";

export type CanonicalMemory = DecodedMemory & {
  text: string;
  mtimeMs: number;
};

export type KbDocuments = {
  memories: CanonicalMemory[];
  memoryFileCount: number;
  catalog: DecodedCatalogEntry[];
  indexText: string;
  issues: string[];
};

/**
 * Read the writable document side of a KB once and decode it through the same
 * rules for every command. This is deliberately separate from command policy:
 * status and check may report issues, while search and reflect reject them.
 */
export async function readKbDocuments(kbPath: string): Promise<KbDocuments> {
  const baseIssues: string[] = [];
  const [indexText, memoryEntries] = await Promise.all([
    readFile(join(kbPath, "index.md"), "utf8").catch((error: unknown) => {
      if (isMissing(error)) {
        baseIssues.push("missing index.md");
        return "";
      }
      throw error;
    }),
    readdir(join(kbPath, "memories"), { withFileTypes: true }).catch((error: unknown) => {
      if (isMissing(error)) {
        baseIssues.push("missing memories");
        return [];
      }
      throw error;
    }),
  ]);
  const catalog = parseCatalog(indexText);
  const memoryFiles = memoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const memories: CanonicalMemory[] = [];
  const issues = [...baseIssues, ...catalog.issues];

  for (const file of memoryFiles) {
    const ref = `memories/${file}`;
    const path = join(kbPath, ref);
    const [text, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const decoded = parseBasicMemoryDocument(ref, text);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
    memories.push({ ...decoded.value, text, mtimeMs: metadata.mtimeMs });
  }

  const memoryByRef = new Map(memories.map((memory) => [memory.ref, memory]));
  for (const entry of catalog.entries) {
    const memory = memoryByRef.get(entry.ref);
    if (memory !== undefined && entry.title !== memory.title) {
      issues.push(
        `index.md:${entry.line}: catalog title ${JSON.stringify(entry.title)} does not match ${entry.ref} title ${JSON.stringify(memory.title)}`,
      );
    }
  }

  return {
    memories,
    memoryFileCount: memoryFiles.length,
    catalog: catalog.entries,
    indexText,
    issues: issues.sort(compareDocumentIssues),
  };
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareDocumentIssues(left: string, right: string): number {
  const leftIsMemory = left.startsWith("memories/");
  const rightIsMemory = right.startsWith("memories/");
  return leftIsMemory === rightIsMemory ? left.localeCompare(right) : leftIsMemory ? -1 : 1;
}
