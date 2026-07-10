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
                                                   │   write a Memory,
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
  kb start (optional) ──▶ kb new ──▶ kb add --in research ──▶ AI follows complete playbook ──▶ receipt ──▶ status/search
  ───────────────────     ────────    ───────────────────     ────────────────────────────      ───────     ─────────────
  print walkthrough       make a KB   stage source + pending  Memory + index + --complete       confirms    confirm / ask
  initialize nothing      ~/kb/...    handoff                  command                            finished    your notes
```

---

## 4. Toy run — copy/paste and watch

```console
$ curl -fsSL https://bun.com/install | bash   # one-time runtime install
$ export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
$ export PATH="$BUN_INSTALL/bin:$PATH"
$ bun install --global @tylerjnewman/kb
$ kb --version
kb 0.1.2
$ git --version                              # required when kb creates a KB
git version 2.x

$ kb start                         # optional: prints help; initializes nothing
First run

KB Home: /Users/you/kb

1. Create your first KB: kb new research
2. Create and stage one source: kb add hello.txt --in research
3. Agent step: give the complete printed Playbook to your AI.
4. After its Completed Add handoff receipt: kb status --in research
5. Search what it wrote: kb search "hello world" --in research

$ kb new research
Created KB: research
Path: /Users/you/kb/research
Default: research
Next: kb add <file-or-url>

$ echo "Vector search beats keyword search for fuzzy recall." > paper.txt
$ kb add paper.txt --in research
Add playbook
Raw source: raw/paper-0123456789ab.txt   # the 12-character hash varies
Memory target: memories/paper.md
URL behavior: local file copied verbatim into raw/.

Agent half:
1. Read raw/paper-0123456789ab.txt without editing it.
2. Check memories/ and index.md for an existing Memory on this subject first.
3. Write memories/paper.md in kb's structured markdown Memory format.
4. Include an executive summary of about 150 words or less.
5. Extract observations as "- [category] fact #tag".
6. Extract relations as "- relates_to [[Target]]".
7. Add or update one index.md line: - [[memories/paper.md|Paper]] | category: <category> | summary: <one-line summary>
8. When the Memory exists and its index.md line is present, run:
   kb add --complete raw/paper-0123456789ab.txt memories/paper.md --in research

If this output is lost, run:
  kb add --resume raw/paper-0123456789ab.txt --in research

        |
        v   (your AI writes the Memory, updates index.md, and runs step 8)

Completed Add handoff: raw/paper-0123456789ab.txt -> memories/paper.md

$ kb status --in research
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

$ kb search "vector search" --in research
```

There is no special inbox where you must drop a file. In this example, `paper.txt` is in the terminal's current directory, so `kb add paper.txt` uses that relative path. You could instead run `kb add ~/Downloads/paper.pdf` or pass any absolute path.

`kb add` leaves the original where it is and copies its contents into the selected KB's `raw/` folder. The explicit `--in research` keeps the tutorial from targeting another KB when your terminal is inside one. `/Users/you` represents your actual home directory, and `kb new` prints the real absolute path.

The AI must follow the complete playbook, including its generated `kb add --complete` command. Before that receipt, `kb status` may correctly report `Health: unfinished work`.

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
                              kb search now uses the optional local search
                              engine, Basic Memory, over the same markdown
```

Basic Memory is a search helper that `kb` installs and drives for you; beginners do not need to install or learn it. You upgrade only when you feel the pain — and `kb` tells you *why* at that moment. The Advisor suggests; it never acts.

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
