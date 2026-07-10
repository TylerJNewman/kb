# kb CLI

`kb` is an agent-first filing clerk for local markdown knowledge bases. The CLI scaffolds folders, stages raw sources, stamps the log, and prints precise playbooks. Your AI agent reads the sources, writes the Memories, and updates `index.md`. There is no LLM inside `kb`.

## Five-minute hello world

`kb` runs on Bun and uses Git when it creates a KB. On macOS or Linux, this installs Bun, makes it available in the current shell, installs `kb`, and verifies both prerequisites:

```bash
curl -fsSL https://bun.com/install | bash
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun install --global @tylerjnewman/kb
kb --version
git --version
```

If Bun is already installed, start at `bun install --global @tylerjnewman/kb`. npm can install the package after Bun is present, but npm alone does not supply the runtime used by the `kb` launcher.

`kb start` is optional, read-only help. It prints the beginner walkthrough and initializes nothing. Skip it if you are ready to continue.

Create your KB and stage a harmless sample source:

```bash
git --version
kb new research
sample_dir="$(mktemp -d)"
printf '%s\n' 'Vector search helps with fuzzy recall.' > "$sample_dir/hello.txt"
kb add "$sample_dir/hello.txt" --in research
```

`kb new research` creates `~/kb/research/`, makes it your default KB, and records it in `~/.config/kb/config.yaml`. **Research is just an example name**: choose any simple KB name, such as `books` or `client-notes`, and substitute it in the later `--in` commands and paths. `kb add` accepts an existing relative or absolute source path, leaves the original alone, copies it into `raw/`, creates a pending handoff, and prints an Add playbook. `--in research` keeps the tutorial pointed at this KB even if your terminal is inside another one.

Stop here and send your AI agent this handoff message:

> Work in `~/kb/research`. Follow the complete Add playbook printed above. Read the staged raw source without editing it, write the Memory and index entry, run the exact final `kb add --complete ... --in research` command from the playbook, and return its `Completed Add handoff` receipt.

Printed `raw/...` and `memories/...` paths are relative to that KB root. Do not invent the generated paths. `kb` does not perform those meaning-dependent steps.

Only after the agent returns the completion receipt, verify and optionally remove the temporary source:

```bash
kb status --in research
kb search "vector search" --in research
rm -rf "$sample_dir"
```

### Coming back or retrying?

Do not recreate an existing KB. Run `kb status --in research`. If it lists unfinished Add work, run the shown `kb add --resume <raw-ref> --in research` command and give the complete resumed playbook to your AI. `KB already exists` is a safe refusal; it does not delete or replace the KB.

If `kb new` previously failed with `git init failed`, install Git, run `git -C ~/kb/research init`, then rerun `kb new research` so kb can register the repaired scaffold. It prints either `Recovered KB` or the safe refusal `KB already exists`; then continue with `kb status --in research`.

You do not need to prepare a project folder first. Use `kb init` only when you intentionally want to turn the current directory into a KB.

Beginner flow: `install Bun and kb → optional start → new → add an existing source → agent follows and completes the playbook → status/search`.

## Learn more

- **Visual walkthrough** (ASCII diagrams + toy runs): [docs/WALKTHROUGH.md](https://github.com/TylerJNewman/kb/blob/main/docs/WALKTHROUGH.md) · Tufte-style page → https://tylerjnewman.github.io/kb/walkthrough.html
- **Onboarding guide** (Grug + Feynman, with a quiz): [docs/START-HERE.md](https://github.com/TylerJNewman/kb/blob/main/docs/START-HERE.md) · interactive page → https://tylerjnewman.github.io/kb/
