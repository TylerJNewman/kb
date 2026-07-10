# kb CLI

`kb` is an agent-first filing clerk for local markdown knowledge bases. The CLI scaffolds folders, stages raw sources, stamps the log, and prints precise playbooks. Your AI agent reads the sources, writes the Memories, and updates `index.md`. There is no LLM inside `kb`.

## Five-minute hello world

`kb` runs on Bun. On macOS or Linux, this installs Bun, makes it available in the current shell, installs `kb`, and verifies the command:

```bash
curl -fsSL https://bun.com/install | bash
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun install --global @tylerjnewman/kb
kb --version
```

If Bun is already installed, start at `bun install --global @tylerjnewman/kb`. npm can install the package after Bun is present, but npm alone does not supply the runtime used by the `kb` launcher.

`kb start` is optional, read-only help. It prints the beginner walkthrough and initializes nothing. Skip it if you are ready to continue.

Create your KB and stage a harmless sample source:

```bash
kb new research
sample_dir="$(mktemp -d)"
printf '%s\n' 'Vector search helps with fuzzy recall.' > "$sample_dir/hello.txt"
kb add "$sample_dir/hello.txt"
rm -rf "$sample_dir"
```

`kb new research` creates `~/kb/research/`, makes it your default KB, and records it in `~/.config/kb/config.yaml`. `kb add` accepts an existing relative or absolute source path, leaves the original alone, copies it into `raw/`, and prints an Add playbook.

Give the complete Add playbook to your AI agent and ask it to follow the “Agent half” in `~/kb/research`. Printed `raw/...` and `memories/...` paths are relative to that KB root. The agent reads the raw copy, writes the Memory, updates `index.md`, and runs the printed completion command. `kb` does not perform those meaning-dependent steps.

After the agent finishes:

```bash
kb status
kb search "vector search"
```

You do not need to prepare a project folder first. Use `kb init` only when you intentionally want to turn the current directory into a KB.

Beginner flow: `install Bun and kb → optional start → new → add an existing source → agent follows and completes the playbook → status/search`.

## Learn more

- **Visual walkthrough** (ASCII diagrams + toy runs): [docs/WALKTHROUGH.md](https://github.com/TylerJNewman/kb/blob/main/docs/WALKTHROUGH.md) · Tufte-style page → https://tylerjnewman.github.io/kb/walkthrough.html
- **Onboarding guide** (Grug + Feynman, with a quiz): [docs/START-HERE.md](https://github.com/TylerJNewman/kb/blob/main/docs/START-HERE.md) · interactive page → https://tylerjnewman.github.io/kb/
