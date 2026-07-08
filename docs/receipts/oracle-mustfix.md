# Oracle must-fix receipts

## Must-fix 1: Memory format single source

- Added `src/memory-format.ts` as the source of truth for:
  - `formatVersion`
  - frontmatter template
  - observation example
  - `relates_to` relation example
  - `index.md` line format
  - ingest playbook format fragments
- Wired `kb note`, scaffold `index.md`, B0 ingest playbook, wiki ingest playbook, and format fixture tests to that module.
- Relation examples now use `- relates_to [[Target]]`.

## Must-fix 2: scaffold b1 does not lie

- `kb new --arm b1` and `kb init --arm b1` now fail with:
  `b1 requires the search engine — create a b0 KB first, then run kb enable search.`
- Scaffold accepts only `wiki` and `b0`.
- `kb.yaml` scaffold generation always writes `state: disabled`; `state: enabled` is still only written by `kb enable search` after project add and reindex succeed.

## Must-fix 3: B0 to B1 zero migration test

New subprocess test:

`populated B0 enables B1 search with zero content migration`

Assertions:

- Creates a B0 KB.
- Adds 3 raw sources through `kb add`.
- Creates 3 Memory files through `kb note`, then fills them with Basic Memory-compatible observations and `relates_to` relations.
- Builds `index.md`.
- Records SHA-256 hashes for KB-owned content outside `.git`.
- Runs `kb enable search` with fake `bm` and `uvx` on `PATH`.
- Asserts the only changed KB-owned file is `kb.yaml`.
- Asserts no `raw/`, `memories/`, `index.md`, or `log.md` content changed.
- Asserts post-enable `kb search` routes through `bm tool search-notes` and returns the same Memory refs as B0 search.

## Diff stat

Command:

```sh
git diff --stat
```

Output at receipt time:

```text
docs/receipts/oracle-mustfix.md | 115 ++++++++++++++++++++++++++++++++
src/cli.ts                      |  72 ++++++++------------
src/memory-format.ts            |  46 +++++++++++++
test/cli.test.ts                | 141 +++++++++++++++++++++++++++++++++++-----
test/format-fixtures.test.ts    |  17 ++---
5 files changed, 319 insertions(+), 72 deletions(-)
```

## Format proof

Deprecated short relation spelling check:

```sh
rg -n --glob '!node_modules/**' --glob '!.git/**' --glob '!.next/**' --glob '!dist/**' --glob '!build/**' --glob '!coverage/**' --glob '!.turbo/**' -- '- r''el \[\[' .
```

Output:

```text
<no matches>
```

Current relation spelling check:

```sh
rg -n --glob '!node_modules/**' --glob '!.git/**' --glob '!.next/**' --glob '!dist/**' --glob '!build/**' --glob '!coverage/**' --glob '!.turbo/**' -- '- relates_to \[\[' src test docs AGENT-BUILD-GUIDE.md
```

Output:

```text
src/memory-format.ts:4:export const RELATION_EXAMPLE = "- relates_to [[Target]]";
src/memory-format.ts:34:- relates_to [[Target Memory]]
test/cli.test.ts:374:6. Extract relations as "- relates_to [[Target]]".
test/cli.test.ts:444:  expect(memory).toContain("- relates_to [[Target Memory]]");
test/cli.test.ts:542:- relates_to [[Target Memory]]
test/cli.test.ts:745:  await writeMemory(kbDir, "alpha-memory.md", "Alpha Memory", "alpha-memory", "", "\n- [summary] sharedterm alpha memory. #research\n- relates_to [[Beta Memory]]\n");
test/cli.test.ts:746:  await writeMemory(kbDir, "beta-memory.md", "Beta Memory", "beta-memory", "", "\n- [summary] sharedterm beta memory. #research\n- relates_to [[Gamma Memory]]\n");
test/cli.test.ts:747:  await writeMemory(kbDir, "gamma-memory.md", "Gamma Memory", "gamma-memory", "", "\n- [summary] sharedterm gamma memory. #research\n- relates_to [[Alpha Memory]]\n");
test/fixtures/basic-memory-contract/search-entity.json:9:      "content": "- [summary] One durable observation. #research\n- relates_to [[Target Memory]]",
test/fixtures/basic-memory-contract/search-entity.json:10:      "matched_chunk": "- [summary] One durable observation. #research\n- relates_to [[Target Memory]]",
test/fixtures/basic-memory-contract/read-note.json:5:  "content": "\n- [summary] One durable observation. #research\n- relates_to [[Target Memory]]\n",
test/fixtures/basic-memory-note.md:10:- relates_to [[Target Memory]]
```

## Test receipt

Command:

```sh
bun test
```

Result:

```text
50 pass
0 fail
172 expect() calls
Ran 50 tests across 3 files.
```

## Deviations

None.
