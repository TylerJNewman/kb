import { createHash } from "node:crypto";

export const FORMAT_VERSION = "basic-memory-note-v1";

export const OBSERVATION_EXAMPLE = "- [category] fact #tag";
export const RELATION_EXAMPLE = "- relates_to [[Target]]";
export const INDEX_LINE_FORMAT = "- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>";

export type MemoryTitleValidation = { ok: true } | { ok: false; message: string };

export type CatalogEntry = {
  ref: string;
  title: string;
  category: string;
  summary: string;
};

export type DecodedCatalogEntry = CatalogEntry & { line: number };

export type DecodedMemory = {
  ref: string;
  title: string;
  slug: string;
  supersededBy: string | null;
  reviewAfter: string | null;
  staleAfter: string | null;
  links: string[];
};

export type MemoryDecodeResult =
  | { ok: true; value: DecodedMemory }
  | { ok: false; issues: string[] };

export type CatalogDecodeResult = {
  entries: DecodedCatalogEntry[];
  issues: string[];
};

const AMBIGUOUS_CATALOG_TITLE = "title contains characters that cannot be represented unambiguously in the catalog";
const SIMPLE_TITLE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const PLAIN_YAML_TITLE = /^[A-Za-z][A-Za-z0-9 _.-]*$/;
const RESERVED_YAML_SCALAR = /^(?:true|false|null|~|yes|no|on|off)$/i;
const GENERATED_RELATION_PLACEHOLDER = "- relates_to [[Target Memory]]";

export function indexLine(ref: string, title: string, category = "<category>", summary = "<one-line summary>"): string {
  assertCatalogValue(ref, "ref");
  assertMemoryTitle(title);
  assertCatalogValue(category, "category");
  assertCatalogValue(summary, "summary");
  return `- [[${ref}|${title}]] | category: ${category} | summary: ${summary}`;
}

export function memoryFrontmatter(title: string, slug: string): string {
  assertMemoryTitle(title);
  return `---
title: ${yamlScalar(title)}
type: note
tags:
  - research
permalink: ${yamlScalar(slug)}
---`;
}

export function memoryTemplate(title: string, slug: string): string {
  return `${memoryFrontmatter(title, slug)}

## Summary

TODO

## Observations

- [summary] TODO #research

## Relations

- relates_to [[Target Memory]]
`;
}

export function memoryFormatPlaybookLines(memoryRef: string, title: string): string[] {
  return [
    `Write ${memoryRef} in Basic Memory note format.`,
    "Include an executive summary of about 150 words or less.",
    `Extract observations as "${OBSERVATION_EXAMPLE}".`,
    `Extract relations as "${RELATION_EXAMPLE}".`,
    `Add or update one index.md line: ${indexLine(memoryRef, title)}`,
  ];
}

export function validateMemoryTitle(title: string): MemoryTitleValidation {
  if (title.trim().length === 0 || hasControlCharacter(title) || title.includes("|") || title.includes("]]")) {
    return { ok: false, message: AMBIGUOUS_CATALOG_TITLE };
  }
  return { ok: true };
}

export function slugForMemoryTitle(title: string): string {
  assertMemoryTitle(title);
  if (SIMPLE_TITLE.test(title)) {
    return slugifyAscii(title);
  }
  return `m-${shortHash(title)}`;
}

