import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FORMAT_VERSION,
  INDEX_LINE_FORMAT,
  indexLine,
  memoryFrontmatter,
  memoryTemplate,
  OBSERVATION_EXAMPLE,
  parseBasicMemoryDocument,
  parseCatalog,
  parseIndexLine,
  readBasicMemoryScalar,
  readBasicMemoryStringList,
  RELATION_EXAMPLE,
  slugForMemoryTitle,
  validateMemoryTitle,
} from "../src/memory-format";

// Forced seam: the reliability-hardening ticket requires a Memory format-contract
// seam in addition to subprocess CLI tests, so this file tests the public
// Memory-format module directly. The opt-in real Basic Memory test below is a
// compatibility lane for the exact supported package version, not part of the
// default deterministic suite.
const fixturesDir = join(import.meta.dir, "fixtures");
const basicMemoryContractDir = join(fixturesDir, "basic-memory-contract");
const realBasicMemoryTest = process.env.KB_REAL_BASIC_MEMORY_CONTRACT === "1" ? test : test.skip;
const supportedBasicMemoryPackage = "basic-memory==0.22.1";

test("kb.yaml fixture pins the scaffold config contract", async () => {
  const yaml = await readFixture("kb.yaml");

  expect(yaml).toBe(`schemaVersion: 1
formatVersion: ${FORMAT_VERSION}
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
`);
});

test("index.md fixture pins the one-line catalog format", async () => {
  const index = await readFixture("index.md");

  expect(index).toBe(INDEX_LINE_FORMAT.replace("<file>", "example-memory").replace("<title>", "Example Memory").replace("<category>", "research").replace("<one-line summary>", "One-line summary.") + "\n");
});

test("log.md fixture pins the greppable entry prefix", async () => {
  const log = await readFixture("log.md");

  expect(log).toBe("## [2026-01-02] add | Example Source\n");
});

test("Basic Memory note fixture pins frontmatter, observation, and relation syntax", async () => {
  const note = await readFixture("basic-memory-note.md");

  expect(note).toContain(memoryFrontmatter("Example Memory", "example-memory"));
  expect(readBasicMemoryScalar(note, "title")).toBe("Example Memory");
  expect(readBasicMemoryScalar(note, "type")).toBe("note");
  expect(readBasicMemoryScalar(note, "permalink")).toBe("example-memory");
  expect(note).toContain(OBSERVATION_EXAMPLE.replace("category", "summary").replace("fact", "One durable observation.").replace("tag", "research"));
  expect(note).toContain(RELATION_EXAMPLE.replace("Target", "Target Memory"));
});

test("Memory frontmatter preserves natural titles as valid Basic Memory YAML", () => {
  const title = `: "Quoted" # Hash 研究`;
  const frontmatter = memoryFrontmatter(title, slugForMemoryTitle(title));

  expect(frontmatter).toBe(`---
title: ": \\"Quoted\\" # Hash 研究"
type: note
tags:
  - research
permalink: m-8209b082cff8
---`);
  expect(readBasicMemoryScalar(frontmatter, "title")).toBe(title);
  expect(readBasicMemoryScalar(frontmatter, "type")).toBe("note");
  expect(readBasicMemoryScalar(frontmatter, "permalink")).toBe("m-8209b082cff8");
});

test("Memory frontmatter quotes YAML implicit scalar titles so they round-trip as strings", () => {
  for (const title of ["true", "null", "123", "2026-07-09", "1e3", "0x10", "01", "-1", "+1", "1.5"]) {
    const frontmatter = memoryFrontmatter(title, slugForMemoryTitle(title));
    const slug = slugForMemoryTitle(title);

    expect(frontmatter).toContain(`title: "${title}"`);
    if (!slug.startsWith("m-")) {
      expect(frontmatter).toContain(`permalink: "${slug}"`);
    }
    expect(readBasicMemoryScalar(frontmatter, "title")).toBe(title);
    expect(readBasicMemoryScalar(frontmatter, "permalink")).toBe(slug);
  }

  expect(memoryFrontmatter("Example Memory", "example-memory")).toContain("title: Example Memory\n");
});

test("canonical KB Memory parsing fails closed when profile fields are missing or empty", () => {
  const cases = [
    `---
type: note
tags:
  - research
permalink: example
---`,
    `---
title: Example
tags:
  - research
permalink: example
---`,
    `---
title: Example
type: note
tags:
  - research
---`,
    `---
title: ""
type: note
tags:
  - research
permalink: example
---`,
    `---
title: Example
type: ""
tags:
  - research
permalink: example
---`,
    `---
title: Example
type: note
tags:
  - research
permalink: ""
---`,
  ];

  for (const frontmatter of cases) {
    expect(parseBasicMemoryDocument("memories/example.md", frontmatter).ok).toBe(false);
  }
});

