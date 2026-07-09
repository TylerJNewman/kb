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

type BasicMemoryFrontmatter = {
  title: string;
  type: string;
  tags: string[];
  permalink: string;
};

const AMBIGUOUS_CATALOG_TITLE = "title contains characters that cannot be represented unambiguously in the catalog";
const SIMPLE_TITLE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const PLAIN_YAML_TITLE = /^[A-Za-z][A-Za-z0-9 _.-]*$/;
const RESERVED_YAML_SCALAR = /^(?:true|false|null|~|yes|no|on|off)$/i;

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

function parseBasicMemoryFrontmatter(text: string): BasicMemoryFrontmatter | null {
  if (!text.startsWith("---\n")) {
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return null;
  }

  const lines = text.slice(4, end).split("\n");
  const values = new Map<string, string>();
  const tags: string[] = [];
  let inTags = false;

  for (const line of lines) {
    if (line === "tags:") {
      inTags = true;
      continue;
    }
    if (inTags && line.startsWith("  - ")) {
      tags.push(parseYamlScalar(line.slice(4)) ?? "");
      continue;
    }
    inTags = false;
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    values.set(line.slice(0, separator), line.slice(separator + 1).trimStart());
  }

  const title = parseRequiredYamlScalar(values.get("title"));
  const type = parseRequiredYamlScalar(values.get("type"));
  const permalink = parseRequiredYamlScalar(values.get("permalink"));
  if (title === null || type === null || permalink === null) {
    return null;
  }

  return { title, type, tags, permalink };
}

export function readBasicMemoryScalar(text: string, key: string): string | null {
  const frontmatter = parseBasicMemoryFrontmatter(text);
  if (frontmatter !== null && key in frontmatter) {
    return String(frontmatter[key as keyof BasicMemoryFrontmatter]);
  }
  if (text.startsWith("---\n")) {
    if (frontmatter === null) {
      return null;
    }
    const frontmatterText = frontmatterBlock(text);
    if (frontmatterText === null) {
      return null;
    }
    return readYamlScalarFromText(frontmatterText, key);
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

function frontmatterBlock(text: string): string | null {
  const end = text.indexOf("\n---", 4);
  return end === -1 ? null : text.slice(4, end);
}

function readYamlScalarFromText(text: string, key: string): string | null {
  const match = new RegExp(`^${escapeRegExp(key)}: (.+)$`, "m").exec(text);
  return match === null ? null : (parseYamlScalar(match[1]) ?? match[1]);
}

function parseRequiredYamlScalar(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const parsed = parseYamlScalar(value);
  return parsed === null || parsed.length === 0 ? null : parsed;
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
