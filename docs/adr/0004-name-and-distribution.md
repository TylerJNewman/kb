# Command `kb`, package `@tylerjnewman/kb`, TypeScript on Bun, npm-distributed

Daily ergonomics for the operating agent beat naming purity: the binary is `kb` (`kb add`, `kb status` read like English), published as the scoped package `@tylerjnewman/kb` on npm. Implementation is TypeScript on Bun, installed once with `npm i -g @tylerjnewman/kb`; a compiled single binary can come later. `bunx @tylerjnewman/kb ...` can run the package ad hoc but does not leave a persistent `kb` binary. The Basic Memory engine stays a lazy, out-of-process install (ADR-0001), so the npm package carries no Python at all.

## Amendment (2026-07-08) — scoped name

The original plan published as `kb-cli`, but at publish time `kb-cli` was already owned by another author (`xuege2019`, an unrelated packaging tool at 1.0.4), so it was unavailable to us. We switched to the user-scoped name **`@tylerjnewman/kb`** — guaranteed available under the owner's scope, collision-proof, and signalling ownership. The binary is still `kb`; only the package/install name changed. Lesson recorded: verify the exact npm name (not just adjacent names) before committing to it.

## Considered Options

- `gocer` (repo name) everywhere — unique, zero collision, but opaque; docs would constantly explain it.
- `kbx` — free and short, but tool-ish; `kb` reads better in agent transcripts.

## Consequences

- Accepted small risk: some machine may already have a `kb` binary from another tool.
- Rename after npm publish is costly — this decision is effectively locked at first release.
