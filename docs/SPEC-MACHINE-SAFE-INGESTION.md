# Machine-Safe Ingestion and Schema Tooling

**Status:** Implemented on `codex/machine-safe-ingestion`

**Primary use case:** continuous ingestion of Screenpipe Markdown artifacts into a local KB

**Decision:** make the existing `kb add` handoff safe for machine producers first. Add read-only schema wrappers only after typed Memories exist.

## Review provenance

This specification is based on Oracle session `spec-kb-schema-ingestion-2`, which produced a substantive architecture response after reviewing the KB and schema-engine contracts. Oracle's browser captured direct UI evidence that Pro was selected, but its final automatic model-verification field was `verified=no`. A narrower verification session, `verify-kb-ingest-spec`, then produced only a 12-character captured answer and was rejected by Oracle. Neither remote conversation was recoverable from the local Oracle Chrome tabs.

Treat the recommendation as an **advisory Oracle proposal**, not a clean verified Oracle verdict. Resolve the open questions below before implementation.

## Problem

A Screenpipe pipe can safely produce files, but a flat artifact directory cannot determine:

- whether an artifact should create, update, split, or skip a Memory;
- whether two artifacts are semantically duplicates;
- which domain type or schema is correct;
- whether a statistically inferred pattern is meaningful;
- whether an artifact contains durable knowledge at all.

Pointing a pipe at a KB may automate physical ingestion. It must not pretend to automate semantic filing.

## Product boundary

### KB may determine

- the target KB;
- whether the input is readable and supported;
- the exact bytes and SHA-256 hash;
- immutable raw storage;
- producer identity and capture time;
- replay versus producer-ID collision;
- durable pending and completed receipts;
- whether completed Memory refs exist, are cataloged, and cite the raw source;
- invocation and normalization of the optional engine.

### The agent must determine

- whether a derivative is warranted;
- whether to create, update, split, merge, or decline a Memory;
- title, type, category, summary, observations, tags, and relations;
- semantic duplication, contradictions, and staleness;
- whether an inferred schema is useful;
- when validation should move from warning to strict.

KB remains the only public interface. The underlying engine remains an internal adapter and may still be identified accurately in architecture and license documentation.

### Capability and credential boundary

- Producers and connectors own OAuth tokens and provider credentials; KB accepts only the resulting artifact, source identity, and capture time.
- Read-only and provider-scoped credentials are the default; use per-KB and single-purpose credentials where the provider or external runner supports them. Sending, deleting, or broad remote writes require explicit opt-in outside KB.
- Secrets must not be written anywhere in a KB, including raw artifacts, configuration, operational receipts, logs, Memory frontmatter, or derived notes. Producers must redact or withhold secret-bearing data before ingestion.
- Basic Memory subprocesses receive an explicit operational environment allowlist rather than the invoking agent's ambient credentials.
- A future scheduler must call the public noninteractive commands below and preserve the same locks, handoffs, validation, and receipts.
- Raw immutability means no-overwrite storage plus hash-based tamper detection. It does not claim filesystem isolation from another same-user process.

## Delivery order

1. **Ticket 1: Machine-safe Add handoff v2.**
2. **Ticket 2: Engine runner repair and read-only schema wrappers.**
3. **Ticket 3: Optional schema-review handoff and index freshness.**

Do not combine Tickets 1 and 2. Schema inference only helps after agents have created a consistently typed corpus; it does not solve first-contact ingestion, provenance, or replay safety.

# Ticket 1: Machine-safe Add handoff v2

## User stories

1. A pipe can stage one artifact and receive one stable JSON receipt.
2. Replaying the same producer event does not duplicate raw data, logs, or pending work.
3. Reusing a producer ID for different bytes fails closed.
4. An agent can recover the same playbook from a handoff ID.
5. An agent may complete a handoff with one or more affected Memories or with a recorded raw-only outcome.
6. Every completed derivative records lineage to the immutable raw source.
7. Current human-oriented Add commands remain compatible during migration.

## Command contract

### Stage one artifact

```text
kb add <file-or-url>
  [--source <producer> --source-id <id>]
  [--captured-at <RFC3339>]
  [--json]
  [--in <kb-name>]
```

Rules:

