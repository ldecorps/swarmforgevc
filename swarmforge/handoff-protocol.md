# Handoff Daemon Proposal

## Goal

Replace direct agent access to the tmux socket with a daemon-owned file transport.
Agents should not send tmux commands, manage socket permissions, or maintain a
separate logbook. Agents should create small, validated handoff requests; the
daemon should deliver them through durable inbox files and send only wake-up
notifications through tmux.

## Summary

The swarm startup script starts a handoff daemon alongside the tmux session. The
daemon has direct access to the tmux socket and watches each agent worktree for
outbound handoff files. When an outbound handoff appears, the daemon validates
delivery targets, copies the handoff into each recipient inbox, sends each
recipient a generic tmux wake-up message, and moves the original outbound file
to `sent` or `failed`.

The recipient inbox is the task queue. Agents use helper scripts to accept and
complete inbox items. Queue state is represented by file location, and audit
timestamps are stored in the handoff file headers.

## Directory Layout

Each agent worktree owns this structure:

```text
.swarmforge/handoffs/
  outbox/
    tmp/
  sent/
  failed/
  inbox/
    new/
    in_process/
    completed/
    abandoned/
```

The daemon consumes `outbox/`. Agents consume `inbox/new/` through helper
scripts. The `sent`, `failed`, `in_process`, and `completed` directories provide
the audit trail and restart state.