test("Basic Memory scalar reads stay frontmatter-scoped when the KB profile is incomplete", () => {
  const missingPermalink = `---
title: Example
type: note
tags:
  - research
---

permalink: body-value
`;

  expect(readBasicMemoryScalar(missingPermalink, "title")).toBe("Example");
  expect(readBasicMemoryScalar(missingPermalink, "permalink")).toBeNull();
});

test("Basic Memory scalar reads are scoped to frontmatter", () => {
  const note = `---
title: Example
type: note
tags:
  - research
permalink: example
superseded_by: Next Memory
---

superseded_by: Body Value
review_after: 2026-07-09
`;

  expect(readBasicMemoryScalar(note, "title")).toBe("Example");
  expect(readBasicMemoryScalar(note, "superseded_by")).toBe("Next Memory");
  expect(readBasicMemoryScalar(note, "review_after")).toBeNull();
});

test("catalog entries render and parse exact natural titles", () => {
  const title = `: "Quoted" # Hash 研究 [draft]`;
  const rendered = indexLine("memories/m-c0de2b2e61fa.md", title, "research", "Natural punctuation survives.");

  expect(rendered).toBe(`- [[memories/m-c0de2b2e61fa.md|: "Quoted" # Hash 研究 [draft]]] | category: research | summary: Natural punctuation survives.`);
  expect(parseIndexLine(rendered)).toEqual({
    ref: "memories/m-c0de2b2e61fa.md",
    title,
    category: "research",
    summary: "Natural punctuation survives.",
  });
});

test("the canonical Memory decoder returns one identity and normalized wiki references", () => {
  const decoded = parseBasicMemoryDocument("memories/example-memory.md", `---
title: "Example: Memory"
type: note
tags:
  - research
permalink: example-memory
superseded_by: Next Memory
review_after: 2026-07-09
related_example: [[Frontmatter Ghost]]
---

- relates_to [[Target Memory]]

See [[Natural Title]], [[memories/other.md|Other]], and [[example-memory]].
`);

  expect(decoded).toEqual({
    ok: true,
    value: {
      ref: "memories/example-memory.md",
      title: "Example: Memory",
      slug: "example-memory",
      supersededBy: "Next Memory",
      reviewAfter: "2026-07-09",
      staleAfter: null,
      links: ["Natural Title", "memories/other.md", "example-memory"],
    },
  });
});

test("the canonical Memory decoder accepts nested Basic Memory metadata without narrowing it", () => {
  const text = `---
title: Schema-rich Memory
type: meeting
tags:
  - client
source_refs:
  - raw/call.md
permalink: schema-rich-memory
metadata:
  attendees:
    - name: Ada
      role: owner
  confidence: 0.9
schema:
  fields:
    decision:
      type: string
---

Durable content.
`;

  expect(parseBasicMemoryDocument("memories/meetings/schema-rich.md", text)).toEqual({
    ok: true,
    value: {
      ref: "memories/meetings/schema-rich.md",
      title: "Schema-rich Memory",
      slug: "schema-rich-memory",
      supersededBy: null,
      reviewAfter: null,
      staleAfter: null,
      links: [],
    },
  });
  expect(readBasicMemoryStringList(text, "tags")).toEqual(["client"]);
  expect(readBasicMemoryStringList(text, "source_refs")).toEqual(["raw/call.md"]);
});

test("Basic Memory string-list reads accept the upstream comma-separated tag form", () => {
  const text = `---
title: Tagged Memory
type: note
tags: client, durable, agent-first
permalink: tagged-memory
---
`;

  expect(readBasicMemoryStringList(text, "tags")).toEqual(["client", "durable", "agent-first"]);
});

test("the canonical catalog accepts structured Memory folder refs", () => {
  const line = indexLine("memories/projects/acme/client-call.md", "Acme Client Call", "meeting", "Decision captured.");
  expect(parseCatalog(`${line}\n`)).toEqual({
    entries: [{
      ref: "memories/projects/acme/client-call.md",
      title: "Acme Client Call",
      category: "meeting",
      summary: "Decision captured.",
      line: 1,
    }],
    issues: [],
  });
});

test("the canonical Memory decoder reports precise frontmatter failures", () => {
  const decoded = parseBasicMemoryDocument("memories/broken.md", `---
title: Broken
type: page
tags:
  - research
---
`);

  expect(decoded).toEqual({
    ok: false,
    issues: [
      "memories/broken.md: frontmatter is missing permalink",
    ],
  });
});

test("the canonical Memory decoder rejects invalid structural dates", () => {
  const decoded = parseBasicMemoryDocument("memories/broken-date.md", `---
title: Broken Date
type: note
tags:
  - research
permalink: broken-date
review_after: someday
stale_after: 2026-02-30
---
`);

  expect(decoded).toEqual({
    ok: false,
    issues: [
      "memories/broken-date.md: frontmatter review_after must be an ISO calendar date",
      "memories/broken-date.md: frontmatter stale_after must be an ISO calendar date",
    ],
  });
});

