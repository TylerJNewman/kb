# Start Here — what `kb` is, in plain terms

> An onboarding guide. Read top to bottom. Takes ten minutes. No prior knowledge needed.
> Two voices help out: **Grug** (plain, concrete, anti-complexity) and **Feynman** (explain it so a smart friend with zero context gets it).

---

## The one-sentence version

`kb` is a **filing clerk that lives in your terminal**. Your AI does the thinking; `kb` does the paperwork. Together they turn scattered reading into a knowledge base you own as plain text files.

---

## The core idea (this is the whole thing)

A knowledge base needs two different jobs done:

- **Thinking** — read a paper, understand it, write a good summary, notice it contradicts another note.
- **Bookkeeping** — copy the file to the right folder, add a line to the index, stamp the log, never lose anything.

Humans quit knowledge bases because the *bookkeeping* grows faster than the value. The AI is great at thinking but sloppy and forgetful at bookkeeping across sessions. So we split the two jobs:

> **`kb` (the CLI) does all bookkeeping. The AI does all thinking. Neither does the other's job.**

The clever part: **`kb` has no AI inside it.** When you run `kb add paper.pdf`, it does its half — copies the file into `raw/`, stamps the log — then **prints instructions**: "now read this, write a summary ≤150 words, save it here." Those printed instructions are called a **playbook**. The AI reads the playbook and does the thinking half.

That is why `kb` works with *any* agent and installs nothing heavy. The CLI is small, dumb, and reliable. The intelligence is rented from whatever agent is driving.

---

## The layout (what you actually get)

Run one command, get a folder of plain markdown:

```
~/kb/research/
  raw/        ← original papers, never edited (the vault)
  memories/   ← AI-written summaries (the useful notes)
  index.md    ← one line per note, the cheap map
  log.md      ← history: what you added, what you asked
  kb.yaml     ← settings
```

All plain text. Opens in Obsidian. Lives in git. No database, no lock-in. You could delete `kb` tomorrow and still have everything.

---

## The "start small, grow later" trick

You begin with **nothing but files** (this is called arm `b0`). Search is just reading the index — fine when the KB is small.

When your KB gets big and reading gets slow, `kb` *notices* and says:

> "You have a lot of notes now — run `kb enable search` to get real search."

That command installs a real search engine (Basic Memory) behind the **same files**. Nothing moves. Nothing is rewritten. You upgrade only when you feel the pain — and `kb` teaches you *why* at that exact moment.

The thing that watches and suggests is called the **Advisor**. Rule: **it suggests, it never acts.** You stay in control.

---

## Why "deep module" matters here

The interface is tiny — a handful of verbs: `new, add, note, search, status, reflect`. Behind each verb sits a lot of careful bookkeeping.

You learn six words; you get the whole system. That is **leverage**. You never think about index formats, log prefixes, or engine JSON — `kb` hides all of it. A small set of verbs is a feature, not a limitation.

---

## Quiz (with answers)

Try to answer in your own words first, then check.

**1. The split. `kb` does one job, the AI does the other. Which is which — and why split them?**

> `kb` does **bookkeeping** (file, index, log, stamp). The AI does **thinking** (understand, summarize, link, spot contradictions). We split them because the two jobs fail for opposite reasons: bookkeeping fails from human laziness and agent forgetfulness, so it must be *deterministic code that never forgets*; thinking needs a real mind, so it must be the *AI*. Put the reliable job in reliable code. Rent the smart job. A `kb` that tried to be smart would be worse at both.

**2. The playbook. You run `kb add mypaper.pdf`. One thing `kb` does; one thing it does NOT do but tells the AI to do. Why can't `kb` do the second thing?**

> `kb` **does**: copy the file into `raw/` unchanged, add a log entry, print the playbook. `kb` does **not** write the summary — it *tells the AI* to read the paper and write a ≤150-word summary with observations and links. `kb` can't do that because writing a good summary is *thinking*, and `kb` has no AI inside it. That is the whole design, not a missing feature.

**3. Raw vs memories. Why two folders? What rule does the AI follow about `raw/`?**

> `raw/` holds the **originals, immutable** — the source of truth. `memories/` holds the **AI's derived notes** — the useful, rewritable layer. The rule: **the AI never edits `raw/`.** If a summary is wrong, you fix the memory, never the source. This means you can always re-derive notes from untouched originals, and a bad AI pass can never corrupt your evidence.

**4. The upgrade. Friend has 200 notes, search feels slow. One command? What happens to existing notes? Who tells them?**

> Command: **`kb enable search`**. It installs the Basic Memory engine behind the **same files** — existing notes are **not moved or rewritten**, zero migration. Who tells them: the **Advisor** already suggested it in `kb status` when the KB crossed a size threshold, with a one-line reason. Pain felt → lesson taught → one command → done.

**5. The bet. Why plain markdown in a git folder instead of a nice app with a database?**

> Concrete benefits: **you own it forever** (no lock-in, no vendor), **git gives free history/undo/branching**, **any tool reads it** (Obsidian, grep, another agent), and **the index can always be rebuilt from the files** — the files are the master, never the database. A pretty app that owns your data can disappear; a folder of markdown can't.

**6. Deep module. The whole CLI is ~13 verbs. Why is a *small* verb set a feature?**

> Because **leverage**: you learn a few words and get the whole system; all the messy bookkeeping hides behind them. Small interface + lots of hidden behavior = a deep module. A big interface would mean you have to understand the plumbing to use the tool — the opposite of "so simple you never have to think."

---

## Hello world — your first five minutes

Once published (`kb-cli` on npm), the whole first session:

```bash
bunx kb-cli new research          # make a knowledge base
# → creates ~/kb/research/ with the folders above

echo "some paper text" > paper.txt
kb --kb research add paper.txt    # file it + get a playbook
# → kb copies it to raw/, prints: "now write the summary, save to memories/…"
# → your AI reads the playbook and writes the memory

kb --kb research status           # see where you stand
# → Arm, counts, and the Advisor's next suggestion

kb --kb research search "topic"   # ask against your notes
```

That is it: **new → add → (AI writes) → search → status.** No database, no signup, no config.

In Claude Code you do not even type these. You say *"add these three papers to my research KB"* and the agent runs the verbs and follows the playbooks for you.

---

## Where this is going (planned, not built yet)

This document is the seed of something friendlier:

- **A voiced, interactive tutorial** — Grug and Feynman walking a newcomer through their first KB, asking the quiz questions live, celebrating each step.
- **Beautiful HTML onboarding** — the same content as a single self-contained page: fun, simple, engaging, but honest about the power underneath.
- **A guided first-run** — `kb` itself could offer to walk a brand-new user through hello-world.

The goal never changes: **simple on the surface, deep underneath, and the user always in control.**
