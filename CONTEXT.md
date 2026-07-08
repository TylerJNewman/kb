# Knowledge-Base CLI (gocer)

A minimal, self-documenting CLI that lets an agent-driven user scaffold, run, and incrementally upgrade a local-first markdown knowledge base. The CLI owns conventions and education; storage/search engines sit behind it.

## Language

**Knowledge Base (KB)**:
A folder of markdown a user owns, holding their accumulated knowledge, readable and writable through the CLI.
_Avoid_: vault, second brain, memory store

**Arm**:
One of the system configurations a user can run: A (AI-kept wiki, engineless), B0 (Basic Memory conventions, engine not yet installed), B1 (Basic Memory engine, lazy synthesis), B2 (Basic Memory + scheduled reflect/defrag).
_Avoid_: mode, flavor, variant

**Guide**:
Printed decision-tree text (`kb init --guide`) the agent relays to the human to choose an arm; never an interactive prompt.

**Engine**:
Software that provides storage/index/search behind the CLI. Basic Memory is the first engine; the A arm runs engineless (plain files + conventions).
_Avoid_: backend, provider

**Memory**:
A synthesized note — the digested product of conversations, research, or resources. Not a raw source.
_Avoid_: note (when the raw/derived distinction matters)

**Raw source**:
An immutable ingested document (article, paper, transcript). Agents read it, never edit it.
_Avoid_: original, archive file

**Derivative**:
An agent-written markdown page synthesized from raw sources (summary, concept, entity, comparison). Lives on the writable side of the raw/derived boundary.
_Avoid_: wiki page (except inside the A arm)

**Raw/derived boundary**:
The rule that agents never modify raw sources or human-authored notes; they only write derivatives.

**Lazy install**:
Installing an engine only at the moment a user's chosen arm requires it, never at CLI install time.

**KB Home**:
The default master folder (`~/kb/`) where `kb new` creates knowledge bases. A default, never a confinement — `kb init` scaffolds anywhere.

**Registry**:
The global list of KB locations plus a default KB (`~/.config/kb/config.yaml`); lets an agent reach any KB from anywhere. Rebuildable, never a master copy.

**Advisor**:
The feed-forward mechanic: commands notice KB state and print a suggested next move with a one-line reason. Suggests only; never acts.

**Playbook**:
Instructions a synthesis verb prints for the agent's half of the work, after the CLI completes the deterministic half.
_Avoid_: prompt, skill (reserved for exported Claude Code skills)