export function parseIndexLine(line: string): CatalogEntry | null {
  const prefix = "- [[";
  const separator = "|";
  const suffixStart = "]] | category: ";
  const summaryStart = " | summary: ";
  if (!line.startsWith(prefix)) {
    return null;
  }

  const refStart = prefix.length;
  const refEnd = line.indexOf(separator, refStart);
  if (refEnd === -1) {
    return null;
  }

  const titleStart = refEnd + separator.length;
  const titleEnd = line.indexOf(suffixStart, titleStart);
  if (titleEnd === -1) {
    return null;
  }

  const categoryStart = titleEnd + suffixStart.length;
  const categoryEnd = line.indexOf(summaryStart, categoryStart);
  if (categoryEnd === -1) {
    return null;
  }

  const entry = {
    ref: line.slice(refStart, refEnd),
    title: line.slice(titleStart, titleEnd),
    category: line.slice(categoryStart, categoryEnd),
    summary: line.slice(categoryEnd + summaryStart.length),
  };

  const invalidCatalogValue = [entry.ref, entry.category, entry.summary].some(hasAmbiguousCatalogValue);
  if (validateMemoryTitle(entry.title).ok === false || invalidCatalogValue) {
    return null;
  }
  return entry;
}

/**
 * Decode the identity and references shared by search, status, check, and
 * reflect. Invalid frontmatter never falls back to a filename-derived title:
 * doing so would give the same Memory two identities in different commands.
 */
export function parseBasicMemoryDocument(ref: string, text: string): MemoryDecodeResult {
  const frontmatter = parseBasicMemoryFrontmatterDetailed(text);
  const issues = [...frontmatter.issues, ...canonicalFrontmatterIssues(frontmatter.values)]
    .map((issue) => `${ref}: ${issue}`);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      ref,
      title: frontmatter.values.title,
      slug: frontmatter.values.permalink,
      supersededBy: frontmatter.values.superseded_by ?? null,
      reviewAfter: frontmatter.values.review_after ?? null,
      staleAfter: frontmatter.values.stale_after ?? null,
      links: parseWikiLinks(memoryBody(text)),
    },
  };
}

/** Decode every catalog-shaped line. The scaffold's exact placeholder is
 * documentation, not an entry; other malformed or duplicate entries are
 * reported instead of being silently omitted. */
export function parseCatalog(text: string): CatalogDecodeResult {
  const entries: DecodedCatalogEntry[] = [];
  const issues: string[] = [];
  const firstLineByRef = new Map<string, number>();
  const firstLineByTitle = new Map<string, number>();

  for (const [index, line] of text.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line === INDEX_LINE_FORMAT) {
      continue;
    }
    if (!line.trimStart().startsWith("- [[")) {
      continue;
    }
    if (!line.startsWith("- [[")) {
      issues.push(`index.md:${lineNumber}: malformed catalog entry`);
      continue;
    }
    const parsed = parseIndexLine(line);
    if (parsed === null || !isCanonicalMemoryRef(parsed.ref)) {
      issues.push(`index.md:${lineNumber}: malformed catalog entry`);
      continue;
    }
    const firstLine = firstLineByRef.get(parsed.ref);
    if (firstLine !== undefined) {
      issues.push(`index.md:${lineNumber}: ambiguous catalog ref ${parsed.ref} (first declared on line ${firstLine})`);
      continue;
    }
    const firstTitleLine = firstLineByTitle.get(parsed.title);
    if (firstTitleLine !== undefined) {
      issues.push(`index.md:${lineNumber}: ambiguous catalog title ${JSON.stringify(parsed.title)} (first declared on line ${firstTitleLine})`);
      continue;
    }
    firstLineByRef.set(parsed.ref, lineNumber);
    firstLineByTitle.set(parsed.title, lineNumber);
    entries.push({ ...parsed, line: lineNumber });
  }

  return { entries, issues };
}

type DetailedFrontmatterResult = { values: Record<string, string>; issues: string[] };