test("the canonical catalog decoder ignores only the documented placeholder and rejects ambiguity", () => {
  const decoded = parseCatalog(`# KB Index

Line format:
${INDEX_LINE_FORMAT}
- [[memories/example.md|Example]] | category: research | summary: First.
- [[memories/example.md|Different]] | category: research | summary: Second.
- [[memories/other.md|Example]] | category: research | summary: Same title.
- [[memories/broken.md|Broken]] category: research
  - [[memories/indented.md|Indented]] | category: research | summary: Not canonical.
`);

  expect(decoded.entries).toEqual([
    {
      ref: "memories/example.md",
      title: "Example",
      category: "research",
      summary: "First.",
      line: 5,
    },
  ]);
  expect(decoded.issues).toEqual([
    "index.md:6: ambiguous catalog ref memories/example.md (first declared on line 5)",
    "index.md:7: ambiguous catalog title \"Example\" (first declared on line 5)",
    "index.md:8: malformed catalog entry",
    "index.md:9: malformed catalog entry",
  ]);
});

test("ambiguous catalog titles fail validation", () => {
  for (const title of ["", "   ", "Pipe | Title", "Closing ]] Title", "Control\u0001Title"]) {
    expect(validateMemoryTitle(title)).toEqual({
      ok: false,
      message: "title contains characters that cannot be represented unambiguously in the catalog",
    });
  }
});

test("Unicode-only and punctuation-only titles receive deterministic collision-resistant slugs", () => {
  expect(slugForMemoryTitle("研究")).toBe("m-4ff0f1dda80f");
  expect(slugForMemoryTitle("!!!")).toBe("m-e84c538e7fe2");
  expect(slugForMemoryTitle("???")).toBe("m-a03b221c6c6e");
});

test("Basic Memory contract fixtures pin real engine JSON shapes", async () => {
  const projectList = await readBasicMemoryContractJson("project-list.json");
  const searchEntity = await readBasicMemoryContractJson("search-entity.json");
  const searchObservation = await readBasicMemoryContractJson("search-observation.json");
  const searchRelation = await readBasicMemoryContractJson("search-relation.json");
  const statusTimeout = await readBasicMemoryContractJson("status-wait-timeout.json");

  expect(projectList.projects[0]).toMatchObject({
    name: "kb-contract-spike",
    local_path: "/tmp/kb-bm-contract/kb",
    cli_route: "local",
    is_default: true,
  });
  expect(searchEntity.results[0]).toMatchObject({
    type: "entity",
    permalink: "example-memory",
    file_path: "memories/example-memory.md",
  });
  expect(searchObservation.results[0]).toMatchObject({
    type: "observation",
    category: "summary",
    content: "One durable observation. #research",
  });
  expect(searchRelation.results[0]).toMatchObject({
    type: "relation",
    from_entity: "example-memory",
    to_entity: "target-memory",
    relation_type: "relates_to",
  });
  expect(statusTimeout.error).toContain("bm reindex --project kb-contract-spike");
});

realBasicMemoryTest("generated frontmatter round-trips through the supported Basic Memory lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-basic-memory-contract-"));
  const home = join(root, "home");
  const xdgConfigHome = join(root, "xdg");
  const kbDir = join(root, "kb");
  const memoriesDir = join(kbDir, "memories");
  const project = `kb-format-${process.pid}-${Date.now()}`;
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
  };

  try {
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, "true.md"), memoryTemplate("true", "true"));

    const version = await runPinnedBasicMemory(["--version"], kbDir, env);
    expect(version.stdout.trim()).toBe("Basic Memory version: 0.22.1");
    await expectBasicMemoryOk(["project", "add", project, kbDir], kbDir, env);
    await expectBasicMemoryOk(["reindex", "--project", project, "--search"], kbDir, env);

    const read = await expectBasicMemoryOk(["tool", "read-note", "true", "--project", project], kbDir, env);
    const parsed = JSON.parse(read.stdout);
    expect(parsed.frontmatter).toMatchObject({
      title: "true",
      type: "note",
      tags: ["research"],
      permalink: "true",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

async function readBasicMemoryContractJson(name: string): Promise<any> {
  return JSON.parse(await readFile(join(basicMemoryContractDir, name), "utf8"));
}

async function expectBasicMemoryOk(args: string[], cwd: string, env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string }> {
  const result = await runPinnedBasicMemory(args, cwd, env);
  expect(result.code, result.stderr || result.stdout || args.join(" ")).toBe(0);
  return result;
}

async function runPinnedBasicMemory(args: string[], cwd: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["uvx", "--from", supportedBasicMemoryPackage, "bm", ...args], {
    cwd,
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
}
