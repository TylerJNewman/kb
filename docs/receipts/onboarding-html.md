# Onboarding HTML Receipt

## Deliverable

- Added `site/index.html`, a single-file kb CLI onboarding page with inline CSS and inline JS.
- Did not touch `src/` or `test/`.

## Sections

- Hero with the one-sentence version and a "Start in 5 minutes" anchor.
- Core idea with the `kb` bookkeeping / AI thinking split.
- Voice toggle for Grug and Feynman explanations.
- Folder layout for `~/kb/research/`.
- Start small, grow later story: B0, Advisor suggestion, `kb enable search`, same files.
- Six-question quiz using revealable `<details>` cards and the answers from `docs/START-HERE.md`.
- Hello-world command block with copy button.
- Honest footer: local-first markdown, user-owned, git-native, Obsidian-ready, repo name as text.

## Zero External Resources

Command:

```sh
~/.local/bin/timeout 10 rg -n "http://|https://|//cdn|stylesheet|script src|url\\(|@import" site/index.html || true
```

Result: no output.

The page has no external CSS, scripts, fonts, images, imports, fetches, or remote URLs. CSS and JS are inline.

## Interactive Features

- Manual theme toggle cycles `auto -> light -> dark` with a `data-theme` override.
- Voice toggle switches the core explanation between Grug and Feynman copy.
- Quiz answers reveal through native semantic `<details>` controls.
- Copy button uses `navigator.clipboard.writeText` with a textarea / `execCommand("copy")` fallback.

## Viewport And Theme Handling

- Mobile-first layout supports 320px and up.
- Wide code and folder tree content scroll inside their containers.
- Light/dark themes are defined with `@media (prefers-color-scheme)` and manual overrides.
- Motion is subtle and guarded by `prefers-reduced-motion`.
- Semantic landmarks and keyboard-usable native controls are used throughout.
