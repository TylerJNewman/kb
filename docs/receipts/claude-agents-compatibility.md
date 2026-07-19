# Claude Code instruction compatibility receipt

Date: 2026-07-18

Purpose: verify that a generated KB keeps `AGENTS.md` canonical while Claude Code loads it through a one-line `CLAUDE.md` compatibility import.

Tested source checkout: `19bf25433878a3411b49e96d9a4769169afda6e0` plus the local scaffold implementation under review.

Generated file hashes:

```text
25f6bbedfeb18dcd54770fcbc057dddde3275fbcf6b987c0727fc1497e3b10dd  AGENTS.md
336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49  CLAUDE.md
```

Procedure:

1. Created a fresh temporary project and isolated `XDG_CONFIG_HOME`.
2. Ran `/Users/tyler/code/gocer/bin/kb init --arm b0` from the empty project.
3. Verified the project contained `AGENTS.md` and a `CLAUDE.md` whose complete contents were `@AGENTS.md` followed by a newline.
4. Verified `/`, `/tmp`, and the temporary project's parent contained no `AGENTS.md` or `CLAUDE.md`. The user-level `~/.claude/CLAUDE.md` existed but did not contain the unique test heading.
5. Ran Claude Code 2.1.214 with no built-in tools, so it could not discover or read project files after startup:

   ```sh
   claude --debug-file "$receipt_root/claude-no-tools-debug.log" \
     -p --model haiku --no-session-persistence --disable-slash-commands \
     --tools='' \
     'Return only the exact H1 heading from the imported project instructions, including the leading hash.'
   ```

Observed response:

```text
# KB Agent Instructions
```

Startup/debug evidence: the log records startup setup, command/agent loading, built-in tool search disabled by the empty tool set, and the subsequent API request. Because the model had no tools and the unique heading was absent from the user-level instruction file, the response demonstrates that Claude loaded the project `CLAUDE.md` import into startup context and thereby received canonical `AGENTS.md` content.

Conclusion: keep `AGENTS.md` authoritative and scaffold exactly one compatibility line in `CLAUDE.md`: `@AGENTS.md`.
