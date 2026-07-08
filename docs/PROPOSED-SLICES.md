# Proposed vertical-slice breakdown for kb CLI (PRD issue #1)

This is a DRAFT plan under review — not yet published as issues. It breaks the PRD into tracer-bullet (vertical) slices. Each slice cuts through all layers: CLI code + printed playbook/help text + subprocess tests.

## Slices

**1. Walking skeleton: `kb new` + scaffold + test harness**
Blocked by: none.
`kb new <name>` creates `~/kb/<name>/` with full layout (`kb.yaml`, thin `AGENTS.md`, `index.md`, `log.md`, `raw/`, `memories/`), silent `git init`. Establishes the temp-dir subprocess test harness (prior art for all later tests). `kb --help` skeleton.
Stories: 1, 3, 6–10, 45, 49.

**2. `kb init` (arbitrary folder) + root-warning + `list` + Registry**
Blocked by: 1.
`kb init` scaffolds into cwd; warns on `~`/`/`. Global Registry (`~/.config/kb/config.yaml`), `kb list`, `--kb <name>` targeting, rebuildable-by-scan.
Stories: 2, 4, 5, 41–44, 50.

**3. Daily loop: `kb add`, `kb note`, `kb log`, `kb read` (playbook boundary)**
Blocked by: 1.
`kb add` stages to `raw/` immutably + logs + prints ingest playbook. `kb note` templates a memory. `kb log`, `kb read` (tiered helper). Format-contract test vs Basic Memory NOTE-FORMAT.md. First real playbook.
Stories: 18–24, 28, 47, 51.

**4. `kb search` engineless (B0) + `kb status`**
Blocked by: 3.
`kb search` over `index.md` + text match. `kb status` (arm, engine, counts). No engine yet.
Stories: 25, 26, 30, 31.

**5. Advisor**
Blocked by: 4.
Threshold rules in `status` (+ cheap elsewhere): corpus/index size → suggest `enable search`; days-since-reflect → suggest reflect. Suggest-only, one-line reason.
Stories: 32–35.

**6. `kb enable search` — the engine integration (B0→B1)**
Blocked by: 4.
Lazy-install Basic Memory (`uvx`), `bm project add`, sync, flip `kb.yaml`; `kb search` routes to hybrid. Stubbed-`bm`-on-PATH tests. Riskiest slice — proves ADR-0001 (wrap, never fork, lazy install).
Stories: 14, 15, 27.

**7. Maintenance playbooks: `kb reflect`, `kb defrag`**
Blocked by: 3.
Deterministic diff (notes-since-last-run) + printed consolidation/cleanup playbooks. Archive-not-delete convention.
Stories: 36–39.

**8. Arms + `--guide`: wiki Arm + `kb lint` + arm selection**
Blocked by: 3.
`--arm wiki|b1|b2` swaps playbook set; wiki eager-ingest playbook + `kb lint`. `kb init --guide` decision tree. Educational `--help` rules-of-thumb pass.
Stories: 11–13, 16, 17, 40, 46, 48.

## Dependency shape
1 → 2, 3; 3 → 4, 7, 8; 4 → 5, 6.

## Open questions for the reviewer
1. Granularity — is 8 slices right? Too coarse or too fine? (Candidate merges: 5 into 4; candidate splits: 6 into install-detection vs search-routing.)
2. Are the dependency relationships correct? (Notably: could `--guide` in slice 8 move earlier, or does it correctly need real arms to describe?)
3. Should any slices be merged or split? Any missing slice, e.g. a prefactoring/setup slice for the Bun/TS project skeleton itself before slice 1?
