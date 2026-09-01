# How to drive one ticket through every gate with the swarm stopped

Use the **expeditor** when the swarm's own machinery is what needs fixing. A defect
in handoffd, the mailboxes, rotation or the coordinator cannot ride the pipeline it
is breaking, so the expeditor walks one ticket through every gate — spec,
implementation, review, hardening, docs, QA — with the whole stack shut down.

It depends on none of that machinery. It reads plain files under git and it
commands the stack's lifecycle, which is the opposite of depending on it.

## Run it

```bash
swarmforge/scripts/expedite.sh BL-123
```

That resolves this repo. Pass an explicit root when you mean another checkout:

```bash
swarmforge/scripts/expedite.sh /path/to/repo BL-123
```

| flag | effect |
|---|---|
| `--dry-run` | plan and print; touches nothing |
| `--no-restart` | skip the final restart phase |
| `--bounce-bound N` | change the per-stage bound (default **3**) |
| `--stage-timeout-ms N` | per-stage budget (default 90 min) |
| `--override` | proceed even though a live swarm could not be stopped |

Start with `--dry-run`. It prints the liveness verdict, what it would park, and
whether the teardown would reach a clean slate — without moving a file.

The stage driver itself is now gated on the flag too (BL-1304): before this
fix, `--dry-run` reached the real stage launcher whenever a run worktree for
the ticket already existed — exactly the state a re-run after a failed
expedite lands in — and executed the whole run for real while still
declining to record it. A dry run now reports the stage chain it would run
and starts nothing, whether or not a worktree survives from an earlier run.

## What happens, in order

**1. Initiation, and it blocks.**

It probes liveness, stops the full stack if anything is up, then **re-probes and
verifies**. It does not trust the stop command's exit code, because that code lies:
`./stop-swarm.sh` has been observed printing `SUCCESS — clean slate` with
`babysitterd` and the Operator agent still running. Process matches are scoped to
the audited project root (BL-782), so a neighbour worktree's swarm does not
look like a survivor of this root.

**Run-ticket bookkeeping is decided here** (BL-1023), before siblings are
parked and before any stage spends. If the run ticket is already in
`backlog/active/`, initiation is ready. If it sits in `paused/` or `hold/` —
the usual specifier output, with no coordinator on an expedited run — it is
**adopted into `active/`** so teardown's `active/` → `done/` move has a source.
If the yaml is missing from `{active,paused,hold}/`, initiation **refuses** and
names the ticket. A dry run plans that decision and writes nothing. See
`docs/how-to/BL-1023-expeditor-refuses-a-run-ticket-it-cannot-bookkeep.md`.

Any *other* ticket sitting in `backlog/active/` is parked to **`backlog/hold/`**
— never `paused/`, which is the promotion queue and would auto-promote an
approved ticket straight back on the next boot. A park record lands in
`.swarmforge/expedite/<BL-id>/park-record.json` with the per-role branch tips, so
whoever resumes that ticket knows exactly where it stood.

If the swarm is live and the stop cannot bring it down, **it refuses and names what
is still alive**. That is unresolved contention: one ticket, one writer.

**2. The stages.**

Each gate gets a fresh non-interactive agent session with that role's prompt
composed on the spot, its model and effort from
`.swarmforge/launch/<role>.claude-settings.json`, working on a dedicated
`expedite/<BL-id>` branch in a worktree the driver creates and owns. Never `main`,
never a role worktree.

A bounce re-enters the target stage carrying the reason. **It does not revert the
branch** — reverting bounced content out of a review branch is a documented cause of
real damage.

**The required_wiring gate runs at the boundary into QA** (BL-1255), the one
place `swarm_handoff.bb`'s own gate would have run had the ticket travelled
by handoff mail instead. It evaluates the same pure predicate a live
documenter→QA `git_handoff` is checked against — never a second, looser
copy — against the run worktree's `HEAD` at that point. An unsatisfiable
`required_wiring:` entry (or a ticket yaml/HEAD the gate cannot read) fails
the run loudly, naming the offending entry, before QA ever sees it; a
ticket with no `required_wiring:` field at all passes untouched.

**3. Exhausting the bound means something.**

The bound is **3**, and hitting it is a quality signal rather than a crash. Three
rounds against one gate says the ticket is probably mis-specified, so the run
reports a **probable spec defect for the specifier**, names the repeated defect
class, and explicitly does not blame the coder. If the three rounds show three
*unrelated* defects it says so instead — that is weaker evidence and it will not
claim a spec defect on it.

