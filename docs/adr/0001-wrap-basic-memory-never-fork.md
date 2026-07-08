# Wrap Basic Memory as an out-of-process engine; never fork; lazy-install

Our CLI needs Basic Memory's substrate (markdown notes, SQLite index, hybrid search, schema tooling) for its B arms, but Basic Memory is AGPL-3.0 with a CLA, written in Python with a heavy native dependency tree (onnxruntime, SQLAlchemy, Alembic), while our CLI is TypeScript/Bun. We decided to wrap upstream Basic Memory as a separate process — installed lazily (`uvx basic-memory`) only when a user picks a B arm — talking to it via `bm tool <cmd> --json` (and later its MCP server). We never fork.

## Considered Options

- **Fork Basic Memory** — rejected: AGPL forces open-sourcing the derivative; we'd own a Python codebase off our stack; upstream is very active, so a fork diverges and rots.
- **Reimplement in TS** — rejected for now: the note format is a documented spec with a deterministic regex parser, so thin read-only parts *could* be reimplemented — kept as escape hatch if upstream dies, not as plan.
- **Hard dependency at install** — rejected: A-arm (wiki) users need zero dependencies; "extremely minimal install" is a core product value.

## Consequences

- Our note format must stay strictly compatible with Basic Memory's `NOTE-FORMAT.md` spec, or the A→B upgrade path lies. This is a contract to test in CI.
- Basic Memory's skills (memory-notes, memory-reflect, memory-defrag, memory-schema) are plain markdown prompts — we adapt them freely rather than depending on them.
- License boundary: we invoke Basic Memory as a separate process; we do not import or link its code.