function parseBasicMemoryFrontmatterDetailed(text: string): DetailedFrontmatterResult {
  if (!text.startsWith("---\n")) {
    return { values: {}, issues: ["missing Basic Memory frontmatter"] };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1 || (text[end + 4] !== undefined && text[end + 4] !== "\n")) {
    return { values: {}, issues: ["unterminated Basic Memory frontmatter"] };
  }

  const values: Record<string, string> = {};
  const issues: string[] = [];
  let inTags = false;
  for (const [index, line] of text.slice(4, end).split("\n").entries()) {
    const lineNumber = index + 2;
    if (line === "tags:") {
      inTags = true;
      continue;
    }
    if (inTags && line.startsWith("  - ")) {
      if (parseYamlScalar(line.slice(4)) === null) {
        issues.push(`frontmatter line ${lineNumber} has an invalid tag scalar`);
      }
      continue;
    }
    inTags = false;
    const separator = line.indexOf(":");
    if (separator === -1) {
      if (line.trim().length > 0) {
        issues.push(`frontmatter line ${lineNumber} is malformed`);
      }
      continue;
    }
    const key = line.slice(0, separator);
    const rawValue = line.slice(separator + 1).trimStart();
    if (Object.hasOwn(values, key)) {
      issues.push(`frontmatter has duplicate ${key}`);
      continue;
    }
    const value = parseYamlScalar(rawValue);
    if (value === null || value.length === 0) {
      issues.push(`frontmatter ${key} is empty or invalid`);
      continue;
    }
    values[key] = value;
  }

  for (const key of ["title", "type", "permalink"] as const) {
    if (!Object.hasOwn(values, key)) {
      issues.push(`frontmatter is missing ${key}`);
    }
  }
  return { values, issues };
}

function parseWikiLinks(text: string): string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === RELATION_EXAMPLE || line === GENERATED_RELATION_PLACEHOLDER) {
      continue;
    }
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      links.push(match[1].trim());
    }
    pattern.lastIndex = 0;
  }
  return links;
}

function memoryBody(text: string): string {
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return "";
  }
  return text.slice(end + 4).replace(/^\n/, "");
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function canonicalFrontmatterIssues(values: Record<string, string>): string[] {
  const issues: string[] = [];
  if (values.type !== undefined && values.type !== "note") {
    issues.push("frontmatter type must be note");
  }
  if (values.title !== undefined) {
    const titleValidation = validateMemoryTitle(values.title);
    if (!titleValidation.ok) {
      issues.push(titleValidation.message);
    }
  }
  if (values.permalink !== undefined && hasControlCharacter(values.permalink)) {
    issues.push("frontmatter permalink contains a control character");
  }
  for (const key of ["review_after", "stale_after"] as const) {
    const value = values[key];
    if (value !== undefined && !isIsoCalendarDate(value)) {
      issues.push(`frontmatter ${key} must be an ISO calendar date`);
    }
  }
  return issues;
}

function isCanonicalMemoryRef(ref: string): boolean {
  return /^memories\/[^/]+\.md$/.test(ref) && ref !== "memories/<file>.md";
}

export function readBasicMemoryScalar(text: string, key: string): string | null {
  if (text.startsWith("---\n")) {
    const frontmatter = parseBasicMemoryFrontmatterDetailed(text);
    if (frontmatter.issues.length > 0 || canonicalFrontmatterIssues(frontmatter.values).length > 0) {
      return null;
    }
    return frontmatter.values[key] ?? null;
  }
  return readYamlScalarFromText(text, key);
}

function assertMemoryTitle(title: string): void {
  const validation = validateMemoryTitle(title);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
}

function assertCatalogValue(value: string, name: string): void {
  if (hasAmbiguousCatalogValue(value)) {
    throw new Error(`${name} contains characters that cannot be represented unambiguously in the catalog`);
  }
}

function hasAmbiguousCatalogValue(value: string): boolean {
  return hasControlCharacter(value) || value.includes("|");
}

function yamlScalar(value: string): string {
  return PLAIN_YAML_TITLE.test(value) && !RESERVED_YAML_SCALAR.test(value) ? value : JSON.stringify(value);
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function parseYamlScalar(value: string): string | null {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value;
}

function readYamlScalarFromText(text: string, key: string): string | null {
  const match = new RegExp(`^${escapeRegExp(key)}: (.+)$`, "m").exec(text);
  return match === null ? null : (parseYamlScalar(match[1]) ?? match[1]);
}

function slugifyAscii(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
