# Agent Build Guide — kb CLI

You are one of several autonomous agents implementing the `kb` CLI. Read this fully before writing code.

## What the project is
A minimal, self-documenting CLI (`kb`) that an AI agent drives to scaffold and grow a local-first markdown knowledge base. Full design is in this repo:
- `docs/PRD.md` — problem, solution, 51 user stories, implementation + testing decisions.
- `docs/adr/0001..0005*.md` — binding architecture decisions. Do NOT re-litigate them.
- `CONTEXT.md` — domain glossary (use these exact terms: KB, Arm, Engine, Memory, Raw source, Derivative, Advisor, Playbook, Registry, KB Home).

## Non-negotiable architecture (from ADRs)
- **Stack:** TypeScript on **Bun**. npm package `@tylerjnewman/kb`, binary `kb`. Install-once runnable after `npm i -g @tylerjnewman/kb`.
- **Agent-first, non-interactive:** no wizards/TUI prompts ever. Every decision is a flag with a default. Education ships as printed `--help`/`--guide`/playbook text.
- **Playbook boundary:** the CLI has NO LLM. Synthesis verbs (`add`, `reflect`, `check`, wiki add) do the deterministic half in code (stage files, update index/log, diff notes) then PRINT a playbook for the agent's meaning-making half. Never claim contradiction-detection or note quality as a code guarantee.
- **Engine = Basic Memory, wrapped out-of-process, never forked, lazy-installed** via the pinned runner `uvx --from basic-memory==0.22.1 bm` only when a B-arm needs search. Talk to it through that runner for every operation. The npm package carries no Python. Reference checkout: `/Users/tyler/code/mcp/basic-memory` (see its `NOTE-FORMAT.md`).
- **Arms (v1):** `wiki` (eager, engineless), `b0` (default, lazy, engineless), `b1` (b0 + engine). `--arm b2` is DEFERRED — reject it with a "deferred" message. Maintenance reminders = the Advisor (default-on), not a separate arm.

## Basic Memory command contract (from the Slice 0b spike — USE THESE, not guesses)
The spike (`docs/spikes/basic-memory-contract.md`, fixtures in `test/fixtures/basic-memory-contract/`) captured real Basic Memory 0.22.1 behavior. Engine slices MUST match:
- Install/run: `uvx --from basic-memory==0.22.1 bm ...`. Do not use or create a persistent bare `bm` executable in product code or fakes.
- Add project: `uvx --from basic-memory==0.22.1 bm project add <name> <path>`.
- Index (there is NO `bm sync`): `uvx --from basic-memory==0.22.1 bm reindex --project <name> --search`.
- Search: `uvx --from basic-memory==0.22.1 bm tool search-notes "<query>" --project <name>` — **prints JSON by default; does NOT accept `--json`/`--format json`** (passing them errors). Optional `--entity-type observation|relation`.
- Status: `bm status --project <name> --json` (can time out if no server running).
- Fake `uvx`/`bm` stubs in tests must replay the fixtures under `test/fixtures/basic-memory-contract/`.

## Note-format contract (must stay Basic Memory compatible)
Memories are markdown with: frontmatter (`title`, `type`, `tags`, `permalink`); observations as `- [category] content #tag`; relations as `- relation_type [[Target]]`. This is a tested contract — B0 memories must be B1-importable with zero migration.

## Scaffold layout (per KB)
`kb.yaml`, thin `AGENTS.md`, `index.md` (fixed-line catalog), `log.md` (append-only, greppable `## [date] verb | title`), `raw/` (immutable), `memories/` (derivatives). `kb.yaml` shape:
```yaml
schemaVersion: 1
formatVersion: basic-memory-note-v1
arm: b0
engine:
  basicMemory:
    state: disabled
    project: null
lastReflectAt: null
```

## Testing rules
- Test only EXTERNAL behavior via the CLI boundary: spawn the packaged `kb` binary as a subprocess against an isolated temp `HOME`/`XDG_CONFIG_HOME`/cwd and a controlled `PATH`. Assert exit code, stdout/stderr, filesystem state. No internal-unit seams unless forced.
- External tools (`git`, `uvx`) are faked via stub executables on the controlled PATH, replaying fixtures. Basic Memory fakes model `uvx --from basic-memory==0.22.1 bm ...` dispatch and never create a persistent `bm`.
- `bun test` must pass green before you commit.

## Your workflow
1. Read this guide + `docs/` + your assigned issue.
2. Implement ONLY your slice. Respect the layer contracts above.
3. Reuse the foundation (arg parser, harness, fixtures) — do not reinvent it.
4. Run `bun test`. Iterate until green.
5. Commit with a clear message ending: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do not push; the orchestrator handles integration.
6. If you must deviate from the issue, write why in the commit body.
