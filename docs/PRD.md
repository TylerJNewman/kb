# PRD: `kb` — a minimal, self-documenting CLI for local-first markdown knowledge bases

> Design basis: ADRs 0001–0005 and `CONTEXT.md` in this repo. Terms below use the project glossary (KB, Arm, Engine, Memory, Raw source, Derivative, Advisor, Playbook, Registry, KB Home).

## Problem Statement

A person doing research or compiling information wants a place to keep what they learn, add to it over time, and ask questions against it — from anywhere, through the AI agent they already use (Claude Code). Today they either dump notes into files with no structure (and can never find or synthesize them again), or they face heavyweight "second brain" systems that demand vector databases, schemas, and setup decisions they can't make yet because they've never run one. They don't even know where on disk to put a folder. They want to start with almost nothing, get good defaults so they never have to think, and be able to upgrade to more power *only when they feel the need* — without migrating or relearning.

## Solution

A single CLI, `kb`, that an AI agent drives on the user's behalf. One command scaffolds a knowledge base of plain markdown the user owns. The agent adds sources and writes synthesized memories through the CLI; the CLI does the deterministic bookkeeping (staging files, updating an index, appending a log) and prints a **playbook** telling the agent how to do the synthesis half. Everything starts engineless — plain files, no dependencies. When the knowledge base outgrows simple search, the CLI *notices* and *suggests* the upgrade with a one-line reason; the user runs one command (`kb enable search`) and the CLI lazily installs Basic Memory behind the same files, unlocking hybrid search with zero migration. The CLI teaches as it goes: `--help` carries rules of thumb, `--guide` walks the choice of system. The user stays in control; the defaults are good enough that they rarely need to.

## User Stories

### Getting started / scaffolding
1. As a non-technical researcher, I want one command to create a knowledge base, so that I can start without deciding on structure or tools.
2. As a user who lives in the terminal at `~` or `/`, I want the CLI to tell me it's putting my KB in a sensible master folder, so that my files don't end up scattered in the wrong place.
3. As a user, I want `kb new <name>` to create a KB under a default KB Home (`~/kb/<name>/`), so that multiple knowledge bases organize themselves naturally.
4. As a power user, I want `kb init` to scaffold a KB into whatever folder I'm already in (a project repo, an Obsidian vault, a Dropbox folder), so that I'm never confined to the default location.
5. As a user standing in a dangerous root (`~` or `/`), I want `kb init` to warn me and point me at `kb new`, so that I don't scatter a scaffold across my home directory.
6. As a user, I want the scaffold to include a thin `AGENTS.md`, so that any agent that opens the folder immediately knows to use the `kb` CLI and respects the raw/derived boundary.
7. As a user, I want my KB to be a self-contained folder with its own config (`kb.yaml`), so that I can move, copy, or share it without external state.
8. As a user, I want the CLI to `git init` my KB silently if it isn't already a repo, so that history and reversibility are there when I later need them.
9. As a user, I want an `index.md` catalog and an append-only `log.md` created from day one, so that my KB is navigable and its history is traceable before I've added anything.
10. As a user, I want a `raw/` folder for immutable sources and a `memories/` folder for synthesized notes, so that the agent never overwrites my source material.