- `--source` and `--source-id` must appear together.
- `--source` must match `[A-Za-z0-9][A-Za-z0-9._-]*`.
- `--source-id` must be non-empty, single-line UTF-8.
- `--captured-at` must be RFC3339 and is normalized to UTC.
- Manual invocations may omit producer identity and use content identity.
- One invocation accepts exactly one file or URL.
- KB does not walk directories, expand globs, or watch folders.

### Resume

```text
kb add --resume <handoff-id> [--json] [--in <kb-name>]
```

For one compatibility release, a raw ref may be accepted if it identifies exactly one legacy pending handoff.

### Complete with derivatives

```text
kb add --complete <handoff-id>
  --memory <memories/ref.md>
  [--memory <memories/another.md> ...]
  [--json]
  [--in <kb-name>]
```

### Complete raw-only

```text
kb add --complete <handoff-id>
  --no-memory
  --reason <single-line-reason>
  [--json]
  [--in <kb-name>]
```

`--memory` and `--no-memory` are mutually exclusive. A raw-only reason is required and limited to 500 characters.

The existing positional form remains temporarily supported:

```text
kb add --complete <raw-ref> <memory-ref>
```

## Identity and replay

With producer identity:

```text
identity = SHA256("kb-add-v1\0" + source + "\0" + sourceId)
```

Without producer identity:

```text
identity = SHA256("kb-add-v1\0sha256:" + contentSha256)
```

The public ID is:

```text
add-<first-24-lowercase-hex-characters-of-identity>
```

The complete identity hash is retained internally.

Required behavior:

- Same producer identity and same bytes returns the existing pending or completed receipt.
- Same producer identity and different bytes exits with a data-contract failure and performs no mutation.
- Same bytes with different producer identities may create distinct ingress events.
- Equivalent repeated completion returns success with `replayed: true`.
- A conflicting repeated completion fails and preserves the original outcome.
- Memory refs are normalized, deduplicated, and sorted before outcome comparison.
- Concurrent identical calls converge on one ingress event.

A producer must assign a new source ID to a revision. KB does not reinterpret mutable producer IDs.

## Raw storage

Keep the existing content-addressed convention:

```text
raw/<slugified-input-stem>-<first-12-content-sha256><extension>
```

The handoff stores the complete SHA-256. Resume and completion recompute it; a mismatch fails as `RAW_TAMPERED`. Existing raw bytes are never overwritten, and the source outside the KB is never changed.

## Operational state

```text
.kb/pending/add/<handoff-id>.json
.kb/completed/add/<handoff-id>.json
```

Pending record shape:

```json
{
  "schemaVersion": 2,
  "kind": "add",
  "handoffId": "add-a1b2c3d4e5f60718293a4b5c",
  "state": "pending",
  "rawRef": "raw/daily-abc123.md",
  "rawSha256": "<64 lowercase hex>",
  "suggestedMemoryRef": "memories/daily.md",
  "source": {
    "name": "screenpipe",
    "id": "artifact-123",
    "capturedAt": "2026-07-10T13:00:00.000Z"
  },
  "createdAt": "2026-07-10T14:32:19.000Z"
}
```

These are operational receipts, not a second content source. Raw files, Memories, schema notes, `index.md`, and `log.md` remain authoritative.

Requirements:

- writes are atomic;
- state is protected by the existing bounded locking model;
- legacy pending Add records remain readable;
- recovery must not alter raw bytes;
- malformed state fails closed and reports its exact path.

## Provenance and lineage

Each new ingress event appends a structured log entry containing:

- handoff ID;
- raw ref;
- complete content hash;
- producer and source ID, when provided;
- captured and ingested timestamps.

Replay must not append the event twice.

Each derivative completed from a handoff must contain:

```yaml
source_refs:
  - raw/daily-abc123.md
```

When an existing Memory is updated, the agent appends the new raw ref without deleting prior refs.

Completion verifies that every declared Memory:

- resolves under `memories/`;
- exists;
- is not an untouched TODO draft;
- contains the current raw ref in `source_refs`;
- appears exactly once in `index.md`.

KB verifies this semantic work but does not inject or rewrite the Memory itself.

The completion receipt records either:

- `outcome: "derived"` and the normalized Memory refs; or
- `outcome: "raw-only"` and the reason.

`index.md` continues to catalog Memories, not ingress events.

## JSON contract

`--json` emits exactly one compact JSON object followed by a newline.