Raising the bound is allowed and always recorded in the run record. A default of 3
that everyone quietly raises restores the behaviour the bound exists to reject.

**4. Restart, and it does not block.**

The ticket is **done when QA stamps it and the yaml moves**. Only then does the
restart run, and its failure is loud but never retracts that verdict.

This asymmetry is deliberate: the start path may itself be what you were repairing.
A verdict that depended on a clean restart would report failure on completed work
exactly when a start-path defect exists.

The restart calls `./start-swarm.sh` — the full stack, not `./swarm`, which is
pipeline-only — and reports the delta between the observed live set and the expected
one rather than asserting health. Three outcomes, kept distinct:

| outcome | meaning |
|---|---|
| `ok` | started, live set matched |
| `degraded` | started, came up short — the delta says what is missing |
| `failed` | the start command itself failed |
| `held` | the operator's pause marker was active — the start command never ran (BL-1249) |

**`role-agents` counts roles, not processes (BL-1250).** A launched role
contributes two processes to the table — a `zsh` launcher and a `claude`
agent — so an earlier version of `probe-liveness` that counted matching
processes read a healthy eight-role pack as sixteen against an expected
`:role-agents 8`, reporting `degraded` on every clean restart regardless of
actual health. The probe now groups matching process argvs by role and
counts distinct roles; a role observed only by its own launcher file (the
`zsh` line with no accompanying agent file) is excluded, since the launcher
outlives a dead agent — counting the launcher alone would hide exactly the
half-launch this signal exists to catch. `expected-live-set`'s `8` is
unchanged, and the needle stays root-scoped (BL-782): another swarm on the
same host contributes nothing to the count.

**A hold is not the same as `--no-restart`.** Before running anything, the restart
phase reads `.swarmforge/operator/control-pause.json` — the same marker the BL-1191
restart gate already treats as blocking. If it is active, the outcome is `held`,
never `not-attempted`: `not-attempted` means the *caller* skipped the phase
(`--no-restart`/`--dry-run`); `held` means the *operator* did, through a standing
directive the caller may not even know about. The run report and closing summary
name the marker path so a still-down swarm is never misread as one that came up.
A hold only gates the restart phase — the expeditor still stops the swarm, parks
siblings, and drives the ticket's stages while held; only bringing the stack back
up is refused.

An absent marker never holds. A marker that exists but cannot be read as a
definite "not active" — malformed JSON, truncated, an unparseable `untilMs` —
holds the restart, the same as an explicit `active: true`: doubt fails closed.

Parked tickets are **reported, never re-promoted**. What you parked may be stale
against what the run changed, so promotion stays a human decision.

## Reading a run

Everything lands under `.swarmforge/expedite/<BL-id>/`:

```
run.json              verdict, both halves, bounce history, deferrals
park-record.json      what was parked and the branch tips it was holding
NN-<role>/prompt.md   the exact system prompt that stage received
NN-<role>/task.txt    its task injection
NN-<role>/transcript.jsonl
NN-<role>/verdict.json
```

`run.json`'s `deferred` list names the bookkeeping the run did **not** do — BL topic
records, briefing hooks, board sync — so the next boot can see what was skipped
instead of inferring it.

### Read the OUTSTANDING block before you walk away

The last thing every run prints is what it left for someone else, and who picks
it up:

```
expedite OUTSTANDING - this run left work for someone else:
expedite   the parked tickets:
expedite     BL-586, BL-1012  held in backlog/hold/
expedite     owner: a human - Article 3.1 makes backlog/hold/ human-held ...
expedite   the uncommitted backlog moves:
expedite     backlog/active/ -> backlog/hold/  (BL-586)
expedite     owner: whoever next commits in the master checkout ...
```

**Two things there need you, not the swarm.** The parked tickets sit in
`backlog/hold/`, which Article 3.1 forbids the coordinator promoting from — so
if you do not move them back, `active/` can stay empty and the pipeline idles
(this is what happened on 2026-08-21). And the backlog moves are **staged, not
committed**, in the shared master checkout: commit them deliberately, or the
next role to commit anything there sweeps them into an unrelated commit.

It prints on every ending, including a failed restart and each of the
pre-flight refusals below — which is exactly when it matters, since a
refusal fires after tickets are already parked and never reaches the run's
own tail. `nothing outstanding` means there is genuinely nothing, and a
`--dry-run` always says that, because it changed nothing.

## Things it will not do

Each of these is a **handover**, not a drop — the closing summary names the
owner of the two that leave state behind.

It does not push. Publishing local `main` is your call on the next boot.

