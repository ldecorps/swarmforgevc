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
| `--stage-timeout-ms` | integer | `2700000` (45 min) | Per-stage wall-clock budget. On overrun the stage's whole process group is killed. |

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
| `restart` | object | `{outcome, exit, error, live-set-delta}` |
| `restart-ok?` | bool | true for `ok` and `not-attempted` only |
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
| `finished-at-ms` | int | completion timestamp |

`deferred` is always populated when applicable, so a next boot sees what was skipped
rather than inferring it. Current entries: `bl-topic-record`, `briefing-hooks`,
`pipeline-stage-sync`.

### `park-record.json`

`{parked-at-ms, destination, tickets, role-branch-tips, why}`. `destination` is always
`hold`.

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

## Order of operations

1. Probe liveness.
2. Park every other ticket in `backlog/active/` to `backlog/hold/`; write the park record.
3. Run the stop command.
4. **Re-probe and verify.** The stop's exit code is not trusted.
5. Refuse if not clean (unless `--override`).
6. Create `expedite/<BL-id>` and its worktree.
7. Walk the stage chain.
8. Move the ticket yaml to `backlog/done/` on success.
9. Restart — reported, never blocking.

## Refusals

| message | cause | remedy |
|---|---|---|
| `REFUSE teardown did not reach a clean slate: <names>` | the swarm is live and the stop could not clear it | stop the named processes by hand; `./stop-swarm.sh` misses `babysitterd` and the Operator agent |
| `REFUSE stop command carries a forbidden flag` | `--sweep-inbox`, `--reset-worktrees` or `--full` | never pass these: they archive the parcels a parked ticket needs to resume |
| `REFUSE could not create the run worktree` | branch or directory conflict | remove the stale worktree, or delete the branch |
| `EXHAUSTED {...:probable-spec-defect...}` | the bounce bound was reached on one repeating class | route to the specifier with the named class; do not re-run the coder |
| `stage-timeout` | a stage exceeded its budget | the stage and its whole process group were killed; read that stage's `transcript.jsonl` |

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
| `EXPEDITE_PROBE_FILE` | JSON probe result instead of probing live processes |
| `EXPEDITE_STAGE_RUNNER` | a script called per stage instead of spawning `claude -p` |
| `EXPEDITE_NOW_MS` | pins the clock |

`EXPEDITE_STAGE_RUNNER` receives
`<role> <ticket> <prompt-file> <verdict-file> <transcript>` and is expected to write
JSON to `<verdict-file>`.

## What it deliberately does not do

- **No push.** Publishing local `main` is a human decision on the next boot.
- **No promotion.** One ticket, one run; it has no queue.
- **No BL topic record, no briefing hook, no board sync.** Those need front-desk
  machinery it exists to work without. All three appear in `deferred`.
- **No revert on bounce.**
- **No commit on `main`** outside the QA stage's own merge.
- **No role worktree is touched.**

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

## Test suites

| command | covers |
|---|---|
| `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` | 110 assertions over the pure decisions |
| `bb swarmforge/scripts/test/expedite_lib_property_runner.bb` | 8 properties × 500 seeded runs, with generator coverage asserted |
| `bash swarmforge/scripts/test/expedite_prove_nonvacuity.sh` | breaks each invariant; confirms the suite rejects it |
| `bash swarmforge/scripts/test/expedite_mutation_sweep.sh` | 41 mutants; Stryker and the Gherkin mutator cannot see `.bb` |
| `bash swarmforge/scripts/test/test_expedite_cli.sh` | 58 assertions end to end against a real fixture |
| `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-567-*.feature <out> specs/pipeline/steps/expeditorOfflineSingleTicketPipelineSteps.js` | 21 scenarios |

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