Success goes to stdout:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "add",
  "kb": {
    "name": "work",
    "path": "/Users/example/kb/work"
  },
  "result": {
    "state": "pending",
    "replayed": false,
    "handoffId": "add-a1b2c3d4e5f60718293a4b5c",
    "raw": {
      "ref": "raw/daily-abc123.md",
      "sha256": "<64 lowercase hex>",
      "created": true
    },
    "provenance": {
      "source": "screenpipe",
      "sourceId": "artifact-123",
      "capturedAt": "2026-07-10T13:00:00.000Z",
      "ingestedAt": "2026-07-10T14:32:19.000Z"
    },
    "suggestedMemoryRef": "memories/daily.md",
    "requiresAgent": true,
    "resumeCommand": "kb add --resume add-a1b2c3d4e5f60718293a4b5c --in work",
    "completeCommandTemplate": "kb add --complete add-a1b2c3d4e5f60718293a4b5c --memory <memories/ref.md> --in work",
    "playbook": "Add playbook\n..."
  }
}
```

Controlled operational failures use the same envelope on stderr and leave stdout empty:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "add",
  "error": {
    "code": "SOURCE_ID_CONFLICT",
    "message": "source screenpipe/artifact-123 was previously recorded with different bytes"
  }
}
```

Consumers must ignore unknown fields for forward compatibility.

## Exit behavior

- `0`: success or idempotent replay.
- `64`: invalid command use, target, source, ref, or timestamp.
- `65`: malformed KB state, source-ID collision, raw tampering, or invalid/conflicting completion.
- `69`: optional engine failure after a durable completion; the receipt must state that the handoff completed and index refresh remains pending.
- `130`: interrupted by `SIGINT`.
- `143`: terminated by `SIGTERM`.

Text-mode errors retain the existing `kb: <message>\n` stderr convention with empty stdout.

## Playbook contract

The resumed and initial playbooks must tell the agent to:

1. read the exact raw ref without modifying it;
2. inspect `index.md`, existing Memories, and search results first;
3. treat the suggested Memory ref as a filename hint, not a semantic route;
4. choose whether to update, create, split, or close raw-only;
5. use a meaningful domain `type` only when the artifact and conventions support it;
6. avoid inventing a schema or folder hierarchy from one artifact;
7. add the raw ref to each affected Memory's `source_refs`;
8. add or update exactly one catalog entry per affected Memory;
9. run the exact completion command.

## Screenpipe flow

```bash
kb add "$ARTIFACT_PATH" \
  --source screenpipe \
  --source-id "$ARTIFACT_ID" \
  --captured-at "$CAPTURED_AT" \
  --in work \
  --json
```

The pipe stops after receiving the durable handoff receipt. It does not choose a type, create a schema, update `index.md`, invoke the engine, or wait for an agent.

An agent later resumes the handoff and completes it with derivatives or a raw-only reason.

The same producer seam applies to other sources. For example, a read-only calendar exporter owns Google authentication and emits one local artifact:

```bash
kb add "$CALENDAR_EXPORT" \
  --source google-calendar \
  --source-id "$EXPORT_EVENT_ID" \
  --captured-at "$CAPTURED_AT" \
  --in work \
  --json
```

KB does not receive the OAuth token, call Google APIs, or gain send/delete access.

## Recovery behavior

- Crash after raw copy: replay validates the raw hash and reconstructs missing pending state.
- Crash after log append: replay detects the handoff ID and does not duplicate the event.
- Invalid pending metadata: fail closed and surface the exact file.
- Missing or unindexed Memory: keep the handoff pending.
- Missing `source_refs`: keep the handoff pending.
- Equivalent completed replay: return the receipt.
- Conflicting completed replay: fail without changing the recorded outcome.
- B1 reindex failure after completion: preserve the completed Markdown transaction and mark the rebuildable index dirty.

## Invariants

1. Raw bytes are immutable.
2. A producer event never directly creates an authoritative Memory.
3. A suggested path is never presented as a semantic decision.
4. `kb add` works with no engine installed.
5. Every derived completion cites its raw source.
6. Raw-only completion preserves the source and reason.
7. `index.md` catalogs Memories and schema notes, not raw artifacts.
8. Engine databases and `.kb` receipts are rebuildable operational state.
9. No public command accepts an engine project or cloud-routing flag.
10. No command claims semantic duplicate, contradiction, freshness, or ontology correctness.
11. Mutations are atomic and lock-protected.
12. Existing human Add flows remain compatible during migration.

