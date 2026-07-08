# Oracle should-fix code receipts

## Should-fix 1: Engine adapter

- Added `src/engine/types.ts` with `EngineSearchResult`, `EngineConfigPatch`, `EngineResult`, and `SearchEngineAdapter`.
- Added `src/engine/basic-memory.ts` with `BasicMemoryAdapter`.
- `BasicMemoryAdapter` is now the only place that knows:
  - `uvx basic-memory --version`
  - `bm project add <name> <path>`
  - `bm reindex --project <name> --search`
  - `bm tool search-notes <query> --project <name>`
  - Basic Memory JSON fields `file_path`, `matched_chunk`, `content`, `score`, and `title`
  - Basic Memory failure vocabulary.
- `src/cli.ts` now calls the adapter for `kb enable search` and enabled-engine `kb search`, then keeps owning config writes, query logging, and output rendering.

Behavior-preserving confirmation:

- Existing enable/search subprocess tests pass unchanged in behavior.
- Exact engine call tests still pass:
  - `kb enable search lazy-installs Basic Memory, adds the project, reindexes, and flips to B1`
  - `kb search uses Basic Memory when the Engine is enabled and keeps the normalized output contract`
  - `populated B0 enables B1 search with zero content migration`

## Should-fix 2: Mutation matrix

Added `test/mutation-matrix.test.ts`.

Test name:

```text
command mutation matrix pins KB-owned paths each command may change
```

Enforced table:

```text
new/init        -> scaffold files, registry, optional .git
add             -> raw/* and log.md only
note            -> one memories/* file only
search          -> log.md only
enable search   -> kb.yaml only
reflect         -> kb.yaml and log.md only
defrag          -> no KB content mutation
lint            -> no KB content mutation
status          -> no KB content mutation
read            -> no KB content mutation
list            -> no KB content mutation
```

The test uses the subprocess harness, fresh isolated KBs, content hashes for `raw/`, `memories/`, `index.md`, `log.md`, and `kb.yaml`, and fake engine commands on `PATH` for `enable search`.

## Should-fix 3: Defrag honesty and lint arm-gating

- `kb defrag` output now says it prints a defrag playbook only and does not move, archive, or delete files.
- No automatic file-moving was added.
- Deterministic candidate detection is unchanged.
- `kb lint` now refuses non-wiki KBs with:

```text
kb: kb lint applies to the wiki Arm; this KB is b0
```

- Help text now describes `kb lint` as wiki-arm.
- Added `kb lint refuses non-wiki Arms clearly`.

## Diff stat

Command:

```sh
git diff --stat
```

Output at receipt time:

```text
src/cli.ts                   | 157 +++++----------------------------
src/engine/basic-memory.ts   | 149 ++++++++++++++++++++++++++++++++
src/engine/types.ts          |  31 +++++++
test/cli.test.ts             |  13 +++
test/mutation-matrix.test.ts | 201 +++++++++++++++++++++++++++++++++++++++++++
5 files changed, 417 insertions(+), 134 deletions(-)
```

## Test receipt

Command:

```sh
bun test
```

Result:

```text
52 pass
0 fail
217 expect() calls
Ran 52 tests across 4 files.
```

## Deviations

None.
