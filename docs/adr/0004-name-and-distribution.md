# Command `kb`, package `kb-cli`, TypeScript on Bun, npm-distributed

Daily ergonomics for the operating agent beat naming purity: the binary is `kb` (`kb add`, `kb status` read like English), published as `kb-cli` on npm since the bare `kb` name is squatted. Implementation is TypeScript on Bun, runnable with zero install via `bunx`/`npx kb-cli`; a compiled single binary can come later. The Basic Memory engine stays a lazy, out-of-process install (ADR-0001), so the npm package carries no Python at all.

## Considered Options

- `gocer` (repo name) everywhere — unique, zero collision, but opaque; docs would constantly explain it.
- `kbx` — free and short, but tool-ish; `kb` reads better in agent transcripts.

## Consequences

- Accepted small risk: some machine may already have a `kb` binary from another tool.
- Rename after npm publish is costly — this decision is effectively locked at first release.
