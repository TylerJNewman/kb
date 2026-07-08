# Oracle UX review receipt

Date: 2026-07-08

## Change table

| Area | Old | New | Receipt |
| --- | --- | --- | --- |
| Target flag | `--kb <name>` | `--in <name>` | Public help shows `kb <command> [args] [--in <name>]`; `--kb` remains accepted as hidden alias. |
| Target defaults | First-run examples used target flags | `kb add`, `kb search`, `kb status` use cwd/default KB | README, START-HERE, site, and `kb start` examples use plain commands. |
| Target validation | Target accepted everywhere | `--in`/`--kb` rejected on `new`, `init`, `list`, `start` | Test: `target and command-specific flags are rejected where meaningless`. |
| Draft verb | `kb note <title>` | `kb draft <title...>` | Test: `kb draft <title> creates...`; hidden alias test keeps `note` accepted. |
| Check verb | `kb defrag`, wiki `kb lint` | `kb check` | Test: `kb check reports...`; hidden aliases map `defrag`/`lint` to `check`. |
| Add wording | `Ingest playbook`, `ingest |` | `Add playbook`, `add |` | Test: `kb add <file>...` asserts `Add playbook` and `add |`. |
| New output | silent success | `Created KB`, `Path`, optional `Default`, `Next` | Test: `kb new research creates...`. |
| Init output | silent success | `Initialized KB in <cwd>` plus `Next` | Test: `kb init scaffolds...`. |
| Enable output | `Search enabled for <name>.` | `Search enabled for <name>. Arm: b1. Existing files unchanged.` | Test: `kb enable search lazy-installs...`. |
| Help | flat command list | grouped Learning/Create/Add/Ask/Maintain plus Targeting | Test: `kb --help exits 0...`. |
| Command help | partial | every public command has specific help | Test: `every public command has command-specific help`. |
| Status labels | `Arm: b0`, `Engine: disabled` | `Arm: b0 (plain markdown)`, `Search: plain files` | Test: `kb status prints counts...`. |
| Search labels | `Source:` and multiline chunks | `Matched in:` and single-line match text | Tests: search output contract tests. |
| Reflect wording | implied completed reflection | reflect playbook/plan, with marker/log only | Test: `kb reflect reports...`. |
| Version | `--version`, `-v` | `--version`, `-V`; bare `-v` rejected | Test: `kb -V is version and bare -v is not a public alias`. |
| Install docs | `bunx ...` as if persistent `kb` exists | install once with `npm i -g @tylerjnewman/kb`, then bare `kb` | README, START-HERE, site. ADR-0004 documents the bunx caveat. |
| Arms docs | scaffold examples implied `b1`/`b2` | scaffold arms are `wiki`/`b0`; `b1` via `kb enable search`; `b2` deferred | PRD, ADR-0002, ADR-0005, AGENT-BUILD-GUIDE. |

## Docs updated

| Doc | Confirmation |
| --- | --- |
| `README.md` | Install-once hello world, `--in`, default-target examples. |
| `docs/START-HERE.md` | Install-once hello world, `draft`, `--in`, updated small verb set. |
| `site/index.html` | Hero and hello-world commands use install-once and `--in`. |
| `docs/PRD.md` | `draft`, `check`, `--in`, scaffold-arm correction, deterministic-check claims. |
| `docs/adr/0002-agent-first-noninteractive-cli.md` | Removed nonexistent `kb switch`; clarified scaffold arms and deferred switching. |
| `docs/adr/0004-name-and-distribution.md` | Install-once default and explicit `bunx` non-persistent caveat. |
| `docs/adr/0005-v1-scope.md` | `draft`, `check`, reindex wording, scaffold vs recognized arms. |
| `docs/adr/0001-wrap-basic-memory-never-fork.md` | Restored note-format terminology after rename pass. |
| `docs/adr/0003-playbook-boundary.md` | `check` boundary and deterministic-vs-semantic claim boundary. |
| `CONTEXT.md` | Added `--in`, `check`, and `draft` glossary terms. |
| `AGENT-BUILD-GUIDE.md` | `check`, install-once wording, note-format contract. |

## Grep proof

Command:

```bash
rg -n --glob '!node_modules' --glob '!.git' -- "--kb research|kb defrag|kb lint|kb note " README.md docs/START-HERE.md docs/PRD.md docs/adr CONTEXT.md AGENT-BUILD-GUIDE.md site/index.html || true
```

Result: no matches.

Positive proof command:

```bash
rg -n --glob '!node_modules' --glob '!.git' -- "--in|kb check|kb draft|npm i -g @tylerjnewman/kb" README.md docs/START-HERE.md docs/PRD.md docs/adr CONTEXT.md AGENT-BUILD-GUIDE.md site/index.html
```

Result: matches in README, START-HERE, site, PRD, ADR-0003, ADR-0004, ADR-0005, CONTEXT, and AGENT-BUILD-GUIDE.

## Test receipt

`bun test` passed: 60 pass, 0 fail.

## Deviations

- Hidden aliases `--kb`, `note`, `defrag`, and `lint` remain in code and tests by request, but are not documented as public commands.
- ADR-0004 still mentions `bunx @tylerjnewman/kb ...` only to document that it is ad hoc and does not install a persistent `kb` binary.
