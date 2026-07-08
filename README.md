# kb CLI

`kb` is an agent-first CLI for building a local markdown knowledge base: the CLI does deterministic bookkeeping, while your AI agent reads the printed playbooks and does the thinking. It creates plain files you own and keeps `raw/`, `memories/`, `index.md`, `log.md`, and `kb.yaml` consistent.

## Five-minute hello world

```bash
npm i -g @tylerjnewman/kb
kb new research      # first KB becomes your default

echo "some paper text" > paper.txt
kb add paper.txt     # no --in needed: acts on your default KB

kb status
kb search "topic"

# Have several KBs? Target one with `--in <name>`, or cd into its folder.
```

That flow is `new -> add -> AI writes from the playbook -> search -> status`.

## Learn more

- **Visual walkthrough** (ASCII diagrams + toy runs): [docs/WALKTHROUGH.md](https://github.com/TylerJNewman/kb/blob/main/docs/WALKTHROUGH.md) · Tufte-style page → https://tylerjnewman.github.io/kb/walkthrough.html
- **Onboarding guide** (Grug + Feynman, with a quiz): [docs/START-HERE.md](https://github.com/TylerJNewman/kb/blob/main/docs/START-HERE.md) · interactive page → https://tylerjnewman.github.io/kb/
