# Synthesis verbs emit playbooks: CLI owns deterministic half, agent owns meaning

The CLI has no LLM, but its operator (an agent) does. For any verb that needs synthesis (`kb add`, `kb reflect`, `kb defrag`), the CLI performs the deterministic part (stage files into raw/, compute which notes changed since last reflect, append log, update index) and then prints a playbook — precise instructions for the agent's half (write the executive summary, extract observations/relations, save to memories/, run the follow-up command). We chose this over keeping synthesis instructions in external skill files.

## Considered Options

- **Purely deterministic CLI, instructions live in AGENTS.md/skills** — rejected: the knowledge of how to write good notes drifts away from the tool; every agent needs separate setup.
- **Playbooks embedded in CLI (chosen)** — self-documentation becomes literal; works with any agent, zero installation; playbooks version with the CLI.
- **Exportable skills** (`kb skills export` for slash-command ergonomics) — deferred, additive later; playbooks remain the source of truth.

## Consequences

- Playbook text is a first-class, versioned product surface (like --help).
- The code/model boundary is explicit: code owns files, index, log, search; model owns meaning. Contradiction detection and note quality are model-side and must never be claimed as guarantees.
