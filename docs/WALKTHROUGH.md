# kb — visual walkthrough

Plain-language, ASCII, copy-paste. The basics in five minutes.

---

## 1. The one idea: split the work

```
                YOU  (talking to your AI agent)
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │            kb   (the CLI)            │   ← NO AI inside.
        │   ───────────────────────────────   │     just reliable
        │   • copy file into  raw/            │     bookkeeping.
        │   • add one line to index.md        │
        │   • stamp   log.md                  │
        │   • then PRINT a playbook ──────────┼───┐
        └─────────────────────────────────────┘   │
                                                   │  "now read raw/paper.txt,
                                                   │   write a ≤150-word summary,
                                                   ▼   save to memories/…"
        ┌─────────────────────────────────────┐
        │           your AI agent             │   ← the thinking.
        │   reads the playbook, understands   │     reads, summarizes,
        │   the paper, writes the memory      │     links, questions.
        └─────────────────────────────────────┘
```

**kb does the paperwork. The AI does the thinking. Neither does the other's job.**

---

## 2. What lands on disk

```
~/kb/research/
├── raw/          originals, NEVER edited        (the vault)
├── memories/     AI-written summaries           (the useful notes)
├── index.md      one line per memory            (the cheap map)
├── log.md        what you did + when            (the history)
└── kb.yaml       settings (arm, engine)
```

All plain text. Opens in Obsidian. Lives in git. Delete `kb` tomorrow — you still have everything.

---

## 3. The hello-world pipeline

```
  kb new  ───▶  kb add  ───▶  (AI writes)  ───▶  kb status / kb search
  ────────      ────────      ───────────       ─────────────────────
  make a KB     file a        memory saved      see state + Advisor tip
  ~/kb/research raw source     to memories/      / ask your notes
                + playbook
```

---

## 4. Toy run — copy/paste and watch

```console
$ npm i -g @tylerjnewman/kb        # one-time install

$ kb new research
Created KB: research
Path: ~/kb/research
Default: research
Next: kb add <file-or-url>

$ echo "Vector search beats keyword search for fuzzy recall." > paper.txt
$ kb add paper.txt
Add playbook
Raw source: raw/paper-9c1f.txt          # original, filed untouched
Memory target: memories/paper.md
Agent half:
  1. Read raw/paper-9c1f.txt.
  2. Write a summary; save to memories/paper.md.
  3. Run: kb index update
        |
        v   (your AI now writes memories/paper.md — the thinking half)

$ kb status
KB: research
Arm: b0 (plain markdown)                # engineless, zero deps
Search: plain files
Sources: 1   Memories: 1   Index entries: 1
Advisor:
- No suggestions.                       # too small to need search yet
```

---

## 5. Toy run — the "grow later" moment

```
   small KB                                    bigger KB
   ────────                                    ─────────
   kb search reads index.md            the Advisor notices:
   (plain files, instant)      ──▶     "87 notes — run kb enable search"
                                                |
                                                v
                              $ kb enable search
                              Search enabled for research.
                              Arm: b1. Existing files unchanged.   # SAME files
                                                |
                                                v
                              kb search now uses a real engine
                              (Basic Memory) over the same markdown
```

You upgrade only when you feel the pain — and `kb` tells you *why* at that moment. The Advisor suggests; it never acts.

---

## 6. The whole verb set (small on purpose)

```
  LEARN     kb start                      print a walkthrough (no changes)
  CREATE    kb new <name>                 make a KB (first = default)
            kb init                       scaffold in the current folder
  ADD       kb add <file|url>             file a raw source + playbook
            kb draft "<title>"            blank memory for the agent to fill
  ASK       kb search "<query>"           ask your notes
            kb status                     state + Advisor's next tip
            kb read <memory>              open one memory
            kb list                       all your KBs
  GROW      kb enable search              turn on the real engine (b0→b1)
  TIDY      kb reflect                    plan: consolidate recent memories
            kb check                      plan: structural issues to fix
```

Targeting rule (why you rarely type `--in`):

```
  which KB?   1.  --in <name>   (explicit)
              2.  the KB you're cd'd inside
              3.  your default KB          # covers the normal one-KB case
```

---

## 7. In Claude Code you don't type any of this

You say:

> "Add these three papers to my research KB and tell me what they agree on."

The agent runs `kb add` three times, follows each printed playbook to write the memories, then `kb search` to answer — and you watch it happen.