**Master-resident roles get their own mailbox subdirectory.** Any role whose
`swarmforge.conf` window line uses worktree name `master` (typically
`coordinator` and `specifier`) shares one physical checkout with every other
master-resident role, so it does not get the physical separation a dedicated
`.worktrees/<role>` checkout provides. For those roles only, the layout above
lives one level deeper, under `.swarmforge/handoffs/<role>/` — e.g.
`.swarmforge/handoffs/coordinator/inbox/new/`. Every role with its own
dedicated worktree keeps the flat layout shown above unchanged. All mailbox
paths are resolved through one shared function (`mailbox-dir`/
`mailbox-base-dir` in `handoff_lib.bb`, callable from shell via
`mailbox_dir.bb`; mirrored in the extension's `swarmState.ts`) — no script
constructs a mailbox path by hand.

## Role Receive Mode

`swarmforge.conf` window lines may include an optional receive mode:

```text
window <role> <agent> <worktree> [task|batch]
```

When omitted, receive mode defaults to `task`. The launcher writes the
normalized mode into `.swarmforge/roles.tsv`, and agent-facing receive helpers
read that runtime file rather than reparsing `swarmforge.conf`.

Use `batch` for roles that should consume equal-priority queued handoffs as a
single unit, such as six-pack `hardender` and four-pack `architect`.

## Filename Format

Handoff filenames should sort by priority, timestamp, and sequence:

```text
<priority>_<timestamp>_<sequence>_from_<sender>_to_<recipient-list>.handoff
```

Example:

```text
00_20260615T140531Z_000042_from_architect_to_coder_cleaner_QA.handoff
```

Rules:

- Lower priority numbers are processed first.
- `priority` is two digits from `00` through `99`.
- `timestamp` is UTC in `YYYYMMDDTHHMMSSZ` format.
- `sequence` is a per-worktree counter that breaks ties for handoffs created
  in the same second.
- Recipients remain in the filename for audit.
- Structural filename fields are separated with underscores.
- Scripts parse authoritative metadata from file headers, not from the filename.
- Startup validation should reject role names containing underscores so recipient
  lists remain readable in audit filenames.

## Handoff File Format

Handoff files use a simple header block, a blank line, and a generated body.
Scripts may update headers, but the body is opaque after creation.

The `id` header is globally audit-oriented and should include timestamp,
sequence, and sender:

```text
<timestamp>_<sequence>_from_<sender>
```

Including the sender prevents otherwise identical timestamp/sequence pairs from
colliding across worktrees. The sequence update must be serialized inside each
worktree so concurrent handoff creation cannot reuse the same sequence.

Example delivered handoff:

```text
id: 20260615T140531Z_000042_from_coder
from: coder
to: cleaner
recipient: cleaner
priority: 50
type: git_handoff
role: coder
task: task-1-cave-setup
commit: a1b2c3d9
created_at: 2026-06-15T14:05:31Z
enqueued_at: 2026-06-15T14:05:32Z

merge_and_process coder a1b2c3d9
```

For broadcast handoffs, `to` preserves the full recipient list and `recipient`
identifies the specific recipient copy.

## Message Types

Agents may request only four message types.

### Generated body preamble (BL-519)

`swarm_handoff.sh` prepends a short reminder only when **every** recipient's
`roles.tsv` agent column is **not** `claude` (today: aider, grok, and other
agents that still bootstrap via tmux file injection):

```text
Re-read your role and constitution.

```

For **Claude** recipients — the default for pipeline roles, including the
mono-router resident — there is **no** preamble. Constitution, PIPELINE, and
role are already inlined into `--append-system-prompt-file` at launch and on
every `rotate_to_role.sh` / respawn (BL-519). The generated body is only the
actionable payload (`merge_and_process …`, the note text, or the rule-proposal
block). A mixed broadcast (one Claude + one aider recipient) keeps the legacy
preamble for all copies.

The examples below show the Claude (no-preamble) form unless noted.

### `awake`

Used for liveness and simple wake-up messages.

Draft:

```text
type: awake
to: two
priority: 50
```

Generated body:

```text
awake
```

The `awake` message does not include the constitution and role reminder.

### `git_handoff`

Used when a role has committed work for another role to merge and process.

Draft:

```text
type: git_handoff
to: cleaner
priority: 50
task: task-1-cave-setup
commit: a1b2c3d9e8
```

Generated body:

```text
merge_and_process coder a1b2c3d9
```

The script validates the task name and canonicalizes the commit abbreviation
before queuing the handoff. The task name is a short, stable human-readable
name that follows the work through downstream git handoffs for the same task.

A role must not send or forward a `git_handoff` when the received commit
produces no functional project change. This exemption is narrow and covers
only meta churn: manifest-only, audit-only, generated metadata,
formatting-only, and other non-functional changes. It does NOT cover a real
deliverable that satisfies its ticket's acceptance criteria — docs-only and
config-only parcels are functional changes and must keep moving down the
chain like any other parcel, even when the current stage has nothing of its
own to add to them (nothing to mutation-test, nothing to restructure,
nothing to document further). "Nothing of MY OWN to add" is not the same
test as "no functional project change"; a stage with nothing to add still
forwards the received commit to the next stage. (BL-075: a hardener batch
silently dropped a docs-only parcel this way — completed its own step but
never forwarded, leaving the ticket holder-less with nothing in
`inbox/in_process` anywhere, so BL-067's stuck-detection could not see the
stall either. Batch roles: apply this per-item — every parcel in the batch
gets its own forward decision.)

### `note`

Used for one short freeform message.

Agents should not send `note` handoffs unless the user, role prompt, or
constitution explicitly directs them to send one. When blocked by ambiguity,
contradiction, or test/specification conflict, an agent should stop and ask for
clarification instead of sending a `note` handoff unless one of those explicit
authorities directed that note.

Draft:

```text
type: note
to: architect,QA
priority: 70
message: Waiting on QA result before merging cleanup branch.
```

Generated body:

```text
Waiting on QA result before merging cleanup branch.
```

The `message` value must be a single line no longer than 80 characters.

### QA approval and merge-up (full pack)

After the final QA gate passes on a parcel:

1. **QA → worktree roles:** `note` broadcast to
   `coder,cleaner,architect,hardender,documenter` with priority `00`, instructing
   each recipient to merge its own worktree branch up to QA's approved commit
   (not to `main`). Example message:
   `BL-042 QA-approved a1b2c3d4e5 — merge your branch up to QA's`.
2. **QA lands `main`:** QA's approved commit is the verified, integrated result,
   so QA merges/fast-forwards `main` to it and pushes origin (same session; never
   force-push), and closes the GitHub issue for a `GH-`-seeded ticket
   (`issue_done.sh`). QA is the integration point (BL-247).
3. **QA → coordinator:** `git_handoff` or `note` with priority `00`, the
   QA-approved commit (10-char abbrev), and stable task/backlog id, so the
   coordinator does the backlog bookkeeping.
4. **Worktree roles:** on receiving the merge-up `note`, run
   `git merge <qa-commit>` (or `--no-ff`) in your worktree, resolve conflicts
   if any, then `done_with_current.sh`. Do not forward the parcel — QA already
   closed the pipeline chain.
5. **Coordinator:** on receiving QA approval, move the ticket from
   `backlog/active/` to `backlog/done/` and promote the next paused item if below
   `active_backlog_max_depth`. The coordinator runs NO git merge or push (BL-247).

The **specifier** is excluded from the merge-up broadcast and does not perform
integration merges — it specifies only.

See `swarmforge/PIPELINE.md` and `swarmforge/roles/QA.prompt` /
`swarmforge/roles/coordinator.prompt` for role-specific wording.

### `rule_proposal`

Used when an agent (coordinator, cleaner, coder, or any other role) observes
a pattern that should be written into the constitution or a role prompt, but
has no other structured way to surface it (BL-035). The specifier is the
sole writer of constitution/prompt files: on receiving a `rule_proposal` it
reviews the proposal and either accepts it (appends the rule to the
relevant file and commits) or rejects it (sends a `note` back to the
proposer with the reason). That review is prompt/agent behavior, not
scriptable machinery.

Draft:

```text
type: rule_proposal
to: specifier
priority: 50
scope: constitution
body: Batch roles must forward every parcel in a batch, not just their own step.
rationale: BL-075 — a hardener batch completed its step but never forwarded a docs-only parcel.
```

Generated body:

```text
Rule proposal (constitution) from cleaner: Batch roles must forward every parcel in a batch, not just their own step.
Rationale: BL-075 — a hardener batch completed its step but never forwarded a docs-only parcel.
```

Fields:

- `scope` must be one of `constitution`, `engineering`, `project`, or
  `role:<rolename>` (proposing a change to one specific role's prompt).
- `body` is the proposed rule text: one crisp sentence, at most 200
  characters.
- `rationale` is why the rule was observed as necessary, at most 200
  characters.

Every delivered `rule_proposal` is appended as one JSON line to
`.swarmforge/rule_proposals/YYYY-MM.jsonl` (scope, body, rationale,
proposer, and delivery timestamp) for durable audit, regardless of the
specifier's eventual accept/reject decision.

## `swarm_handoff.sh`

`swarm_handoff.sh` should be the strict outbound protocol gate.

Proposed usage:

```sh
swarm_handoff.sh ./tmp/handoff.txt
```

Responsibilities:

- Read a draft handoff file.
- Validate all fields and emit detailed repair guidance for malformed drafts.
- Reject reserved headers supplied by agents.
- Infer `from` from the current agent/worktree.
- Validate `to` against configured agents.
- Generate `id`, `created_at`, filename timestamp, and sequence.
- Serialize sequence updates with an atomic lock so concurrent handoff creation
  in one worktree cannot reuse the same sequence.
- Validate `priority` as `00` through `99`.
- Validate `type` as `awake`, `git_handoff`, `note`, or `rule_proposal`.
- Validate `git_handoff` commits as real, unambiguous commits.
- Canonicalize valid commit abbreviations.
- Generate `role` from the current sender role for `git_handoff`.
- Preserve `task` from the draft for `git_handoff`.
- Generate the canonical body.
- Atomically install the completed file into `outbox/`.

Atomic outbound write sequence:

1. Write the generated handoff to `outbox/tmp/<filename>.tmp`.
2. Flush and close the file.
3. Rename it to `outbox/<filename>.handoff`.

The daemon should ignore `outbox/tmp/` and process only final `.handoff` files
that appear directly under `outbox/`.

### Durable install and corrupt-handoff quarantine (BL-365)

A plain `write` + `rename` is atomic in *ordering* only, not *durability*: the
rename can land on disk while the file's own contents have not yet been
flushed, so a crash or restart in that window can leave a correctly-named,
zero-byte "atomically installed" handoff. This happened once in production
(a coder→cleaner `git_handoff` was dispatched as a contentless task,
silently losing the parcel — the stuck/chase sweeps never fired because the
mail moved perfectly).

The install path is now `write` → `fsync` → `rename` (`atomic-write!` in
`handoff_lib.bb`), used by both `swarm_handoff.bb`'s outbox install and
`handoffd.bb`'s recipient-inbox copy.

On top of the durability fix, every hop that can observe a corrupt handoff
file (empty, missing a required envelope header, or headers with no body —
`corrupt-handoff?` in `handoff_lib.bb`) now refuses to pass it on as work:

- `swarm_handoff.bb` re-reads what actually landed on disk after installing
  and deletes it if corrupt, so a failed write never leaves a file in
  `outbox/` for anything downstream to pick up.
- `handoffd.bb`'s `deliver!` checks for a corrupt outbox file before parsing
  recipients, and if corrupt routes it to the existing `fail!` path — moved
  to `failed/` with a diagnostic `.error` stub — instead of copying it into
  a recipient's inbox. This is the same "move malformed or undeliverable
  files to `failed/`" behavior the protocol already asked for above; the
  corrupt-handoff check just makes it actually catch a zero-byte file.
- `ready_for_next_task.bb` / `ready_for_next_batch.bb` (via the shared
  `resolve-dequeueable-candidates` in `handoff_lib.bb`) quarantine a corrupt
  `inbox/new/` candidate before it can be promoted into `in_process/`,
  falling through to the next genuinely-dequeueable file. If every queued
  candidate is corrupt, the result is a clean `NO_TASK`/empty batch rather
  than a promoted contentless task. This quarantine reuses the existing
  dead-letter mechanism rather than inventing a new one: the corrupt file is
  renamed in place to the same `<name>.handoff.dead` suffix
  `chase_sweep_lib.bb` already uses for stuck mail, so it is picked up by
  the same `notify-dead-letters.js` sweep that already alerts a human over
  Telegram for any `*.handoff.dead` file — a quarantined parcel is surfaced,
  never just silently moved aside.

This is a cheap structural check — "does this parse into a real handoff
envelope at all?" — not the semantic re-validation of header values the
protocol deliberately declines to repeat in the daemon; that stays the
sender's job.

### Unresolvable-commit quarantine at dequeue (BL-610)

A `git_handoff` is validated at SEND time to ensure the commit exists and is
unambiguous (see Commit Validation). However, in a multi-worktree repository
with shared object storage and frequent resets, a commit that exists at send
time can become unreachable by the time a role dequeues the parcel — an edge
case, but one that has occurred in production (BL-610 trace: a commit passed
send-time validation and then vanished from the object store within 52 minutes
of delivery, leaving a role with structurally unprocessable work).

Send-time validation prevents most failures, but **dequeue-time re-check**
provides defense in depth: `ready_for_next_task.bb` / `ready_for_next_batch.bb`
verify the commit still exists before promoting a `git_handoff` candidate into
`in_process/`. This check is **scoped to `git_handoff` only** — `note` and
`awake` parcels carry no commit header and incur no git lookup.

If a commit is unresolvable at dequeue:

- The candidate is **quarantined** to `<name>.handoff.dead` (same dead-letter
  path as `corrupt-handoff?`), renaming it in place.
- A diagnostic is printed: `QUARANTINED unresolvable-commit: <task-id> sent by
  <role> with commit <abbrev>, sent <created_at>, dequeued <dequeued_at>`.
- The send→dequeue time delta is captured in the record for investigating why
  a valid commit became unreachable.
- The dead-letter file is picked up by the same `notify-dead-letters.js` Telegram
  alert sweep as any other quarantined parcel.
- A role dequeuing a queue containing only unresolvable commits receives
  `NO_TASK` / empty batch result, not a promoted contentless task.

The check remains **defensive only**: it does not attempt to diagnose WHY a
commit disappeared (reset, gc, stash loss, or other shared-storage anomaly).
A human operator sees the quarantined parcel, the captured timing evidence, and
the task/sending-role context needed to investigate.


Reserved headers:

```text
id
from
role
recipient
created_at
enqueued_at
dequeued_at
completed_at
```

Validation errors should be explicit enough for an agent to repair the draft.

Example error:

```text
HANDOFF INVALID: ./tmp/handoff.txt

Errors:
- Line 3: `priority` must be two digits from 00 to 99; got `urgent`.
- Header `completed_at` is reserved and must not be written by agents.
- message: commit `a1b2c3` is ambiguous; use at least 9 characters.

Expected git_handoff format:

type: git_handoff
to: cleaner
priority: 50
task: <short-stable-task-name>
commit: <commit-abbrev>
```

## Commit Validation

For `git_handoff`, `swarm_handoff.sh` should validate the commit abbreviation
with Git.

Rules:

- The commit abbreviation must be hexadecimal.
- It must be exactly 10 characters.
- It must resolve to exactly one object.
- The resolved object must be a commit.
- The script should write a canonical abbreviation into the queued handoff.

This prevents agents from sending corrupted or ambiguous SHA abbreviations.

## QA-Edge Durability Gate (BL-531)

When `swarm_handoff.sh` sends a `git_handoff` to QA, it runs a durability gate
to ensure the parcel satisfies two machine-checkable criteria before allowing
the send. This gate sits at the final quality chokepoint where parcels are most
expensive to bounce and where the work is complete by contract. A refusal
prevents the parcel from reaching QA, so the author can remedy the issue
immediately (merge a dropped commit or land a required wiring) and re-send.

### Gate Scope

The gate is **armed only** when:
- The handoff `type` is `git_handoff` **and**
- QA is a recipient (in the comma-separated `to:` list — arming is membership,
  not equality, so `to: QA,documenter` arms the gate).

Other handoff types and non-QA forwards skip this gate entirely. A `note` to QA
or a `git_handoff` to cleaner, architect, or any other role does not trigger
the gate.

### Check A — Dropped Commit Ancestry

A ticket may declare commits on an agent's worktree branch that have never been
merged into the parcel's lineage. This surfaces as a work defect: the coder
fixed an issue, committed it on `swarmforge-coder`, and never forwarded it —
cleaner, architect, hardender, and documenter all continued from the broken
ancestor, so the handoff to QA proves the fix was dropped.

The gate detects such stranded commits by examining every branch whose
`.worktrees/<role>` path is recorded in `.swarmforge/roles.tsv`:

1. Find all commits on each role branch that:
   - Name the ticket ID in their message (whole-token match: `BL-49` does NOT
     match `BL-490`, and `BL-490-VIOLATION` does match),
   - Are not reachable from either `main` or `origin/main` (local main lags
     origin routinely; excluding both catches bookkeeping commits on either),
   - Are NOT ancestors of the commit cited in the `git_handoff` (if the commit
     is already in the parcel's ancestry, it was not dropped), **and**
   - Carry unique content — a merge commit (2+ parents) whose diff against its
     first parent is empty, or any commit whose tree matches the cited commit's,
     are EXCLUDED. These are benign merge-only and empty-diff commits; a
     legitimate dropped fix has unique content and is exactly what this filter
     eliminates (condition from engineering.prompt).

2. If any commits survive all four conditions, they are findings: the parcel is
   missing work the ticket demanded.

The gate stops the send and prints each finding as:
```
PRE_QA_GATE_FAIL ancestry <ticket-id> <sha> on <branch-name>
  remedy: merge commit <sha> into your branch and re-send, or
  remedy: list the sha in this ticket's `abandoned_commits:` field if dropped deliberately
```

Example: The coder committed fix `e57a237b` on `swarmforge-coder`, never
forwarded it, and now attempts a QA-bound handoff for the same ticket from
`a1d89aee` (which does not contain the fix). The gate finds `e57a237b` as a
stranded commit and refuses.

### Check B — Wiring Never Landed (BL-419 Pattern)

A ticket may build a helper mechanism and declare required call sites. If the
mechanism code is present but the call sites are bare, the work is incomplete.
The gate enforces that each declared wiring path actually contains its declared
pattern at the parcel commit.

The ticket's optional `required_wiring:` field lists call sites:
```yaml
required_wiring:
  - "swarmforge/scripts/swarm_handoff.bb::pre_qa_gate_lib::wired into the handoff validation path"
  - "swarmforge/roles/QA.prompt::pre_qa_gate_lib::called by the QA role on outbound handoffs"
```

Each entry is `path::pattern` (or `path::pattern::why` with an optional
explanation), split on the first two `::` so a `why` may contain `::`. The
gate reads each `path` **at the commit cited in the handoff** (via `git show
<commit>:<path>`), never the working tree (the working tree may be dirty or
ahead), and verifies a fixed-string occurrence of `pattern`. Missing paths,
missing patterns, and malformed entries (unparseable field shapes) are all
findings.

The gate stops the send and prints each finding as:
```
PRE_QA_GATE_FAIL wiring <ticket-id> <path> pattern not found "<pattern>"
  remedy: land the wiring in <path> and re-send, or  
  remedy: remove this entry from the ticket if it is no longer required
```

Example: A ticket's `required_wiring:` entry says `commit_integrity_cli.bb`
must appear in `swarmforge/roles/coordinator.prompt`. The parcel commit has
built `commit_integrity_cli.bb` but never called it in coordinator.prompt.
The gate finds the pattern missing and refuses. The author adds the call site
and re-sends.

### Check C — Manifest Parsing Error

An unparseable `required_wiring` entry is a typo that must fail loud, never
silently pass. The gate parses the entire `required_wiring:` list before
accepting any wire. A malformed entry (missing separators, too many separators,
non-string value) is a finding of class `manifest`.

```
PRE_QA_GATE_FAIL manifest <ticket-id> malformed required_wiring entry: ...
  remedy: fix the entry in the ticket and re-send
```

### Refusal Contract

Every refusal is machine-greppable and stable:
```
PRE_QA_GATE_FAIL <class> <ticket-id> <detail>
```

where `<class>` is one of `ancestry`, `wiring`, or `manifest`. A gate failure
prints one line per finding, with details and remedies. The parcel is NOT
written to QA's inbox, so it must be re-sent after fixing.

The two remedies for ancestry findings are:
1. Merge the stranded commit into your branch and re-send.
2. Declare the dropped commit under the ticket's `abandoned_commits:` field
   (documented in backlog-schema.md) and re-send.

The two remedies for wiring findings are:
1. Land the required call site in the specified path and re-send.
2. Remove the `required_wiring:` entry if the requirement no longer applies.

### Fail-Open on Infrastructure, Fail-Closed on Findings

A gate wired into the single chokepoint every handoff passes can jam the whole
swarm. The gate therefore:

- **Fails open** on any infrastructure error: `.swarmforge/roles.tsv`
  unreadable, a recorded worktree path missing, a git invocation failing, or a
  `main` ref absent. It prints a warning naming the check that could not run
  and allows the send.
- **Fails closed** on a positive finding: a discovered stranded commit, a
  missing wiring pattern, or a malformed `required_wiring` entry. The parcel is
  refused.
- **Skips silently** for task names without extractable ticket IDs (tracer
  bullets, ad-hoc tasks).

The one deliberate exception to "fail open" is a malformed `required_wiring`
entry: the author is present and the fix is a one-line edit, so that fails
closed (manifest class).

## Dynamic Routing via Specifier-Declared required_stages (BL-606)

When the `required_stages_routing_enabled` config flag is true (default false),
the handoff send path can skip pipeline stages dynamically. The specifier
declares which stages a ticket actually needs, and routing automatically skips
the rest — shaving latency and token cost for low-scope work (docs-only
changes, config tweaks, pure refactors with existing coverage).

### How it Works

1. **Specifier declares scope** — when writing the spec, the specifier sets:
   ```yaml
   required_stages: [coder, qa]
   stage_skip_reasons:
     cleaner: "style-only, no code logic"
     architect: "configuration change"
     hardender: "no new code paths"
     documenter: "no user-facing docs change"
   ```

2. **Routing rewrites the recipient** — when `swarm_handoff.sh` sends a
   `git_handoff` with a task name, it:
   - Extracts the ticket ID from the task
   - Reads the ticket's `required_stages` from `backlog/active/<id>*.yaml`
   - If the flag is ON and required_stages is valid, computes the next required
     stage after the current one
   - Rewrites the handoff `to:` field to skip directly to that stage
   - Records the skipped stages in the handoff envelope and in a durable log

3. **Skipped stages are visible** — the handoff trail shows:
   - `routing_skipped: cleaner,architect,hardender,documenter` envelope header
   - A line appended to `.swarmforge/routing-skips.jsonl` with the skip event
   - `stage_skip_reasons` committed to the ticket YAML for git audit

### Safety Guardrails

**Default OFF** — `required_stages_routing_enabled false` in `swarmforge.conf`
means required_stages is ignored and every ticket runs the full chain, identical
to legacy behavior. Opting in to routing is an explicit configuration decision.

**Invalid declarations default to full chain** — if `required_stages` is missing,
unparseable, or contains unknown stages, the ticket runs all stages as though
routing were disabled. Silently skipping a stage is not the failure mode.

**QA and documenter are conservative** — QA may be omitted **only** for tickets
that omit `coder` (non-code changes). Documenter may be omitted at the
specifier's discretion. A declaration that tries to skip QA while keeping `coder`
is rejected and defaults to full-chain. Loudly. This ticket's design learned from
a prior incident (BL-463: "shipped without a documenter pass") — the skip must
never be silent.

**Per-ticket visibility** — for any completed ticket, `git log` + the routing-skips
log answer which stages actually ran. Skip recording is not a nice-to-have; it is
load-bearing for post-hoc audit and debugging.

### Kill-Switch Recovery

If a misfire with routing occurs in the field (a ticket that should have been QA'd
slips through, etc.), one-line fix:

```bash
# swarmforge.conf
config required_stages_routing_enabled false
```

Push this change, kill the swarm, and relaunch. All tickets revert to full-chain
behavior instantly. Routing is designed to stay one configuration flag away from
the old predictable pipeline.

### Reading the Routing Log

`.swarmforge/routing-skips.jsonl` (one JSON event per line) records every skip:

```json
{"ticket":"BL-042","commit":"a1b2c3d9e8","at":"2026-07-23T14:30:15Z","skipped":["cleaner","architect","hardender","documenter"],"reason":"doc-only copy change"}
```

To check what stages actually ran for a completed ticket:

```bash
# Grep the ticket in routing-skips.jsonl
grep '"ticket":"BL-042"' .swarmforge/routing-skips.jsonl

# For each found line, see which stages were skipped
# The stages NOT in the skip list are the ones that ran

# Cross-check against git log to confirm the lineage
git log --oneline <ticket-branch> | head -<stage-count>
```

## Handoff Daemon

The daemon should be implemented in Babashka.

Rationale:

- The service is mostly filesystem traversal, parsing, sorting, renaming, and
  subprocess calls.
- Babashka keeps the implementation small and easier to change while the
  protocol is still evolving.

Responsibilities:

- Discover configured agents and worktrees.
- Poll each agent `outbox/`.
- Process only complete `.handoff` files, never files in `outbox/tmp/`.
- Copy each handoff to every recipient `inbox/new/`.
- Add `recipient` and `enqueued_at` to each recipient copy.
- Send a generic tmux wake-up message to each recipient.
- Move the original outbox file to `sent/` after successful delivery.
- Move malformed or undeliverable files to `failed/` with useful diagnostics.
- Avoid duplicate delivery when retrying after interruption.

The tmux message should not name the delivered file. It should avoid biasing the
recipient toward one file and should force queue-order processing.

This message is a shared constant (`HANDOFF_WAKE_MESSAGE`) defined once in the
extension's `extension/src/swarm/verifiedInject.ts` and referenced by both
`handoffd.bb` (daemon wake path) and the extension's chaser/recovery wake paths.
Never duplicate the literal; both implementations reference the single shared source.

Example tmux wake-up (from the shared constant):

```text
You have new handoff mail. If idle, run ready_for_next.sh.
```

### OpenRouter provider for claude-harness roles (BL-523)

Set `SWARMFORGE_OPENROUTER_ROLES` to a space-separated list of role names
(for example via `.swarmforge/openrouter.env`). Listed claude-harness roles
point Claude Code at OpenRouter's Anthropic-compatible endpoint
(`ANTHROPIC_BASE_URL=https://openrouter.ai/api`) and authenticate with
`OPENROUTER_API_KEY` (injected ephemerally via `tmux respawn-pane -e`, never
written into launch scripts — BL-130). Unlisted or empty list → unchanged
first-party subscription auth (`unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN`).
The role's `--model` still comes from the pack `window` line / settings JSON.

Pack example: `swarmforge/packs/openrouter-cheap-mono-router.conf`. Check the
API key's **monthly spend limit** in the OpenRouter dashboard — account
credits alone are not enough when the key cap is exhausted.

Acceptance shell coverage: `swarmforge/scripts/test/test_openrouter_provider_support.sh`.

### OpenRouter pane env on respawn

`launch_role` injects `OPENROUTER_API_KEY` (and optional
`CLAUDE_CODE_MAX_OUTPUT_TOKENS`) via ephemeral `tmux respawn-pane -e` so the
launch script can point Claude Code at OpenRouter without writing secrets to
disk (BL-130). Chase and `./swarm ensure` respawns must pass the same `-e`
flags; omitting them leaves `ANTHROPIC_AUTH_TOKEN` empty and every turn fails
(empty/malformed HTTP 200). Respawn always uses the canonical
`.swarmforge/launch/<role>.sh` at the project root — never a worktree-local
copy — so a repair cannot relaunch the wrong role's script into a session.

### Mono-router panel live feed

Under `config rotation router`, only the resident pipeline pane and the
coordinator session stand. The VS Code/Cursor panel must treat
`sessions.tsv` ∩ live tmux sessions as the tile set (`readLiveSwarmRoles`):
`isSwarmReady` is true when resident + coordinator are up (not when every
pack role has a pane), and `runningSwarmMatchesConfig` compares pack
`window` lines to non-coordinator `sessions.tsv` rows so coordinator
provisioning does not falsely mark a mismatch.

### Mono-router rotate targets resident session

`rotate_to_role.sh` must respawn the standing pipeline pane (home role
session from `roles.tsv`, usually `swarmforge-coder`), not whatever
`tmux display-message` returns without `-t`. Headless agent shells often
resolve the wrong pane, so rotation can print success while the resident
stays on the old role. The same OpenRouter `-e` injection as chase/ensure
applies on rotate and idle-clear respawn.

### Mono-router aged-note actionability (BL-576)

Under `config rotation router`, the handoff daemon's chase sweep decides which
dormant mailboxes are worth rotating the resident for. By default, it counts
only in-process work and git_handoffs to prevent broadcast thrash when five-role
merge-up notes land.

**Aged-note actionability** extends the rotation decision: a `type: note` to a
dormant role (such as a design kickoff to the specifier) stays non-actionable
for `note_actionable_after_ms` (default 1200000 ms / 20 minutes). Once aged past
the threshold, the note becomes actionable and the chase sweep will rotate the
resident to that dormant role to drain it.

**Key mechanics:**

- **Fresh notes are protected.** A note delivered while the resident is mid-parcel
  drains on the normal pipeline before it ages in — no rotation, no broadcast
  thrash.
- **Age measured from parcel header** (`enqueued_at` first, then `created_at`),
  never file mtime (worktree syncs touch files).
- **Dormant-note delivery wake suppressed.** When a note lands in a dormant role's
  mailbox while the resident is elsewhere, no wake is sent. The chase sweep will
  rotate when it ages in, removing wasted `NO_TASK` turns.
- **Newest actionable mail still wins.** If an aged note and a git_handoff are
  both actionable in different dormant roles, the newest (by created_at) rotates
  first.
- **One rotation per sweep.** Busy gates, cooldown, and per-sweep resident budget
  all apply unchanged. Home-role return (`ROTATE_HOME`) is automatic.

**Configuration:** `note_actionable_after_ms` (positive integer, milliseconds).
Read at daemon startup via the effective config (BL-216); absent, malformed,
zero, or negative values degrade to default. Cannot be disabled (zero/negative
would reinstate broadcast thrash). For tuning and live investigation, see
`docs/how-to/BL-576-aged-note-actionability-mono-router.md`.

### Dispatch-gap sweep

The daemon's existing chase/nudge sweep only watches inbox mail (queued or
in-process handoffs), so a `backlog/active/` item that never received a
routing handoff at all — no inbox mail ever existed for it — was invisible
to that sweep and could sit indefinitely with no alert (BL-217 sat this way
roughly 3 hours before being noticed manually).

On the same sweep cadence, the daemon also scans every active backlog item
against every role's outbox/sent/completed/in_process/new handoff trail (by
ticket id, read from a `git_handoff`'s `task` header or a `note`'s leading
ticket id). Two complementary closes run from that scan, both via the normal
`swarm_handoff.bb` outbound path (never a hand-written inbox file), attributed
`from: coordinator`:

1. **Assigned, never dispatched (BL-222).** An active item that already has
   `assigned_to` but **no** trail anywhere is auto-routed: the daemon sends a
   `note` **to that assignee** so the living role picks the work up. A gap
   already covered by an in-flight auto-routed note is not re-routed on the
   next sweep.

2. **Active but unassigned.** An active item with an `id` and a missing/blank
   `assigned_to` is invisible to (1) — there is nowhere to auto-route — and the
   coordinator often idles on mailbox `NO_TASK` because it must not self-poll.
   The daemon therefore sends a `note` **to the coordinator only**
   (`"<id> active unassigned - assign_to and route it."`). The sweep never
   writes `assigned_to` itself; intake and routing remain the coordinator's
   exclusive duty. Once that nudge note exists as a trail, the item is not
   re-nudged.

### Push sweep

Nothing in the swarm otherwise runs `git push`: publication of local `main`
to `origin/main` depended entirely on an agent role remembering to run it,
which twice in one day silently didn't happen — hours of committed,
QA-approved work sat local while `origin/main` stayed frozen, indistinguishable
from outside (GitHub, a phone, a remote session) from a dead swarm (BL-356).

On the same sweep cadence, the daemon also runs a push sweep (`push_sweep_lib.bb`)
against the master checkout's `main` branch:

- **Local ahead, origin not ahead:** push `main` to `origin`, with a bounded,
  backed-off retry budget. Only once that budget is exhausted does the daemon
  raise a push-failure alarm.
- **Origin ahead of (or diverged from) local:** never force-push. Raise a
  divergence alarm and leave reconciliation to a human or the coordinator.
- **Origin already has every local commit:** clear all persisted sweep state
  (backoff, both alarms) — a later failure episode of either kind always
  starts fresh and alarms again.

Both alarms are delivered via the shared `daemon_alarm_lib.bb` email sender
and follow the project's delivery-based arming rule: a transient send failure
never arms the "already alarmed" flag (it retries, bounded), while a terminal
misconfiguration warns once and arms. The push-failure and divergence alarms
also clear each other's stale armed flag on transition between the
`:should-push` and `:diverged` branches, so a resolved episode of one kind
can never suppress a later, unrelated episode of the other kind.

## Queue Helper Scripts

Agents should not manually move inbox files. Helper scripts should own queue
state transitions.

### `ready_for_next.sh`

Responsibilities:

- Run inside one agent worktree.
- Read the current role from `SWARMFORGE_ROLE`.
- Read that role's receive mode from `.swarmforge/roles.tsv`.
- Dispatch to `ready_for_next_task.sh` for `task` mode.
- Dispatch to `ready_for_next_batch.sh` for `batch` mode.

### `done_with_current.sh`

Responsibilities:

- Run inside one agent worktree.
- Read the current role from `SWARMFORGE_ROLE`.
- Read that role's receive mode from `.swarmforge/roles.tsv`.
- Dispatch to `done_with_current_task.sh` for `task` mode.
- Dispatch to `done_with_current_batch.sh` for `batch` mode.

### `ready_for_next_task.sh`

Responsibilities:

- Run inside one agent worktree.
- Check `inbox/in_process/` first.
- If an in-process file exists, report that it must be resumed or completed
  before accepting new work.
- If no in-process file exists, select the first file in `inbox/new/` by sorted
  filename order, skipping any candidate whose basename already exists in
  `inbox/completed/` or `inbox/abandoned/` — a stale duplicate left behind in
  `new/` (e.g. by a layout migration or interrupted delivery) is logged as
  `SKIPPED already-processed: <basename>` rather than resurrected as fresh
  work, and the next genuinely-new candidate behind it is dequeued instead
  (BL-218).
- Atomically move that file to `inbox/in_process/`.
- Add or update `dequeued_at`.
- Print the accepted task path, sender, message type, priority, and payload.
- Print `NO_TASK` if no inbox item is available (including when every `new/`
  candidate was skipped as already-processed).
- Refuse ambiguous states, such as multiple in-process files, unless an explicit
  repair is made outside the helper.
- Before printing a task (resuming an in-process claim or freshly dequeuing
  one), run the branch/claim mismatch guard (BL-529, see below).

### Branch/claim mismatch guard (BL-529)

`ready_for_next_task.bb` checks the worktree's current git branch against the
claim it is about to print, via `swarmforge/scripts/branch_claim_guard_lib.bb`:

- **Generic branch** (`swarmforge-<role>`, `<swarm-name>/<role>`, `main`) or a
  **ticket branch matching the claim**: no conflict, the turn proceeds
  unchanged.
- **Ticket branch naming a DIFFERENT ticket than the claim, clean worktree**:
  the guard auto-checks-out to the role's standard branch — `<swarm-name>/<role>`
  per BL-106, falling back to the legacy `swarmforge-<role>` name, with the
  swarm name read from the target root's swarm-identity file — then the turn
  proceeds.
- **Ticket branch mismatch, dirty worktree** (any porcelain output, including
  untracked files — auto-checkout must never carry one ticket's in-flight
  edits or scratch onto another ticket's branch): the claim is requeued back
  to `inbox/new/`, the turn is refused, and a `BRANCH_CLAIM_MISMATCH` warning
  names the branch and the claim.
- **Checkout failure** (neither standard-branch candidate resolves, or both
  are checked out in other worktrees so git refuses the switch): treated as
  uncorrectable — same requeue-and-refuse path as the dirty-worktree case,
  rather than proceeding on the wrong branch.
- **Requeue collision**: if a same-named file already sits in `inbox/new/`
  (the BL-128 stale-copy window), the requeue refuses loudly with a
  cannot-requeue diagnostic and leaves both copies intact rather than
  overwriting the redelivered duplicate. A requeued claim's `.nudge` /
  `.claim-progress.json` sidecars at its vacated `in_process/` location move
  with it.

This closes the gap where an agent could spend a turn working against the
wrong ticket's branch relative to its active claim (root-caused by BL-512
audit BL-FIX-002). See
`specs/features/BL-529-ticket-branch-mismatch-guard.feature` for the full
scenario set.

Example success:

```text
TASK: .swarmforge/handoffs/inbox/in_process/00_20260615T140531Z_000042_from_architect_to_coder.handoff
FROM: architect
TYPE: git_handoff
PRIORITY: 00
TASK_NAME: task-1-cave-setup
PAYLOAD:
merge_and_process architect a1b2c3d9
```

### `done_with_current_task.sh`

Responsibilities:

- Run inside one agent worktree.
- Require exactly one file in `inbox/in_process/`.
- Refuse to run if `inbox/in_process/` contains a batch directory.
- Add or update `completed_at`.
- Move the file to `inbox/completed/`.
- Print the completed task path.
- Call `ready_for_next_task.sh` after completion and pass through its output.
- Refuse to run if there are zero or multiple in-process files, unless an
  explicit repair is made outside the helper.

`done_with_current_task.sh` should not duplicate queue-selection logic.
`ready_for_next_task.sh` should remain the single owner of checking
`inbox/in_process/`, selecting the next sorted `inbox/new/` item, moving it to
`inbox/in_process/`, adding `dequeued_at`, and printing `TASK` or `NO_TASK`.

### `ready_for_next_batch.sh`

Responsibilities:

- Run inside one agent worktree.
- Check `inbox/in_process/` first.
- If an in-process batch exists, print that batch.
- Refuse to run if a single in-process task exists.
- If no in-process work exists, select the first file in `inbox/new/` by sorted
  filename order, applying the same already-processed skip against
  `inbox/completed/` and `inbox/abandoned/` as `ready_for_next_task.sh`
  (BL-218).
- Select every queued handoff with the same priority as that first file.
- Move those files into one `inbox/in_process/batch_<timestamp>_<suffix>/`
  directory.
- Add or update `dequeued_at` on each selected file.
- Print the accepted batch path, count, priority, and each task payload in
  helper-delivered order.
- Print `NO_TASK` if no inbox item is available.
- Refuse ambiguous states, such as multiple in-process batches, unless an
  explicit repair is made outside the helper.

### `done_with_current_batch.sh`

Responsibilities:

- Run inside one agent worktree.
- Require exactly one batch directory in `inbox/in_process/`.
- Refuse to run if `inbox/in_process/` contains a single task file.
- Add or update `completed_at` on each file in the batch.
- Move the batch directory to `inbox/completed/`.
- Print the completed task paths and completed batch path.
- Call `ready_for_next_batch.sh` after completion and pass through its output.
- Refuse to run if there are zero or multiple in-process batches, unless an
  explicit repair is made outside the helper.

Example success:

```text
COMPLETED: .swarmforge/handoffs/inbox/completed/00_20260615T140531Z_000042_from_architect_to_coder.handoff
TASK: .swarmforge/handoffs/inbox/in_process/50_20260615T140600Z_000043_from_cleaner_to_coder.handoff
FROM: cleaner
TYPE: note
PRIORITY: 50
PAYLOAD:
Waiting on QA result before merging cleanup branch.
```

Example success with no queued follow-up:

```text
COMPLETED: .swarmforge/handoffs/inbox/completed/00_20260615T140531Z_000042_from_architect_to_coder.handoff
NO_TASK
```

## Agent Queue Rules

Prompts should instruct agents to follow this loop:

1. When notified, run `ready_for_next.sh`.
2. Let `ready_for_next.sh` dispatch according to the receive mode configured for
   your role.
3. If it prints `NO_TASK`, stop waiting for work.
4. If it prints `TASK: <path>`, treat the printed `PAYLOAD` as the task.
5. If it prints `BATCH: <path>`, treat each printed `BATCH_ITEM` as part of the
   current batch in helper-delivered order.
6. Use only the task information printed by the helper scripts.
7. If a tmux wake-up arrives while already working on a task, ignore it.
8. When the task or batch is fully complete, run `done_with_current.sh`.
9. Treat `note` handoffs as tasks too; after reading or acting on a note, run
   `done_with_current.sh` before accepting any other handoff.
10. If a done helper prints `TASK: <path>`, treat the printed `PAYLOAD` as the
   next task.
11. If a done helper prints `BATCH: <path>`, treat each printed `BATCH_ITEM` as
   part of the next batch in helper-delivered order.
12. If a done helper prints `NO_TASK`, stop waiting for work.

On restart, an agent should run `ready_for_next.sh` and follow its output.

Tmux wake-ups are intentionally lossy. They only prompt an idle agent to check
its durable inbox. A busy agent can ignore them because task completion also
checks the queue and accepts the next task in priority order.

## Audit Trail

The file system state and handoff headers replace the logbook.

Important headers:

```text
id
from
to
recipient
priority
type
created_at
enqueued_at
dequeued_at
completed_at
```

Lifecycle ownership:

- `swarm_handoff.sh` writes `id`, `from`, `to`, `priority`, `type`, and
  `created_at`.
- `handoffd` writes `recipient` and `enqueued_at` into each recipient copy.
- `ready_for_next_task.sh` writes `dequeued_at`.
- `ready_for_next_batch.sh` writes `dequeued_at`.
- `done_with_current_task.sh` writes `completed_at`.
- `done_with_current_batch.sh` writes `completed_at`.

## Daemon Shutdown

The swarm launcher should own the daemon lifecycle.

Startup:

- Start the daemon after creating or discovering the tmux session.
- Write daemon runtime files under `.swarmforge/daemon/`.

Runtime files:

```text
.swarmforge/daemon/
  handoffd.pid
  handoffd.log
  stop
```

Shutdown:

- When the swarm is torn down, the launcher sends `TERM` to the daemon.
- The daemon traps `TERM`, finishes any current delivery transaction, removes
  its PID file, logs shutdown, and exits.
- The daemon may also watch `.swarmforge/daemon/stop` as a secondary shutdown
  mechanism.

Delivery should be transaction-like:

1. Detect an outbox file.
2. Copy it to all recipient inboxes.
3. Send wake-up notifications.
4. Move the original outbox file to `sent/`.
5. If interrupted before completion, retry without duplicating already delivered
   recipient copies.

## Implemented Helpers

The current daemon-backed protocol uses these helper scripts:

- `swarm_handoff.sh` validates and queues outbound handoff drafts.
- `ready_for_next.sh` dispatches to the correct ready helper for the current
  role's configured receive mode.
- `done_with_current.sh` dispatches to the correct done helper for the current
  role's configured receive mode.
- `ready_for_next_task.sh` accepts or resumes one current task.
- `done_with_current_task.sh` completes one current task.
- `ready_for_next_batch.sh` accepts or resumes one current batch.
- `done_with_current_batch.sh` completes one current batch.
- `handoffd` delivers queued outbox files and sends generic wake-ups.

Agents should not use direct tmux notifications, long handoff bodies, logbooks,
or the removed send/receive/complete/resend wrapper scripts.

## Finalized Decisions

- The handoff daemon is written in Babashka.
- Git handoff commit abbreviations are exactly 10 hexadecimal characters.
- `note` handoffs have no optional classification field.
- Helper scripts do not provide recovery modes for ambiguous queue state.
- The daemon does not perform a second full validation pass on outbox files;
  `swarm_handoff.sh` is the validation boundary.

## Cold pack switch (until BL-525 ModelFactory)

`swarmforge/scripts/failover_to_gpt.sh <root>` — kill + relaunch `--pack codex-mono-router`
with `OPENAI_API_KEY` from the environment (BL-130). Verifies coder+coordinator
sessions before exiting 0.

`./swarm ensure <root>` on a mono-router standing shape reports pipeline rotate
targets as `DORMANT` (not `FAILED`), and respawns standing panes with full
provider `-e` passthrough (OpenAI / Cerebras map / OpenRouter / Mistral).

## Remote bridge UI (holistic / pipeline board)

Headless bridge listens on port 8765 (`BRIDGE_TOKEN` from
`.swarmforge/operator/bridge-token`). Open the **root** URL (not `/pipeline`):
enter the bearer token, or use `/?token=…` once. A bare `/pipeline` URL still
returns JSON 401 by design.
