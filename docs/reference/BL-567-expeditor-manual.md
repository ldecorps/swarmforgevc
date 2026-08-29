# Expeditor — complete reference

Information-oriented. Every flag, exit code, artifact, verdict and refusal the
expeditor produces. For *why* it is shaped this way see
[the rationale](../explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md);
for step-by-step recipes see
[the how-to](../how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md).

Ticket: BL-567. Implementation: `swarmforge/scripts/expedite{.sh,_cli.bb,_lib.bb}`.

---

## Synopsis

```
expedite.sh <BL-id> [options]
expedite.sh <project-root> <BL-id> [options]
```

One positional resolves to the repo the script lives in. Two takes an explicit root.
Arguments and flags may be interleaved in any order.

Direct invocation, equivalent and used by the tests:

```
bb swarmforge/scripts/expedite_cli.bb <project-root> <BL-id> [options]
```

## Options

| flag | value | default | effect |
|---|---|---|---|
| `--dry-run` | — | off | Plan and print. Parks nothing, stops nothing, creates no worktree. Still prints the liveness verdict and the teardown verdict so you see what *would* happen. |
| `--no-restart` | — | off | Skip the final restart phase. `restart` is reported as `not-attempted`. |
| `--override` | — | off | Proceed even though a live swarm could not be brought down. Always warns, and is recorded in `run.json`. Covers **both** liveness gates — see [Refusals](#refusals). |
| `--bounce-bound` | integer | `3` | Bounces allowed per (stage, ticket) before the run stops. A value above the default is announced as `RAISED explicitly` and recorded. |
| `--stage-timeout-ms` | integer | `5400000` (90 min) | Per-stage wall-clock budget. On overrun the stage's whole process group is killed. |

Diagnostic (not a full expedite run — separate argv shape):

```
bb swarmforge/scripts/expedite_cli.bb --probe-liveness <project-root>
```

Prints the live `probe-liveness` JSON for that root and exits `0`. Refuses
(`exit 1`) when `EXPEDITE_PROBE_FILE` is set, so the call always exercises the
real process-table path (BL-782).

Unknown flags are ignored rather than rejected. A value-taking flag with a missing
value yields `nil` for that option and does **not** consume the following flag.

## Exit codes

| code | meaning |
|---|---|
| `0` | The ticket reached `done` **and** the restart half was `ok` or `not-attempted`. |
| `1` | Either half failed. `run.json`'s `failed-half` says which — `ticket` or `restart`. Also used for every refusal. |
| `2` | Usage error (missing project root or ticket id). |

A non-zero exit **never** means the ticket verdict was retracted. A `done` ticket with
a failed restart exits `1` with `ticket: "done"` and `failed-half: "restart"`.

## Stage chain

```
specifier → coder → cleaner → architect → hardender → documenter → QA
```

A ticket's `roles:` manifest narrows the chain. `coder` and `QA` are always retained
even if a manifest omits them. `coordinator` is never a chain member — it is
bookkeeping only.

## Stage verdicts

Each stage writes JSON to the path named in its task. The `verdict` field is
classified as:

| classification | accepted values |
|---|---|
| **advance** | `pass`, `forward`, `approved` |
| **bounce** | `bounce`, `send-back`, `sendback` |
| **fail** | anything else, including absent, empty, or unrecognised |

Case-insensitive. **Fails closed**: an unrecognised verdict stops the run rather than
being guessed into `advance`, because guessing silently skips a gate.

`forward` is a real role outcome — the documenter's documented no-op for a change with
nothing user-facing to document — not a synonym invented here.

A bounce record may carry `target` (default `coder`), `reason`, and `class`. `class`
is what exhaustion reporting groups on.

## Bounce accounting

Counted per `(stage, ticket)`. On the bound being reached the run stops and reports:

| `verdict` | when | routing |
|---|---|---|
| `probable-spec-defect` | one defect class repeats across the rounds | `specifier`, with the class named |
| `diffuse-failure` | the rounds show unrelated classes | nothing routed — weaker evidence, so no claim |

`blame-stage` is always `nil`. Exhaustion is a statement about the ticket, not the
stage that reported it.

A bounce **never reverts the branch**. It records a verdict and re-enters the target
stage with the reason carried into the next task injection.

## Run artifacts

Everything lands under `<project-root>/.swarmforge/expedite/<BL-id>/`:

```
run.json
park-record.json
NN-<role>/prompt.md            the exact composed system prompt for that stage
NN-<role>/task.txt             the task injection appended to it
NN-<role>/transcript.jsonl     the stage's stdout
NN-<role>/stderr.log           the stage's stderr
NN-<role>/verdict.json         the stage's verdict, enriched with driver fields
```

### `run.json`

| key | type | meaning |
|---|---|---|
| `ticket-id` | string | the BL id |
| `ticket` | string | `done` or `failed` |
| `ticket-ok?` | bool | `ticket == "done"` |
| `restart` | object | `{outcome, exit, error, live-set-delta}`, or `{outcome: "held", marker-path, hold-reason}` (BL-1249) |
| `restart-ok?` | bool | true for `ok` and `not-attempted` only — `held` is not ok |
| `exit-code` | int | the process's own exit code |
| `failed-half` | string | `ticket`, `restart`, or absent |
| `branch` | string | the `expedite/<BL-id>` branch used |
| `bound` | object | `{bound, default, raised?, explicit?}` |
| `history` | array | one `{stage, verdict, reason, class}` per stage attempt |
| `exhaustion` | object | present only when the bounce bound was reached |
| `park` | object | the park plan |
| `parked-report` | object | `{parked, still-held, promoted, note}` |
| `teardown` | object | `{clean?, alive, exit-code-lied?}` |
| `override-used?` | bool | whether the override was in force |
| `deferred` | array | bookkeeping deliberately **not** done |
| `outstanding` | array | BL-1024: what the run left for someone else, each with an owner |
| `finished-at-ms` | int | completion timestamp |

`deferred` is always populated when applicable, so a next boot sees what was skipped
rather than inferring it. Current entries: `bl-topic-record`, `briefing-hooks`,
`pipeline-stage-sync`.

### `park-record.json`

`{parked-at-ms, destination, tickets, role-branch-tips, why}`. `destination` is always
`hold`.

### The QA-hat verdict store (BL-1025)

One artifact does **not** live under the run directory:
`<project-root>/.swarmforge/expedite-approvals/<YYYY-MM>.jsonl`, one JSON object
per line, appended.

```
{"at":"2026-08-22T00:12:00Z","ticket":"BL-1021","stage":"QA","approval":true,"verdict":"pass","commit":"44ef693d9c"}
```

| key | meaning |
|---|---|
| `at` | when the QA hat ruled (ISO-8601; also picks the month file) |
| `ticket` | the BL id the run walked |
| `stage` | always `QA` — no other stage writes here |
| `approval` | **the load-bearing field**: the already-classified decision |
| `verdict` | the QA hat's own verdict token, for a human reading the store |
| `commit` | the run worktree's tip at that instant, 10 hex |

`approval` is what `is_qa_ancestor.sh` keys on, and `verdict` is not. That
split is deliberate: the advance vocabulary (`expedite_lib.bb`'s
`advance-verdicts` — currently `pass`, `forward`, `approved`, and designed to
grow again) lives in Babashka, and the predicate is bash with no import across
that boundary. Having the reader re-derive the token list by hand is the drift
hazard the Guardrails article names after BL-897; recording the classification
instead means the vocabulary has exactly one spelling and a fourth token needs
no second edit. `test_is_qa_ancestor_expedite_store.sh` gates it both ways —
the predicate must name no verdict token, and every token in `advance-verdicts`
must round-trip through the real writer to an approved verdict.

**Why it exists.** An expedite run never advances the `swarmforge-QA` ref — with
the swarm stopped there is no live QA worktree to merge into. Article 4.2's
pipeline-code-on-main check asks `is_qa_ancestor.sh` whether a commit was
approved, and that predicate's only approval signal used to be ancestry of that
ref. So every commit of an expedite run touching a QA-exclusive path read as
"landed outside QA" — three of BL-1021's did, on 2026-08-21. This store is the
run's verdict made machine-checkable, and `is_qa_ancestor.sh` now reads it as an
alternate approval path.

**What it is not.** It is not a way to *assert* approval. Only
`expedite_cli.bb` writes it, only from the QA hat's own verdict, and only on a
real run — `--dry-run` writes nothing, and a QA stage that timed out or returned
an unrecognised verdict writes nothing either (a run that fell over approved
nothing). A commit whose *message* claims an expedite run buys exactly nothing:
the predicate never reads commit subjects (BL-972).

A **bouncing** verdict is recorded too, deliberately (`approval:false`). "A
verdict on file that says no" and "no verdict at all" are different states, and
only a record can tell them apart. Neither approves.

The store is machine-local under `.swarmforge/` (gitignored), so it does not
travel with the repo — it is a fact about approvals on *this* checkout, read by
the babysitter sweep running against that same checkout. Reading it follows the
same fail-closed discipline as the bounce store: absent means "no expedite run
ever approved this", but a store that exists and cannot be consulted is
undeterminable and never reads as approved.

## Liveness

Liveness is a **probe**, never a file glob. Candidate sockets are found by globbing
`.swarmforge/tmux/*.sock`, then each is asked whether a server answers. A socket
**file** with no server behind it reads as **stopped** — `kill_all_swarm.sh` leaves
that file deliberately, so treating its presence as liveness would refuse on a clean
slate.

Anything in this set counts as live, and each is named in a refusal:

```
tmux-server   role-agents   handoffd   handoffd-supervisor   babysitterd   operator
```

`babysitterd` and `operator` are included because a teardown that reported
`SUCCESS — clean slate` left both running, and either can wake or relaunch agents
mid-run (BL-637).

### Root-scoped process needles (BL-782)

Process-table matches for `handoffd`, `handoffd-supervisor`, `babysitterd`, and
`operator` include the audited project root in the needle — a neighbour
worktree's swarm (or the operator's standing babysitterd prototype) is never
counted as a survivor of *this* root. Bare script-name needles matched every
swarm on the host and made `test_expedite_cli.sh` false-fail whenever a live
swarm was up.

