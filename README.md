# kb CLI

`kb` is an agent-first CLI for building a local markdown knowledge base: the CLI does deterministic bookkeeping, while your AI agent reads the printed playbooks and does the thinking. It creates plain files you own, keeps `raw/`, `memories/`, `index.md`, `log.md`, and `kb.yaml` consistent, and stays small enough to run with Bun via `bunx @tylerjnewman/kb`.

## Five-minute hello world

```bash
bunx @tylerjnewman/kb new research   # first KB becomes your default

echo "some paper text" > paper.txt
kb add paper.txt      # no --kb needed: acts on your default KB

kb status
kb search "topic"

# Have several KBs? Target one with `--kb <name>`, or cd into its folder.
```

That flow is `new -> add -> AI writes from the playbook -> search -> status`. The full onboarding guide is in [docs/START-HERE.md](https://github.com/TylerJNewman/kb/blob/main/docs/START-HERE.md), and the local HTML version is [site/index.html](https://github.com/TylerJNewman/kb/blob/main/site/index.html).
