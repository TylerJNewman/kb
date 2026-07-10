# Start Here — what `kb` is, in plain terms

> An onboarding guide. Read top to bottom. Takes ten minutes. No prior knowledge needed.
> Two voices help out: **Grug** (plain, concrete, anti-complexity) and **Feynman** (explain it so a smart friend with zero context gets it).

---

## The one-sentence version

`kb` is a **filing clerk that lives in your terminal**. Your AI does the thinking; `kb` does the paperwork. Together they turn scattered reading into a knowledge base you own as plain text files.

---

## The core idea (this is the whole thing)

A knowledge base needs two different jobs done:

- **Thinking** — read a paper, understand it, write a good summary, notice it may contradict another memory.
- **Filing** — create the right folders, preserve the raw source, stamp the log, and print exact instructions for the derived note.

Humans quit knowledge bases because the *filing* grows faster than the value. The AI is great at thinking but sloppy and forgetful at filing across sessions. So we split the two jobs:

> **`kb` does the deterministic filing. The AI creates the derived knowledge: the Memory and its one-line `index.md` catalog entry.**

The clever part: **`kb` has no AI inside it.** When you run `kb add paper.pdf`, it copies the file into `raw/`, stamps the log, and prints a **playbook**. The playbook tells your AI to read the untouched source, write a Memory in kb's structured markdown format, add or update one catalog line in `index.md`, and run the printed completion command. `kb` does not write the Memory or index line itself.

That is why `kb` works with *any* agent and installs nothing heavy. The CLI is small, dumb, and reliable. The intelligence is rented from whatever agent is driving.

---

## The layout (what you actually get)

Run one command, get a folder of plain markdown:

```
~/kb/research/
  raw/        ← original papers, never edited (the vault)
  memories/   ← AI-written summaries (the useful notes)
  index.md    ← one line per memory, the cheap map
  log.md      ← history: what you added, what you asked
  kb.yaml     ← settings
```

All plain text. Opens in Obsidian. Lives in git. No database, no lock-in. You could delete `kb` tomorrow and still have everything.

For a beginner, do **not** open a random folder and initialize it. Run `kb new research` from anywhere. It creates `~/kb/research/`, makes the first KB your default, and records it in `~/.config/kb/config.yaml`.

`kb init` is the advanced alternative: it turns the current directory into a KB when that is specifically what you want.

---

## The "start small, grow later" trick

You begin with **nothing but files** (this is called arm `b0`). Search is just reading the index — fine when the KB is small.

When your KB gets big and reading gets slow, `kb` *notices* and says:

> "You have a lot of notes now — run `kb enable search` to get real search."

That command installs the optional local search engine, Basic Memory, behind the **same files**. It is a search helper that `kb` installs and drives for you; beginners do not need to install or learn it. Nothing moves. Nothing is rewritten. You upgrade only when you feel the pain — and `kb` teaches you *why* at that exact moment.

The thing that watches and suggests is called the **Advisor**. Rule: **it suggests, it never acts.** You stay in control.

---

## Why "deep module" matters here

The interface is tiny — a handful of verbs: `new, add, draft, search, status, reflect`. Behind each verb sits a lot of careful bookkeeping.

You learn six words; you get the whole system. That is **leverage**. You never think about index formats, log prefixes, or engine JSON — `kb` hides all of it. A small set of verbs is a feature, not a limitation.

---

## Quiz (with answers)

Try to answer in your own words first, then check.

**1. The split. `kb` does one job, the AI does the other. Which is which — and why split them?**

> `kb` does deterministic filing: scaffold folders, preserve raw sources, stamp the log, and print playbooks. The AI does the meaning work: understand the source, write the Memory, link related notes, and add or update its catalog line in `index.md`. We split them because the two jobs fail for opposite reasons: filing fails from human laziness and agent forgetfulness, so it must be *deterministic code that never forgets*; thinking needs a real mind, so it must be the *AI*. Put the reliable job in reliable code. Rent the smart job. A `kb` that tried to be smart would be worse at both.

**2. The playbook. You run `kb add mypaper.pdf`. One thing `kb` does; one thing it does NOT do but tells the AI to do. Why can't `kb` do the second thing?**

> `kb` copies the file into `raw/` unchanged, adds a log entry, and prints the playbook. It does **not** write the Memory or update `index.md`; the AI does both because they depend on understanding the source. `kb` can't do that because writing a good summary is *thinking*, and `kb` has no AI inside it. That is the whole design, not a missing feature.

**3. Raw vs memories. Why two folders? What rule does the AI follow about `raw/`?**

> `raw/` holds the **originals, immutable** — the source of truth. `memories/` holds the **AI's derived notes** — the useful, rewritable layer. The rule: **the AI never edits `raw/`.** If a summary is wrong, you fix the memory, never the source. This means you can always re-derive notes from untouched originals, and a bad AI pass can never corrupt your evidence.

**4. The upgrade. Friend has 200 notes, search feels slow. One command? What happens to existing notes? Who tells them?**

> Command: **`kb enable search`**. It installs the optional local search engine, Basic Memory, behind the **same files** — existing notes are **not moved or rewritten**, zero migration. Who tells them: the **Advisor** already suggested it in `kb status` when the KB crossed a size threshold, with a one-line reason. Pain felt → lesson taught → one command → done.

**5. The bet. Why plain markdown in a git folder instead of a nice app with a database?**