- `handoffd.bb <root>` / `handoffd_supervisor.bb <root>` / `babysitterd.sh <root>`
  — trailing space after `handoffd.bb` avoids matching the supervisor script.
- `operator` — `--remote-control Operator` carries no root in argv; the probe
  scopes via `<root>/swarmforge/roles/operator.prompt` (the path
  `launch_operator.sh` always passes for that root).
- `:role-agents` was already root-scoped via `<root>/.swarmforge/launch/`.

Green on a quiet host proves nothing for this class of defect. The behavioural
bar is a decoy process from a *different* root alive throughout the run.

## Order of operations

1. Probe liveness.
2. **Check the configured stop command** (BL-1030): tokenize `EXPEDITE_STOP_CMD`
   (or the `./stop-swarm.sh` default) the way `bash -lc` would, and refuse if any
   whole token is a forbidden flag or the command cannot be tokenized with
   confidence. Decided before anything else moves, so a refusal here costs
   nothing — see [Refusals](#refusals).
3. **Ensure the run ticket is bookkeepable** (BL-1023): locate it under
   `backlog/{active,paused,hold}/`. Already in `active/` → ready. In `paused/` or
   `hold/` → adopt into `active/` (skipped on `--dry-run`). Missing → refuse and
   name the ticket before stages spend. `move-ticket!` returns `{:ok? …}`; a
   failed move exits loudly — never the old silent nil.
4. Park every *other* ticket in `backlog/active/` to `backlog/hold/`; write the park record.
5. Run the stop command — the same line just checked, handed in rather than re-read.
6. **Re-probe and verify.** The stop's exit code is not trusted.
7. Refuse if not clean (unless `--override`).
8. Create `expedite/<BL-id>` and its worktree.
9. Walk the stage chain.
10. Move the ticket yaml to `backlog/done/` on success (source must be `active/` —
    guaranteed by step 3, or the run already refused).
11. Restart — reported, never blocking. Checks the operator's restart hold first
    (see below); if held, the start command is not run.

## Operator restart hold (BL-1249)

Before the restart phase runs `EXPEDITE_START_CMD`, it reads
`.swarmforge/operator/control-pause.json` — the same marker the BL-1191 restart
gate treats as the restart-blocking signal — via `restart-hold-verdict` in
`expedite_lib.bb`:

| marker state | verdict | restart runs? |
|---|---|---|
| file absent | `:absent` (not held) | yes |
| `active: false` (or falsy) | `:inactive` (not held) | yes |
| `active: true`, no `untilMs`, or `untilMs` in the future | `:active` (held) | no |
| `active: true`, `untilMs` in the past | `:inactive` (not held) | yes |
| unreadable/unparseable JSON, non-object, or non-numeric `untilMs` | `:malformed` (held) | no |

Doubt fails **closed**: only a genuinely absent marker, or one that plainly parses
to inactive/expired, permits the restart. Everything else — including a read or
parse failure on a file that exists — holds it.

A hold reports as its own outcome, `held`, in `run.json`'s `restart.outcome`, with
`restart.marker-path` and `restart.hold-reason` set. It is **never** collapsed into
`not-attempted`: `not-attempted` is the caller declining via `--no-restart`/
`--dry-run`; `held` is the operator declining via the marker. Conflating the two
would report an operator-blocked restart as a caller-chosen one.

Like `failed`/`degraded`, `held` does not retract the ticket verdict — `run-result`
keeps `ticket`/`ticket-ok?` independent of `restart`/`restart-ok?`, so a run whose
stages all passed still reports `ticket: "done"` even when the restart was held.

The hold gates **only** the restart phase. Teardown, parking, and the stage chain
all still run while a hold is in force — an operator hold blocks bringing the
stack back up, not doing the work.

Diagnostic, drives the real check without a full run:

```
bb swarmforge/scripts/expedite_cli.bb --restart-only <project-root> [--no-restart] [--dry-run]
```

Prints the same `restart-stack!` result a full run would produce. Refuses
`EXPEDITE_PROBE_FILE` — it must exercise the real marker-file path, not a stub.

## Refusals

| message | cause | remedy |
|---|---|---|
| `REFUSE stop command carries a forbidden flag: <flag> (in: <command>)` | `--sweep-inbox`, `--reset-worktrees` or `--full` present as a whole token of the configured stop command | never pass these: they archive the parcels a parked ticket needs to resume |
| `REFUSE stop command could not be read as a command line, so it is refused rather than admitted: <command>` | `EXPEDITE_STOP_CMD` can't be tokenized with confidence — an unterminated quote, a dangling escape, a parameter expansion (`$var`), or a command substitution (`` `cmd` ``/`$(cmd)`) | simplify the configured stop command to a plain line the guard can read; it fails **closed** on anything it cannot read (BL-1030) rather than admitting it |
| `REFUSE run ticket <id> was not found in backlog/{active,paused,hold}/ — cannot bookkeep at teardown` | yaml missing from those folders | restore or file the ticket; re-run (BL-1023 — before stages) |
| `REFUSE run ticket <id> is in backlog/<folder>/ — cannot bookkeep at teardown` | ticket found outside the adoptable set | move it into `paused/`/`hold/`/`active/` and re-run |
| `REFUSE teardown did not reach a clean slate: <names>` | the swarm is live and the stop could not clear it | stop the named processes by hand; `./stop-swarm.sh` misses `babysitterd` and the Operator agent |
| `REFUSE could not create the run worktree` | branch or directory conflict | remove the stale worktree, or delete the branch |
| `EXHAUSTED {...:probable-spec-defect...}` | the bounce bound was reached on one repeating class | route to the specifier with the named class; do not re-run the coder |
| `stage-timeout` | a stage exceeded its budget | the stage and its whole process group were killed; read that stage's `transcript.jsonl` |

The two stop-command rows fire **before** `park-others!` (BL-1030) — nothing
has been parked and the stop command has not run, so that refusal costs
nothing and the closing summary reports `no tickets are held`. The BL-1023
bookkeep refuse also fires **before** parking siblings and before stages.
The teardown
and worktree-creation rows still fire **after** `park-others!` has already
staged sibling tickets into `backlog/hold/` (BL-1024) — so each of those also
prints the `OUTSTANDING` block and writes `run.json`'s `outstanding` array
before the process exits. Read it: a refusal there is exactly when a parked
ticket is most likely to sit forgotten. See
[the closing summary](#the-closing-summary-bl-1024).

`--override` covers the liveness refusal **and** the teardown refusal, because both
express the same decision: run despite a live swarm. Gating only the first would leave
every overridden run refused at the second.

## Environment

Read, but not required:

| variable | effect |
|---|---|
| `EXPEDITE_STOP_CMD` | stop command, default `./stop-swarm.sh` |
| `EXPEDITE_START_CMD` | start command, default `./start-swarm.sh` |

**Test seams.** Present so the suites can drive real behaviour without a swarm or a
model. Each is a seam, never a way to bypass a gate:

| variable | effect |
|---|---|
| `EXPEDITE_PROBE_FILE` | JSON probe result instead of probing live processes. A **test seam**, never a way to claim the live-swarm bar (BL-782): unpinned cases must pass with a neighbour-root decoy and this unset. |
| `EXPEDITE_STAGE_RUNNER` | a script called per stage instead of spawning `claude -p` |
| `EXPEDITE_NOW_MS` | pins the clock |

`EXPEDITE_STAGE_RUNNER` receives
`<role> <ticket> <prompt-file> <verdict-file> <transcript>` and is expected to write
JSON to `<verdict-file>`.

## What it deliberately does not do

Every entry here is a **deferral with an owner**, not a drop. BL-1024: the
2026-08-21 run ended printing `ticket=done restart=failed`, named none of its
leavings, and the pipeline idled with an empty `active/` until a human noticed.
A deferral nobody is told about is a drop.

- **No push.** Publishing local `main` is a human decision on the next boot.
  *Owner: a human, on the next boot.*
- **No promotion of a next ticket.** One ticket, one run; it has no queue. It
  **does** adopt the *run* ticket from `paused/`/`hold/` into `active/` when
  needed so teardown can close it (BL-1023) — that is bookkeeping for this run,
  not coordinator promotion.
  *Owner: the coordinator, through ordinary promotion, for any later ticket.*
- **No BL topic record, no briefing hook, no board sync.** Those need front-desk
  machinery it exists to work without. All three appear in `deferred`.
  *Owner: the next live swarm; they reconcile on their own sweeps.*
- **No revert on bounce.**
  *Owner: the role the bounce routed to, in its own worktree.*
- **No commit on `main`** outside the QA stage's own merge. `move-ticket!` uses
  `git mv`, so every backlog move ends the run **staged and uncommitted** in
  the shared master checkout. Until someone commits them, `main` and the
  working tree disagree about where those tickets live, and any role committing
  anything else there sweeps them into an unrelated commit.
  *Owner: whoever next commits in the master checkout — deliberately. Named in
  the closing summary.*
- **No re-promotion of what it parked.** Parked tickets stay in `backlog/hold/`,
  which Article 3.1 makes human-held and forbids the coordinator promoting
  from; a parked ticket may also be stale against what the run changed.
  *Owner: a human. Named in the closing summary.*
- **No role worktree is touched.**

### The closing summary (BL-1024)

Every run ends by printing an `OUTSTANDING` block naming what it left and who
picks each item up — on **every** ending, including a failed restart, a bounce
bound exhausted, a stage that overran its timeout, and each of the four
pre-flight [Refusals](#refusals) (forbidden stop flag, unreadable stop
command, teardown not clean, worktree creation failed). The stop-command pair
fire *before* `park-others!` and report nothing held; the other two fire
after `park-others!` has already staged real moves. All four exit through the
same single `exit!` call site
as every other ending, so there is exactly one place in `expedite_cli.bb` that
terminates the process (`grep -c '(System/exit' expedite_cli.bb` is `1`,
inside `exit!` alone) and no ending can bypass the summary. A run that parked
nothing says `no tickets are held` rather than staying silent, and a
`--dry-run` reports `nothing outstanding` because it changed nothing. The same
data rides `run.json` as `outstanding`, so it survives the terminal scrolling
away — which matters most for a refusal, since a refused run never reaches
`-main`'s own tail.

```
expedite OUTSTANDING - this run left work for someone else:
expedite   the parked tickets:
expedite     BL-586, BL-1012  held in backlog/hold/
expedite     owner: a human - Article 3.1 makes backlog/hold/ human-held ...
expedite   the uncommitted backlog moves:
expedite     backlog/active/ -> backlog/hold/  (BL-586)
expedite     backlog/active/ -> backlog/done/  (BL-1021)
expedite     owner: whoever next commits in the master checkout ...
```

## Machinery it may never use

`handoffd`, `handoffd_supervisor`, `sync-deliver`, `swarm_handoff.bb`, the
`.swarmforge/handoffs/` mailboxes, tmux sessions/panes/wake injection,
`rotate_to_role`, `ready_for_next`, the coordinator, chase sweeps, the babysitter, the
operator runtime.

It **does** command their lifecycle. Prompts are composed fresh through PromptEngine
rather than read from `.swarmforge/prompts/<role>.md`, which is a build output — stale
between launches and absent on a bare host.

`SWARMFORGE_SKIP_DAEMON` is deliberately **not** used: it removes handoffd but still
reads and writes the mailboxes, which may themselves be the broken thing.

BL-1025's QA-hat verdict store does not weaken this. The run never calls the
babysitter, never reads its state, and does not depend on it existing — it
appends a file and moves on. The babysitter reads that file later, on its own
schedule, if it runs at all.

## Test suites

| command | covers |
|---|---|
| `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` | assertions over the pure decisions (incl. BL-1023 `bookkeep-plan` / `bookkeep-move-ok?`) |
| `bb swarmforge/scripts/test/expedite_lib_property_runner.bb` | 8 properties × 500 seeded runs, with generator coverage asserted |
| `bb swarmforge/scripts/test/bl1023_bookkeep_property_runner.bb` | BL-1023: bookkeep-plan / move-ok? properties |
| `bash swarmforge/scripts/test/test_bl1023_expedite_bookkeep.sh` | BL-1023: shell fixtures for adopt / refuse / dry-run |
| `bash swarmforge/scripts/test/expedite_prove_nonvacuity.sh` | breaks each invariant; confirms the suite rejects it |
| `bash swarmforge/scripts/test/expedite_mutation_sweep.sh` | Hand-authored mutants over `expedite_lib.bb` (Stryker/Gherkin cannot see `.bb`). **BL-1101:** a skipped anchor (fragment absent) fails the run and names the labels — never `ALL MUTANTS KILLED` / exit 0 without evidence. |
| `bb swarmforge/scripts/test/bounded_run_lib_test_runner.bb` | **BL-1103:** shared `bounded_run_lib.bb` (`run-bounded!`) — setsid/group-kill and no-deref-after-timeout; also used by babysitter ensure. |
| `bash swarmforge/scripts/test/test_expedite_cli.sh` | end to end against a real fixture |
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-782-liveness-probes-scan-whole-process-table.feature <out> specs/pipeline/steps/index.js` | BL-782: root-scoped liveness probes (neighbour decoys ignored; genuine root survivors still detected) |
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-567-*.feature <out> specs/pipeline/steps/expeditorOfflineSingleTicketPipelineSteps.js` | 21 scenarios |
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1023-expeditor-refuses-a-run-ticket-it-cannot-bookkeep.feature <out> specs/pipeline/steps/bl1023ExpediteBookkeepSteps.js` | BL-1023: 6 scenarios |
| `bash swarmforge/scripts/test/test_expedite_qa_verdict_store.sh` | BL-1025: the run writes its QA-hat verdict; `--dry-run` writes none |
| `bash swarmforge/scripts/test/test_is_qa_ancestor_expedite_store.sh` | BL-1025: the shared predicate's reader half, including the fail-closed rows |
| `bb swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb` | BL-1025: both declared invariants, exhaustive over all 32 states |
| `bb swarmforge/scripts/test/bl1024_outstanding_summary_property_runner.bb` | BL-1024: nothing left behind goes unnamed; 400 runs |

`PROPERTY_RUNS` overrides the property run count.

Both mutating scripts back up the working copy and restore from that — they do **not**
`git checkout`, which would destroy uncommitted work in the file under test.

## Known limits

- **Run #1 was human-driven.** The tool cannot have built itself. Its suites pass;
  it has not yet driven a ticket end to end unsupervised. That is the next real test.
- **Stage content is not asserted by the suites.** The driver's contract is that every
  declared gate ran, in order, with evidence captured and no verdict invented. Whether
  a stage's *output* is good belongs to the stage agents.
- **The Gherkin mutation gate is inapplicable** to this feature and to any feature
  without Scenario Outlines: zero mutants can be discovered from a plain `Scenario:`.
  Repo-wide, not specific to this tool. As of BL-638, `run_gherkin_mutation.sh`
  reports this honestly — a zero-mutant run exits `2` with outcome `inapplicable`,
  distinct from a real pass (`0`) or fail (`1`), and does not write a suppressing
  stamp — rather than the prior behavior of `Total 0` reading as an indistinguishable
  clean-sweep pass. The hardener's fallback for an inapplicable feature is a
  hand-authored surgical mutation sweep over the parcel's own changed behavior, the
  same pattern `expedite_mutation_sweep.sh` above already uses for `.bb` code.
