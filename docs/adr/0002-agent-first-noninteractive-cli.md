# Agent-first CLI: non-interactive, flag-driven, guide-as-text

The CLI's primary operator is an AI agent (Claude Code) acting for a human, so we ship no interactive wizards or TUI prompts. Every scaffold decision is expressible as a flag (`kb init --arm wiki|b0`; `b1` is reached later with `kb enable search`; `b2` is deferred); education ships as printed text (`kb init --guide`, `--help`) written for the agent to relay conversationally to the human. `kb init` with no flags scaffolds the recommended default. A future arm-switching command is deferred; all arms still share one markdown substrate and conventions.

## Consequences

- Help text is a first-class product surface: it must teach rules of thumb (retrieval vs. curation, drift tax), not just list flags.
- Anything a wizard would ask must exist as a documented flag with a default.
- Interactive prompts are a design regression, not a convenience.
