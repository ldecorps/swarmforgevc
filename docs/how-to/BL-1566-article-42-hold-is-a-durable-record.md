# An Article 4.2 hold is a durable record QA resumes from (BL-1566)

*How-to. Task-oriented: open, read, and close an Article 4.2 hold, and
understand why a resume note alone no longer resumes anything.*

## What it catches

Article 4.2: QA approves no parcel whose evidence names a red with no open
ticket, and "the parcel waits". Before this ticket, the wait lived only in
an evidence file's prose. On 2026-09-14, QA withheld BL-1555 on a red owned
by nothing, completed the withheld parcel itself (a rotation resident
cannot sit `in_process` for hours), and when the owner ticket was minted
and a resume note reached QA, QA dequeued and completed that note in ten
seconds — nothing in the note refused the completion or named which parcel
commit to re-gate. The swarm starved at `active_backlog_max_depth: 1` for
eleven minutes until an operator hand-note named the parcel.

A hold is now a record under `.swarmforge/qa-holds/<task>.json`, at the
project root (never worktree-local, so the coordinator and any worktree see
the same store). It names the parcel's task, its commit, the withheld red
paths, and the evidence sha.

## How it decides

`swarmforge/scripts/qa_hold_lib.bb` (ns `qa-hold-lib`) is the pure decision
layer; nothing here parses note text for red names.

- `release?` — true only when a hold names at least one red and **every**
  one has a standing-red register row whose owner ticket sits in
  `backlog/paused/` or `backlog/active/`. A ticket in `backlog/done/` owns
  nothing; a red with no register row at all is unowned. A hold naming no
  reds is never released.
- `status-lines` — one `HOLD <task> <commit> red=<path> owner=<id|none>`
  line per red, with a `RELEASED <task> <commit>` line prepended once the
  hold releases (first line printed, ahead of the per-red detail).
- `blocks-completion?` — true only when the role is QA, the inbound is a
  `note`, and at least one hold is released. A `git_handoff` inbound — the
  withheld parcel itself, completed so the resident can rotate — is never
  blocked; that parking exception is Article 4.2's own, unchanged.

Two one-line calls wire the decisions into the live QA paths:

- `ready_for_next_task.bb` prints `status-lines` first, before in_process
  resume and before `NO_TASK`, whenever the store is non-empty — whichever
  wake reaches QA surfaces a release.
- `done_with_current_task.bb` refuses to complete a `note` inbound while
  `blocks-completion?` is true: exits non-zero, prints `HOLD_RELEASED <task>
  <commit>`, and leaves the note in `in_process`. Completing a
  `git_handoff` inbound is never refused.

## Using the CLI

```bash
# open a hold when withholding a parcel on an unowned red
bb swarmforge/scripts/qa_hold_cli.bb <project-root> open \
  --task BL-1555 --commit <parcel-sha> \
  --red extension/test/bl1297MergeOwnPathsInvariants.property.test.js \
  --evidence <evidence-sha>

# read status at any time (read-only)
bb swarmforge/scripts/qa_hold_cli.bb <project-root> status

# end the block once you act on the release
bb swarmforge/scripts/qa_hold_cli.bb <project-root> close \
  --task BL-1555 --outcome approved   # or bounced | abandoned
```

`close` is the **only** exit from the open store — it moves the record to
`.swarmforge/qa-holds/closed/<task>.json` with the outcome and a
closed-at timestamp. Nothing else here ever deletes a hold record.

## If you're QA and hit the refusal

```
HOLD_RELEASED BL-1555 <parcel-sha>
```

Re-gate the named commit from your own branch (re-run the checks the hold
was opened for), then `close --outcome approved|bounced|abandoned` before
retrying `done_with_current.sh` on the note.

## Where it lives

| Piece | Location |
| --- | --- |
| Decision library | `swarmforge/scripts/qa_hold_lib.bb` (ns `qa-hold-lib`) |
| CLI | `swarmforge/scripts/qa_hold_cli.bb` — `open` / `status` / `close` |
| Wired into | `swarmforge/scripts/ready_for_next_task.bb` (status first on a QA turn), `swarmforge/scripts/done_with_current_task.bb` (refuses a note while released) |
| Store | `<project-root>/.swarmforge/qa-holds/<task>.json`, closed records under `.../qa-holds/closed/` |
| Acceptance feature | `specs/features/BL-1566-an-article-42-hold-is-a-record-qa-resumes-from.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1566ArticleFortyTwoHoldRecordSteps.js` |

## Not in scope here

- Who wakes QA on release — the specifier's resume note to the holder
  remains the wake signal; this ticket only makes the resume durable once
  QA is awake.
- `babysitterd`'s `swarm-starved` message naming open holds.
- Re-dispatching the withheld parcel as a new `git_handoff` — QA re-gates
  the recorded commit from its own branch.

## Related

- [Article 4.2 pipeline-code-on-main sweep](../reference/Specification.MD) — the standing-red register this hold's release depends on (BL-1428).
- `docs/reference/BL-567-expeditor-manual.md` — a separate hold shape (`backlog/hold/`), unrelated to this per-parcel QA hold store.

## Verify

```bash
bb swarmforge/scripts/test/qa_hold_lib_test_runner.bb
bb swarmforge/scripts/test/qa_hold_cli_test_runner.bb
node specs/pipeline/cli.js specs/features/BL-1566-an-article-42-hold-is-a-record-qa-resumes-from.feature
```
