# My goal: should-fix pass + beautiful onboarding

Two independent workstreams, dispatched in parallel via dex/cmux, each in its own worktree, merged when both return.

## Lane A — should-fix (code, worktree `should-fix`)
Oracle's non-blocking findings, to make the interface clean enough for non-technical friends:
1. Extract a `BasicMemoryAdapter` behind an `Engine` interface — get bm/uvx command + JSON + failure knowledge out of command handlers. Second engine could slot in. External behavior unchanged.
2. Command mutation-matrix test — pin exactly what each verb may mutate.
3. `defrag` naming honesty (prints a plan, doesn't move files) + gate `lint` as wiki-only.

## Lane B — onboarding (artifact, worktree `onboarding-html`)
A self-contained, beautiful, theme-aware HTML page built from `docs/START-HERE.md`, with Grug + Feynman voices and an interactive quiz. The fun front door.

## Integration
Lane A touches `src/`, `test/`. Lane B adds one HTML file. Disjoint → clean merge. Verify suite green + smoke the page, then push.