It does not promote a *next* ticket (one ticket, one run). It **does** adopt
the run ticket itself from `paused/`/`hold/` into `active/` when needed
(BL-1023) — that is run bookkeeping, not queue promotion.

It does not write a BL topic record or touch the briefing. Those need the front-desk
machinery it exists to work without.

It does not commit the backlog moves it made, and it does not restore what it
parked. Both are yours — see the OUTSTANDING block above.

## When it refuses

| message | what to do |
|---|---|
| `REFUSE stop command carries a forbidden flag: <flag> (in: <command>)` | never pass `--sweep-inbox`, `--reset-worktrees` or `--full`: they archive the very parcels a parked ticket needs to resume |
| `REFUSE stop command could not be read as a command line, so it is refused rather than admitted: <command>` | simplify the configured stop command (`EXPEDITE_STOP_CMD`) to a plain line the guard can read — it refuses anything it cannot tokenize with confidence (an unbalanced quote, a `$var`/`` `cmd` `` expansion) rather than risk admitting a flag it missed |
| `REFUSE run ticket <id> was not found in backlog/{active,paused,hold}/` (or is in a folder it cannot adopt) | file or restore the yaml under one of those folders, then re-run — decided before stages spend (BL-1023) |
| `REFUSE teardown did not reach a clean slate: <names>` | stop the named processes by hand, then re-run. `./stop-swarm.sh` misses `babysitterd` and the Operator agent — see BL-637 |
| `REFUSE could not create the run worktree` | remove the stale worktree, or delete the branch, then re-run |
| `EXHAUSTED … probable-spec-defect` | route the ticket to the specifier with the named defect class; do not re-run the coder |
| `REFUSE required-wiring-gate <stage> -> QA` | a `required_wiring:` entry could not be matched at the run worktree's `HEAD` (or the check itself could not complete) — fix the entry or the cited path and re-run; never treat the run as passed |

The two stop-command `REFUSE` rows above fire before anything is parked
(BL-1030), so there is nothing staged to check — the OUTSTANDING block says
`no tickets are held`. The teardown and worktree-creation rows still fire
after siblings are already parked: check OUTSTANDING before you fix the
refusal and re-run, since one may already be staged from before it fired.
| `stage-timeout` | the stage was killed at its budget, along with everything it spawned. Read that stage's `transcript.jsonl` |

## Why a stage timeout is not optional

By stopping the stack, the expeditor kills the babysitter and the Operator — the two
processes that would otherwise notice it wedging. **It has deliberately killed its
own watchdog**, so it observes itself: each stage is bounded and the whole process
group is killed on overrun, not just the direct child.

The runner itself lives in `swarmforge/scripts/bounded_run_lib.bb` (BL-1103),
shared with babysitter's ensure path — `setsid` + group kill and file-backed
stdio so a timeout never blocks on a surviving grandchild's pipe.

## Verifying it still works

```bash
bb  swarmforge/scripts/test/expedite_lib_test_runner.bb       # pure decisions (incl. BL-1023 bookkeep-plan)
bb  swarmforge/scripts/test/expedite_lib_property_runner.bb   # 8 properties x 500
bb  swarmforge/scripts/test/bl1023_bookkeep_property_runner.bb  # BL-1023 bookkeep properties
bash swarmforge/scripts/test/test_bl1023_expedite_bookkeep.sh # BL-1023 shell fixtures
bash swarmforge/scripts/test/expedite_prove_nonvacuity.sh     # the properties can fail
bash swarmforge/scripts/test/expedite_mutation_sweep.sh       # mutants; skipped anchors fail (BL-1101)
bb  swarmforge/scripts/test/bounded_run_lib_test_runner.bb    # shared wall-clock runner (BL-1103)
bash swarmforge/scripts/test/test_expedite_cli.sh             # end-to-end fixture
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-567-expeditor-offline-single-ticket-pipeline.feature \
  /tmp/aps-out specs/pipeline/steps/expeditorOfflineSingleTicketPipelineSteps.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1023-expeditor-refuses-a-run-ticket-it-cannot-bookkeep.feature \
  /tmp/aps-out specs/pipeline/steps/bl1023ExpediteBookkeepSteps.js
```

`expedite_prove_nonvacuity.sh` is worth running whenever you change the lib: it
breaks each invariant in turn and confirms the suite rejects it. A property suite
that cannot fail is decoration.

`expedite_mutation_sweep.sh` (BL-1101) fails the run if any mutant's anchor is
missing after a rewrite — skipped labels are listed like survivors. Do not treat
`ALL MUTANTS KILLED` as meaningful unless `skipped=0`.
