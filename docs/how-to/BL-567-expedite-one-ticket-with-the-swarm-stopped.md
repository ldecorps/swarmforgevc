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
| `--stage-timeout-ms N` | per-stage budget (default 45 min) |
| `--override` | proceed even though a live swarm could not be stopped |

Start with `--dry-run`. It prints the liveness verdict, what it would park, and
whether the teardown would reach a clean slate — without moving a file.

## What happens, in order

**1. Initiation, and it blocks.**

It probes liveness, stops the full stack if anything is up, then **re-probes and
verifies**. It does not trust the stop command's exit code, because that code lies:
`./stop-swarm.sh` has been observed printing `SUCCESS — clean slate` with
`babysitterd` and the Operator agent still running.

Any ticket sitting in `backlog/active/` is parked to **`backlog/hold/`** — never
`paused/`, which is the promotion queue and would auto-promote an approved ticket
straight back on the next boot. A park record lands in
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

## Things it will not do

It does not push. Publishing local `main` is your call on the next boot.

It does not promote a next ticket. One ticket, one run.

It does not write a BL topic record or touch the briefing. Those need the front-desk
machinery it exists to work without.

## When it refuses

| message | what to do |
|---|---|
| `REFUSE teardown did not reach a clean slate: <names>` | stop the named processes by hand, then re-run. `./stop-swarm.sh` misses `babysitterd` and the Operator agent — see BL-637 |
| `REFUSE stop command carries a forbidden flag` | never pass `--sweep-inbox`, `--reset-worktrees` or `--full`: they archive the very parcels a parked ticket needs to resume |
| `EXHAUSTED … probable-spec-defect` | route the ticket to the specifier with the named defect class; do not re-run the coder |
| `stage-timeout` | the stage was killed at its budget, along with everything it spawned. Read that stage's `transcript.jsonl` |

## Why a stage timeout is not optional

By stopping the stack, the expeditor kills the babysitter and the Operator — the two
processes that would otherwise notice it wedging. **It has deliberately killed its
own watchdog**, so it observes itself: each stage is bounded and the whole process
group is killed on overrun, not just the direct child.

## Verifying it still works

```bash
bb  swarmforge/scripts/test/expedite_lib_test_runner.bb       # 100 assertions
bb  swarmforge/scripts/test/expedite_lib_property_runner.bb   # 8 properties x 500
bash swarmforge/scripts/test/expedite_prove_nonvacuity.sh     # the properties can fail
bash swarmforge/scripts/test/expedite_mutation_sweep.sh       # 41 mutants
bash swarmforge/scripts/test/test_expedite_cli.sh             # 53 assertions, real fixture
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-567-expeditor-offline-single-ticket-pipeline.feature \
  /tmp/aps-out specs/pipeline/steps/expeditorOfflineSingleTicketPipelineSteps.js
```

`expedite_prove_nonvacuity.sh` is worth running whenever you change the lib: it
breaks each invariant in turn and confirms the suite rejects it. A property suite
that cannot fail is decoration.