### Choosing and switching systems (Arms)
11. As a user who doesn't know what I need, I want `kb new` to pick a good default Arm for me, so that I don't have to understand the options to begin.
12. As a curious user, I want `kb init --guide` to print a short decision tree (retrieval vs. curation, corpus size, whether I'll maintain by hand), so that my agent can help me choose an Arm in plain conversation.
13. As a user who has read the guide, I want `kb init --arm wiki|b0` to scaffold the exact scaffold Arm I chose, so that my explicit choice is honored. B1 is reached later with `kb enable search`; B2 is deferred.
14. As a user, I want the default to start engineless (plain files, no Python), so that my first run installs nothing beyond the CLI itself.
15. As a user whose KB has grown, I want `kb enable search` to upgrade me from the engineless default to the search engine over the *same files*, so that I gain power without migrating or relearning.
16. As a user, I want switching Arms to be cheap because all Arms share one markdown substrate, so that my early choice is low-stakes and reversible.
17. As a writer who wants a running overview written for me, I want to choose the wiki Arm, so that the printed add playbook asks the agent to update related pages and review possible contradictions.

### Adding sources and writing memories (the daily loop)
18. As a researcher, I want `kb add <file-or-url>` to stage a source into `raw/` immutably and log it, so that my originals are preserved verbatim.
19. As a researcher, I want `kb add` to then print a playbook telling my agent exactly how to write the memory (executive summary, categorized observations, typed relations, where to save), so that synthesis is consistent without me installing any skill.
20. As a researcher, I want each source to get a short executive summary written once during the add workflow, so that later retrieval is token-cheap and I rarely re-read the raw source.
21. As a user, I want `kb draft <title>` to create a new memory from a template with correct frontmatter, so that my hand-written notes match the format the engine will later index.
22. As a user, I want every memory recorded as one line in `index.md` (link, one-line summary, category), so that my agent can navigate the whole KB by reading one cheap file first.
23. As a user, I want the add workflow to append a greppable `add | ...` entry to `log.md`, so that I can later retrace when and how a source entered.
24. As a user, I want the agent to check for an existing memory on a subject before creating a new one, so that re-adding the same source converges rather than duplicates.

### Asking questions / retrieval
25. As a researcher, I want `kb search <query>` to find relevant material, so that I can answer questions against my accumulated knowledge.
26. As an engineless (default) user, I want `kb search` to use the `index.md` catalog plus text matching, so that I get useful retrieval with zero dependencies at small scale.
27. As an upgraded user, I want `kb search` to transparently use hybrid (keyword + semantic) search after I enable the engine, so that I find notes by meaning even when I've forgotten the exact words I filed them under.
28. As a user, I want `kb read <ref>` to fetch a memory (and help my agent follow the tiered read order: index → summary → derivatives → raw), so that my agent spends the fewest tokens needed to answer.
29. As a researcher, I want answers assembled from the current state of my notes with citations, so that I'm never served a precomputed summary that quietly went stale.
30. As a researcher, I want each question I ask logged, so that my KB reflects what I've been trying to understand over time.

### The Advisor (feed-forward guidance)
31. As a user who doesn't know what's possible, I want `kb status` to summarize my KB's state (Arm, engine, counts), so that I always know where I stand.
32. As a user, I want the Advisor to notice when my KB has outgrown simple search and suggest `kb enable search` with a one-line reason, so that I learn *why* search exists at the moment I need it.
33. As a user, I want the Advisor to notice when I haven't consolidated in a while and suggest a reflect pass, so that my knowledge stays digested without me remembering to maintain it.
34. As a user, I want the Advisor to only *suggest*, never auto-upgrade or auto-modify, so that I stay in control of my own system.
35. As a user, I want the Advisor's suggestions to be good defaults I can accept blindly, so that I get most of the value without having to reason about it.

### Maintenance (reflect / check as playbooks)
36. As a researcher, I want `kb reflect` to compute which memories are new since the last reflect and print a consolidation playbook over exactly those, so that the good connections I just found get written back as durable notes instead of evaporating.
37. As a researcher, I want to trigger reflection while my context is hot (end of session, Nth source), so that writing synthesis back costs almost nothing.
38. As a user, I want `kb check` to print deterministic structural candidates and a cleanup playbook, so that my KB stays inspectable as it grows.
39. As a user, I want superseded facts archived rather than deleted during maintenance, so that I preserve what I believed, when, and what replaced it.
40. As a wiki-Arm user, I want `kb check` to include wiki-link and stale-date checks plus an agent review playbook, so that my eagerly-synthesized wiki doesn't silently drift.

### Multiple KBs / access from anywhere
41. As a user with several topics, I want `kb list` to show all my knowledge bases and which is the default, so that I can see everything I've built.
42. As a user working in any directory, I want to target a specific KB (`kb ... --in <name>`), so that I can reach my memories from anywhere.
43. As a user, I want a global Registry of KB locations that is rebuildable by scanning KB Home, so that the list of my KBs is convenient but never a fragile master copy.
44. As a user, I want to create memories inside an arbitrary project folder, so that project-scoped knowledge can live next to the work it belongs to.

### Learning / self-documentation
45. As a user, I want `kb --help` and `kb <command> --help` to teach rules of thumb (not just list flags), so that the tool itself educates me.
46. As an agent operating the CLI, I want every decision to be expressible as a flag with a documented default, so that I never need an interactive prompt to act on the user's behalf.
47. As an agent, I want the playbooks and guide printed as plain text, so that I can relay them to the human conversationally and choose the next command.
48. As a user reading over my agent's shoulder, I want to learn the system by watching it be used, so that I gradually understand and can take more control.

### Portability / ownership
49. As a user, I want my entire KB to be nothing but a git repo of markdown plus a thin config, so that I get version history, portability, and zero lock-in.
50. As a user, I want to open my KB in Obsidian and browse the files directly, so that I'm never trapped inside the CLI.
51. As a user, I want the memory format to stay strictly compatible with the search engine's expected format, so that enabling search later never breaks my existing notes.

## Implementation Decisions

**Overall shape.** A TypeScript CLI running on Bun, published to npm as `@tylerjnewman/kb` with binary `kb`, installed once with `npm i -g @tylerjnewman/kb` (ADR-0004). No interactive prompts; every decision is a flag with a default; education ships as printed `--help`/`--guide`/playbook text (ADR-0002).

**Engine relationship.** Basic Memory is wrapped as a separate, out-of-process engine, never forked, installed lazily via `uvx basic-memory` only when a B-Arm needs it. The CLI talks to it via `bm tool <cmd> --json` (and, later, its MCP server). The npm package carries no Python (ADR-0001).

**Arms and default.** Recognized Arms share one on-disk substrate; they differ only in *add/query behavior*, not folder layout:
- **A (wiki)** — eager playbook: add asks the agent to write the memory, update related pages, and review possible contradictions; `kb check` adds wiki-link and stale-date checks; engineless.
- **B0 (default)** — lazy, engineless: add writes memory + index line + log line, nothing more; `kb search` = index + text match.
- **B1** — B0 conventions with the Basic Memory engine installed; `kb search` = hybrid search + graph.
- **B2** — B1 plus scheduled reflect/check (scheduling itself deferred past v1).
The default Arm for `kb new` is **B0**. Scaffold Arms are **wiki** and **b0** only; **b1** is reached with `kb enable search`, and **b2** is deferred. The upgrade path B0 → B1 → B2 is the mainline; A is a distinct choice surfaced by the guide.

**Scaffold layout (per KB).** `kb.yaml` (arm, engine state, format version), thin `AGENTS.md` (points to `kb`, states the raw/derived boundary), `index.md` (markdown catalog, fixed line format — chosen over YAML for agent write-fluency), `log.md` (append-only, greppable `## [date] verb | title` prefixes), `raw/` (immutable sources), `memories/` (derivatives in Basic Memory note format). Silent `git init` if not already a repo.

**Note format contract.** Memories are written in Basic Memory's `NOTE-FORMAT.md` shape: frontmatter (`title`, `type`, `tags`, `permalink`), observations as `- [category] content #tag`, relations as `- relation_type [[Target]]`. This compatibility is a tested contract so B0 → B1 needs zero migration.

**Playbook boundary (ADR-0003).** Synthesis verbs (`add`, `reflect`, `check`, and wiki add) do the deterministic half in code (stage files, diff notes-since-last-run, update index/log) then print a playbook for the agent's meaning-making half. Code owns files/index/log/search; the model owns meaning. Contradiction detection, semantic duplicate detection, stale-fact judgment, and note quality are model-side and are never claimed as guarantees.

**KB Home and Registry.** Default KB Home is `~/kb/`; `kb new <name>` scaffolds `~/kb/<name>/`. `kb init` scaffolds into the current directory (warns if cwd is `~` or `/`). A global Registry at `~/.config/kb/config.yaml` records KB paths and the default KB; it is rebuildable by scanning KB Home, so it's convenient but never authoritative over the files.

**Advisor.** Read-only. `kb status` (and cheaply, other commands) evaluates a small set of threshold rules (e.g. corpus size / index length → suggest `kb enable search`; days-since-reflect → suggest `kb reflect`) and prints suggestions with a one-line reason. Never mutates, never auto-upgrades.

**`kb enable search`.** The one real integration in v1: detect/lazy-install Basic Memory (`uvx`), `bm project add` the KB path, run initial sync, flip `kb.yaml` engine state so `kb search` routes to hybrid search. This deliberately proves the ADR-0001 wrapping bet early.

**Command surface (v1).** `new`, `init`, `list`, `status`, `add`, `draft`, `search`, `read`, `log`, `enable search`, `reflect`, `check`, plus `--help`/`--guide` and target flag `--in <name>`.

## Testing Decisions

**What makes a good test here:** assert only on the CLI's *external* behavior — exit code, stdout (help text, guide, playbooks, advisor suggestions), and resulting filesystem/`kb.yaml` state — never on internal functions. The CLI boundary *is* the product contract (ADR-0002/0003), so tests drive `kb` as a subprocess against a temp directory.

**Seam 1 — the CLI boundary (primary, one seam for most of the product).** Spawn `kb <args>` in an isolated temp dir; assert on exit code, stdout, and files written. Covers: scaffold correctness (`new`/`init`, layout, `git init`, root-warning), daily verbs (`add` stages to `raw/` + logs + prints playbook; `draft` templates; `search` over index; `read`; `log`), advisor threshold rules (construct a KB state, assert the suggestion string + reason), arm selection (`--arm` produces the right playbook set), and help/guide text presence.

**Seam 2 — the engine subprocess boundary (stubbed).** For `kb enable search` and post-enable `kb search`, put a stub `bm`/`uvx` on PATH that records invocations and returns canned JSON. Assert the CLI calls the engine with the right arguments and routes search correctly — without requiring Python or real Basic Memory. This reuses the ADR-0001 process boundary; no new seam is invented. A real-engine integration test may exist but runs separately/optionally.

**Format-contract tests (ride Seam 1).** Validate that notes produced by the playbook templates conform to fixtures derived from Basic Memory's `NOTE-FORMAT.md`, enforcing the B0 → B1 no-migration promise in CI.

**Prior art:** none yet (greenfield). Establish the temp-dir subprocess harness as the reference pattern for all future CLI tests.

## Out of Scope

Deferred, recorded in ADR-0005: B2 cron scheduling; an MCP server for any-agent access; `kb skills export` (playbooks-as-Claude-Code-skills); the governance review queue with auto/human lanes and blast-radius routing; packaged/shareable prebuilt KBs; the HTML fidelity / `raw/` archive-format layer; source ranking/provenance/freshness scoring; add connectors (Readwise, YouTube, Notion, etc.); the deep-research fan-out loop; podcast/summary generators; and Obsidian-specific niceties. These are future modules the architecture leaves room for, not v1 work.

## Further Notes

- **Acceptance test for v1 (ADR-0005):** a fresh Claude Code user installs once with `npm i -g @tylerjnewman/kb`, runs `kb new research`, adds three papers, asks one question, and is told by the Advisor what to do next — in under five minutes.
- **Riskiest item:** `kb enable search` (Python/uv presence, Basic Memory version drift). It's deliberately in v1 to validate the wrapping architecture before more is built on it.
- **Design inspirations carried forward** (from the Karpathy LLM-Wiki gist and the Iusztin/Bouchard "10,994 notes" transcript): the cheap index entry point, per-source executive summaries written once at add, tiered read with early-exit, the question log, and depth presets. Their explicitly-unsolved problems (provenance/freshness ranking, compaction, linting, evaluation) map onto our deferred modules.
- **Educational stance:** the product deliberately teaches — good defaults so the user rarely reasons, feed-forward suggestions at the moment a lesson is felt, and progressive complexity (start engineless, upgrade when pain is named).
