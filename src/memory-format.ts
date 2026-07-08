export const FORMAT_VERSION = "basic-memory-note-v1";

export const OBSERVATION_EXAMPLE = "- [category] fact #tag";
export const RELATION_EXAMPLE = "- relates_to [[Target]]";
export const INDEX_LINE_FORMAT = "- [[memories/<file>.md|<title>]] | category: <category> | summary: <one-line summary>";

export function indexLine(ref: string, title: string, category = "<category>", summary = "<one-line summary>"): string {
  return `- [[${ref}|${title}]] | category: ${category} | summary: ${summary}`;
}

export function memoryFrontmatter(title: string, slug: string): string {
  return `---
title: ${title}
type: note
tags:
  - research
permalink: ${slug}
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
