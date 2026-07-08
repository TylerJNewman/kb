# Basic Memory command contract spike

Issue: #3. Captured against installed `bm` reporting Basic Memory `0.22.1` on 2026-07-07, with isolated `HOME` and `XDG_CONFIG_HOME`.

## Install and executable contract

- `uvx basic-memory --version` works and runs the `basic-memory` executable.
- `uvx basic-memory` does not expose a nested `bm` command: `uvx basic-memory bm --version` exits 2 with "No such command 'bm'."
- `bm` exists only when installed as a separate executable. This machine has `/Users/tyler/.local/bin/bm`.
- If `uvx` is absent, `/bin/sh` exits 127 and prints `uvx: command not found`.

## Project and indexing contract

The live project-add shape is:

```sh
bm project add <name> <path>
```

`bm project add kb-contract-spike /tmp/kb-bm-contract/kb` prints `Project 'kb-contract-spike' added successfully` and exits 0.

There is no top-level `bm sync` command in this install. `bm status --project <name> --json --wait --timeout 10` can time out when no Basic Memory server is running and returns a JSON error. The deterministic one-shot indexing command is:

```sh
bm reindex --project kb-contract-spike --search
```

After reindex, `bm status --project kb-contract-spike --json` returns an empty status report with `total: 0`.

## Search JSON contract

`bm tool search-notes` prints JSON by default. In this install it does not accept `--json` or `--format json`; both are command-contract drift risks for ADR-0001 and later fake-engine tests.

Working search commands:

```sh
bm tool search-notes "durable observation" --project kb-contract-spike
bm tool search-notes "durable observation" --project kb-contract-spike --entity-type observation
bm tool search-notes "Target Memory" --project kb-contract-spike --entity-type relation
```

The checked-in JSON fixtures under `test/fixtures/basic-memory-contract/` capture entity, observation, relation, read-note, project-list, status, and error shapes.

## Failure modes

- `uvx` absent: shell exit 127, `uvx: command not found`.
- Missing project through `bm status --json`: exit 1 with JSON `{ "error": ... }`.
- Missing project through `bm tool search-notes`: exit 1 with a plain stderr error, not JSON.
- Unsupported search JSON flags: exit 2 with Typer/Rich usage text, not JSON.
- Invalid `--filter` JSON: exit 1 with plain stderr `Invalid JSON for --filter: ...`.

Engine wrappers should treat non-zero exit, non-JSON stdout, and JSON objects with `error` as engine errors.

## Round-trip result

The Slice 0 fixture `test/fixtures/basic-memory-note.md` was copied to `memories/example-memory.md`, with a second `target-memory.md` fixture added only to resolve the relation target. After `bm reindex --project kb-contract-spike --search`:

- `--entity-type observation` returned one observation with `category: "summary"`, `content: "One durable observation. #research"`, and tag metadata `["research"]`.
- `--entity-type relation` returned one relation with `from_entity: "example-memory"`, `to_entity: "target-memory"`, and `relation_type: "relates_to"`.
- `bm tool read-note example-memory --project kb-contract-spike` preserved the frontmatter fields `title`, `type`, `tags`, and `permalink`.

So the current note-format fixture round-trips through Basic Memory into the expected observation and relation records.