## Acceptance tests at the public CLI seam

- A new producer event returns the exact JSON envelope and creates one raw source, one pending record, and one ingress log event.
- The original source remains byte-for-byte unchanged.
- Identical replay returns the same handoff and does not append another event.
- Same producer ID with different bytes exits `65` with no mutation.
- Same bytes under different producer IDs create distinct ingress events.
- Concurrent identical calls converge on one creator and replay receipts.
- Resume reproduces the same provenance, raw ref, suggestion, and playbook without mutation.
- Completion supports one and repeated `--memory` flags.
- Completion fails when `source_refs` is missing.
- Completion fails when an index ref is absent or duplicated.
- Raw-only completion retains the raw source and reason.
- Equivalent completion replay succeeds; conflicting completion fails.
- `kb status` lists the exact handoff ID and resume command.
- Text mode contains no ANSI.
- JSON mode writes exactly one object on the documented channel.
- Legacy pending records and positional completion remain supported.

# Ticket 2: Engine runner and read-only schema wrappers

Implement only after Ticket 1 produces deliberately typed Memories.

Public commands:

```text
kb schema infer <type> [--threshold <0..1>] [--json] [--in <kb-name>]
kb schema validate [--type <type> | --memory <ref> | --all] [--strict] [--json] [--in <kb-name>]
kb schema diff <type> [--json] [--in <kb-name>]
```

Requirements:

- The commands are read-only and never install or rewrite a schema.
- B0 exits `69` and points only to `kb enable search`.
- KB never exposes engine project names, direct engine commands, or cloud-routing flags.
- The engine is reindexed before schema operations.
- Inference prints a proposal and requires agent review.
- Warning validation exits `0`; CLI `--strict` turns any warning or error into exit `65` without rewriting the schema.
- Diff exits `0` with `hasDrift: true|false`; missing or ambiguous schema notes fail closed.
- Schema notes are ordinary Markdown and remain the sole schema source of truth.
- Until Memory traversal is recursive, use a flat schema-note convention such as `memories/schema-<type>.md`.
- Do not pass an upstream `--save` flag or promise unsupported schema behavior.
- Normalize engine JSON and treat nonzero exits, malformed JSON, top-level errors, or missing required fields as exit `69`.

Before implementation, repair the subprocess runner so a successful `uvx` availability check is followed by the same persistent command prefix rather than an unrelated bare executable.

# Ticket 3: Schema review and index freshness

Possible follow-on work:

- `kb schema infer <type> --draft` creates a warning-mode schema-note draft only after explicit request;
- a schema-review playbook owns agent review and completion;
- an engine-dirty marker records a durable Markdown completion whose rebuildable index refresh failed;
- later engine-backed commands retry refresh.

Never mark an inferred schema strict automatically.

## Explicitly deferred

- recursive or directory ingestion;
- a filesystem watcher, daemon, scheduler, or cron ownership;
- automatic semantic routing;
- automatic schema adoption or mutation;
- a Screenpipe connector framework;
- bulk migration of the existing thousands;
- a second schema registry or database owned by KB;
- rewriting raw artifacts to add metadata;
- cloud engine routing;
- semantic deduplication, contradiction detection, or truth guarantees.

For the legacy corpus, begin with a bounded representative sample of roughly 20–50 artifacts. Establish types and agent throughput before specifying a dry-run manifest and checkpointed bulk migration.

## Open questions

1. Screenpipe producer IDs and timestamps are accepted when available; content identity remains the safe manual fallback, so KB does not depend on a Screenpipe-specific contract.
2. Identical content under different producer IDs is recorded as distinct ingress events because provenance, not storage deduplication, defines the event.
3. `source_refs` is the canonical lineage key. Compatibility tests pin the Basic Memory note contract and the engine preserves custom frontmatter.
4. Raw-only outcomes are permanent receipts under v2. Reopening would conflict with the recorded completion outcome and is deferred.
5. The supported Engine version is exactly Basic Memory `0.22.1`. Ambient `bm` must report that version; the fallback is pinned to `uvx --from basic-memory==0.22.1 bm`.
6. Schema commands remain unavailable until `kb enable search`; engineless validation is deferred.
7. A future bulk-migration manifest must first be informed by a bounded 20–50 artifact sample and measured human/agent review throughput.
