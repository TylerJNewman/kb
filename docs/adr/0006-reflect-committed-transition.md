# ADR 0006: Reflect history is the committed transition

`kb reflect` updates `log.md` and the `lastReflectAt` projection in `kb.yaml`. Two independent file renames cannot form one atomic filesystem operation, so the history record is the authoritative commit point rather than claiming atomicity across both files.

Each committed history entry preserves the greppable `## [date] reflect | <count> memories` prefix and adds its exact UTC instant and transaction identity. The following encoded metadata comment records the changed Memory refs and titles needed to replay the same result. A same-directory atomic replacement commits the history file.

Before that replacement, reflect writes `.kb-reflect-transaction.json` atomically. After the history commit, it updates `kb.yaml` through the existing serialized read-transform-commit, preserving concurrent Engine changes. It then writes the playbook to stdout and removes the transaction receipt as its durable acknowledgement. All reflect transitions and log writers share `.kb-events.lock`; concurrent reflects therefore commit in lock order.

Recovery follows these rules:

1. A transaction absent from history never committed. Recovery removes it and the invocation may calculate a new event from the current marker.
2. A transaction present in history committed. Recovery advances `lastReflectAt` to its exact instant without moving a newer marker backward, then removes the transaction.
3. Recovery of a committed but unacknowledged transaction returns that recorded event instead of beginning another event with the retry's later wall-clock instant. After presenting the recovered playbook, it removes the receipt.
4. Receipt removal is the acknowledgement boundary. A later invocation after acknowledgement is a new reflect, including when no Memories changed, so it advances `lastReflectAt` and the Advisor state normally.
5. No local CLI can atomically combine stdout observation with a durable filesystem acknowledgement. If the process dies after receipt removal but before the caller observes its exit, the event is nevertheless complete; a later invocation is a new reflect. If it dies before receipt removal, retry replays the committed event without another history entry.
6. `log.md` is never inferred from `kb.yaml`. The history record is authoritative and the configuration marker is its recoverable projection.

The test hooks `KB_FAIL_REFLECT_TRANSITION` and `KB_EXIT_REFLECT_TRANSITION` accept phase boundaries `before-prepare`, `after-prepare`, `before-history`, `after-history`, `before-config`, `after-config`, `before-cleanup`, and `after-cleanup`. They exist to prove ordinary-error and process-death recovery; they are not public CLI behavior.