> Concrete benefits: **you own it forever** (no lock-in, no vendor), **git gives free history/undo/branching**, **any tool reads it** (Obsidian, grep, another agent), and **the index can always be rebuilt from the files** — the files are the master, never the database. A pretty app that owns your data can disappear; a folder of markdown can't.

**6. Deep module. The whole CLI is ~13 verbs. Why is a *small* verb set a feature?**

> Because **leverage**: you learn a few words and get the whole system; all the messy bookkeeping hides behind them. Small interface + lots of hidden behavior = a deep module. A big interface would mean you have to understand the plumbing to use the tool — the opposite of "so simple you never have to think."

---

## Hello world — your first five minutes

You do not need to choose or open a project folder first.

### 1. Install the command and verify prerequisites

```bash
curl -fsSL https://bun.com/install | bash
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun install --global @tylerjnewman/kb
kb --version
git --version
```

Expected result: the `kb` command becomes available and Git is on `PATH`. `kb` uses Bun at runtime and uses Git when it creates a KB. No KB exists yet.

### 2. Optionally print the walkthrough

```bash
kb start
```

Expected result: terminal instructions explaining the first run. **`kb start` initializes nothing**: it creates no folders, changes no files, and can be skipped.

The output looks like this:

```text
First run

KB Home: /Users/you/kb

Prerequisite: Git must be on PATH because kb new initializes a git repository.
   git --version

1. Create your first KB.
   kb new research

2. Create and stage one harmless source.
   sample_dir="$(mktemp -d)"
   printf '%s\n' 'Vector search helps with fuzzy recall.' > "$sample_dir/hello.txt"
   kb add "$sample_dir/hello.txt" --in research

3. Agent step: give the complete printed playbook to your AI agent.
   The agent writes the Memory and index line, runs the final kb add --complete command,
   and returns the Completed Add handoff receipt.

4. Only after that receipt, confirm and search.
   kb status --in research
   kb search "vector search" --in research
```

It is a reusable cheat sheet, not a setup operation. The path uses your real home directory.

### 3. Create your first KB

```bash
git --version
kb new research
```

Expected result:

- creates `~/kb/research/`;
- prints that absolute path;
- makes `research` your default KB; and
- records its location in `~/.config/kb/config.yaml`.

### 4. Create and add a harmless sample

The file does not have to be inside the KB. It can be anywhere your computer can read. Give `kb add` either:

- a path relative to your terminal's current directory: `paper.txt` or `../Downloads/paper.pdf`; or
- an absolute path: `/Users/you/Downloads/paper.pdf`.

For the first run, create a source so the block works on a clean machine:

```bash
sample_dir="$(mktemp -d)"
printf '%s\n' 'Vector search helps with fuzzy recall.' > "$sample_dir/hello.txt"
kb add "$sample_dir/hello.txt" --in research
```

Expected result: `kb` leaves the sample in place, copies its contents into `~/kb/research/raw/`, stamps `log.md`, records a pending handoff, and prints an Add playbook containing the exact copied-source and Memory paths. The explicit target prevents a terminal inside another KB from silently receiving the source.

### 5. Let your AI follow the playbook

Stop running shell commands and send your AI this handoff message:

> Work in `~/kb/research`. Follow the complete Add playbook printed above. Read the staged raw source without editing it, write the Memory and index entry, run the exact final `kb add --complete ... --in research` command from the playbook, and return its `Completed Add handoff` receipt.

Your AI:

1. reads the staged `raw/` file without editing it;
2. checks for an existing Memory on the subject;
3. writes the target Memory in kb's structured markdown format;
4. adds or updates one catalog line in `index.md`; and
5. runs the exact completion command from the playbook.

`kb add` does **not** write the Memory or update `index.md` itself.

Expected result: a new or updated Memory, its catalog line in `~/kb/research/index.md`, and a receipt beginning `Completed Add handoff:`. Before that receipt, `kb status` may correctly say `Health: unfinished work`.

### 6. Confirm and search

```bash
kb status --in research
kb search "vector search" --in research
rm -rf "$sample_dir"
```

Expected result: `kb status` shows source, Memory, and index counts; `kb search` returns matching Memories.

That is it: **install → optional walkthrough → new → add a file path → agent writes Memory and index line → status/search.** No database, no signup, and no configuration to write by hand.

**Why use `--in research` in the tutorial?** Normal targeting prefers the KB your terminal is inside, then your default. The explicit target makes this copied tutorial deterministic even when you already have other KBs.

### Coming back or retrying?

Do not recreate an existing KB. Run `kb status --in research`. If it lists unfinished Add work, run its shown `kb add --resume <raw-ref> --in research` command and give the complete resumed playbook to your AI. `KB already exists` is a safe refusal; it does not replace your files.

If an earlier `kb new` failed with `git init failed`, install Git, run `git -C ~/kb/research init`, then rerun `kb new research` so kb can register the repaired scaffold. It prints either `Recovered KB` or the safe refusal `KB already exists`; then continue with `kb status --in research`.

**What about `kb init`?** It scaffolds the current directory. That is useful for an existing project you deliberately want to make into a KB, but it is not the beginner path.

In an AI coding agent, you can say: *"Add this paper to my research KB and follow the printed playbook."*

---

## Keep learning

- Open the current self-contained HTML onboarding page for the Grug/Feynman explanations and quiz.
- Open the visual walkthrough for the complete worked Add lifecycle.
- Run `kb start` whenever you want the deterministic, read-only checklist again.

First-run guidance stays non-interactive: **simple on the surface, deep underneath, and the user always in control.**
