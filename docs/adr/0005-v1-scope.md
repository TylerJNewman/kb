# v1 is a walking skeleton: whole loop thin, nothing deep

v1 ships the complete loop — scaffold (`kb new`/`kb init` + `--arm`/`--guide`, six-piece layout, silent git init, registry, `kb list`), daily verbs (`kb add`, `kb note`, `kb search` as index+grep in B0, `kb log`, `kb read`), advisor v0 (2–3 threshold rules in `kb status`), the one real integration (`kb enable search`: uvx-install Basic Memory, project add, sync, hybrid search takeover), maintenance playbooks (`kb reflect`, `kb defrag`), and a minimal arm A (`--arm wiki` swaps the playbook set, adds `kb lint`). Educational `--help` and `--guide` are in scope as product surfaces.

Acceptance test: a fresh Claude Code user runs `bunx kb-cli new research`, adds three papers, asks one question, and is told by the advisor what to do next — in under five minutes, with nothing installed but the npm package.

## Deferred (recorded, not lost)

B2 cron scheduling, MCP server, `kb skills export`, review queue with auto/human lanes, packaged/shareable KBs, HTML fidelity layer, ranking/provenance scoring, connectors (Readwise, YouTube, …), deep-research loop, podcast/summary generators, Obsidian niceties.

## Consequences

- `kb enable search` is the riskiest item (Python/uv presence, BM version drift) and is deliberately in v1 to prove ADR-0001 early.
- Arm A is included only because it is playbook text over the shared scaffold; any A-arm feature requiring code beyond `kb lint` waits.

## Amendment (post-Oracle review, 2026-07-07)

- v1 accepts arms `wiki`, `b0` (default), and `b1`. `--arm b2` is deferred: B2 means "B1 plus a scheduler," and scheduling is out of v1. The "maintenance reminders" experience is delivered by the Advisor (default-on for B0/B1), not by a separate arm — so no near-duplicate arm is exposed.
- A prefactor slice (Slice 0) carries the Bun/TS skeleton, arg parser, `kb.yaml` schema, format fixtures, and the subprocess test harness; Slice 1 is just `kb new` + scaffold. A timeboxed Basic Memory contract spike (Slice 0b) captures real `uvx`/`bm` commands + JSON fixtures before the engine slices depend on them.
- The Advisor is not a standalone slice; each rule ships with the command it advises.
