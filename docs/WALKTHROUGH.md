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
        │   • copy file into raw/             │     bookkeeping.
        │   • stamp log.md                    │
        │   • print the exact Memory target   │
        │   • then PRINT a playbook ──────────┼───┐
        └─────────────────────────────────────┘   │
                                                   │  "read the raw source,
                                                   │   write a Basic Memory,
                                                   ▼   update one index line"
        ┌─────────────────────────────────────┐
        │           your AI agent             │   ← the thinking.
        │   reads the source and playbook,    │     summarizes,
        │   writes the memory, updates index  │     links, catalogs.
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

For a beginner, do **not** open a random folder first. Run `kb new research` from anywhere; it creates `~/kb/research/` and records it in `~/.config/kb/config.yaml`. Use `kb init` only when you want to turn the current directory into a KB.

---

## 3. The hello-world pipeline

```
  kb start (optional) ───▶ kb new ───▶ kb add <path> ───▶ (AI writes Memory + index line) ───▶ status/search
  ───────────────────      ────────    ─────────────      ───────────────────────────────       ─────────────
  print walkthrough        make a KB   copy source into   memory + catalog line                 confirm / ask
  initialize nothing       ~/kb/...    raw/ + playbook    in memories/ + index.md               your notes
```

---

## 4. Toy run — copy/paste and watch

```console
$ npm i -g @tylerjnewman/kb        # one-time install

$ kb start                         # optional: prints help; initializes nothing
First run

KB Home: /Users/you/kb

1. Create your first KB: kb new research
2. Add one raw source: kb add hello.txt
3. Agent step: follow the printed Playbook.
4. Search what the agent wrote: kb search "hello world"
5. Check state: kb status

$ kb new research
Created KB: research
Path: /Users/you/kb/research
Default: research
Next: kb add <file-or-url>

$ echo "Vector search beats keyword search for fuzzy recall." > paper.txt
$ kb add paper.txt
Add playbook
Raw source: raw/paper-0123456789ab.txt   # the 12-character hash varies
Memory target: memories/paper.md
URL behavior: local file copied verbatim into raw/.

Agent half:
1. Read raw/paper-0123456789ab.txt without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. Write memories/paper.md in Basic Memory note format.
4. Include an executive summary of about 150 words or less.
5. Extract observations as "- [category] fact #tag".
6. Extract relations as "- relates_to [[Target]]".
7. Add or update one index.md line: - [[memories/paper.md|Paper]] | category: <category> | summary: <one-line summary>

        |
        v   (your AI writes the Memory and updates index.md)

$ kb status
KB: research
Path: /Users/you/kb/research
Arm: b0 (plain markdown)
Search: plain files
Sources: 1
Memories: 1
Index entries: 1
Health: ok
Advisor:
- No suggestions.

$ kb search "vector search"
```

There is no special inbox where you must drop a file. In this example, `paper.txt` is in the terminal's current directory, so `kb add paper.txt` uses that relative path. You could instead run `kb add ~/Downloads/paper.pdf` or pass any absolute path.

`kb add` leaves the original where it is and copies its contents into the selected KB's `raw/` folder. `/Users/you` represents your actual home directory, and `kb new` prints the real absolute path.

The walkthrough text in the example is all `kb start` returns. The first command that creates anything is `kb new`.

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
