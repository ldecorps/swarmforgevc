# BL-967 — pre-QA ancestry block adjudicated as a BL-972 false positive

**Recorded by**: documenter, 2026-08-20, at the documenter→QA forward.
**Audience**: QA at BL-967's gate.

## The block

`swarm_handoff.sh` refused the forward (exit 2):

```
PRE_QA_GATE_FAIL ancestry BL-967 5c8b0835f8 stranded on swarm/coder
PRE_QA_GATE_FAIL ancestry BL-967 5c8b0835f8 stranded on swarmforge-architect
PRE_QA_GATE_FAIL ancestry BL-967 5c8b0835f8 stranded on swarmforge-cleaner
```

One candidate, three branches. No other commit was named.

## Why it is a false positive

`5c8b0835f8` is a **BL-966** commit, not a BL-967 commit. Its subject names
BL-967 only because BL-966 *consumes* this parcel's new chokepoint:

> "…`git rev-parse --git-common-dir` (through the BL-967 daemon-cycle-guard
> chokepoint, memoized per root: the lib runs inside handoffd's poll cycle)…"

That is a dependency statement, not carried work. The gate's candidacy filter
is a subject-line token match (`message-references-ticket?` in
`pre_qa_gate_gather_lib.bb`), so a commit that merely *names* BL-967 becomes a
dropped-work candidate.

**Path evidence — the two parcels are disjoint apart from the append-only
registry every ticket touches:**

| `5c8b0835f8` touches | in BL-967's parcel? |
|---|---|
| `swarmforge/scripts/backlog_depth_lib.bb` | no |
| `swarmforge/scripts/effective_backlog_depth_cli.bb` | no |
| `swarmforge/scripts/test/backlog_depth_test_runner.bb` | no |
| `swarmforge/scripts/test/bl966_depth_identity_root_property_runner.bb` | no |
| `swarmforge/scripts/test/test_effective_backlog_depth_cli.sh` | no |
| `specs/pipeline/steps/bl966DepthSameAnswerSteps.js` | no |
| `specs/pipeline/steps/index.js` | **yes** — the append-only step registry, touched by every ticket |

It touches **no** file this parcel touches: not `daemon_cycle_guard_lib.bb`,
not `handoffd.bb`, not `handoff_lib.bb`, none of the guard runners. There is no
BL-967 content in it to drop.

## The governing rule

`engineering.prompt` (landed 2026-08-20) states it directly:

> A gate blocks on dropped-work EVIDENCE (touched paths/diff content), never on
> a ticket id merely named in a commit subject (4 QA blocks in one day;
> BL-972).

BL-972 is minted for the enforcement fix and is `paused` pending human
approval; the coordinator's hold note records that the accepted rule is binding
while enforcement is unbuilt. Under that rule this block is invalid, and the
path evidence above is exactly the evidence the rule asks for.

## What was done

`5c8b0835f8` is declared in this ticket's `abandoned_commits` — the only
declared escape the gate offers (BL-972 names it as the working workaround) —
in **flow style**, with the rationale in `notes:` rather than inline, because a
comment line inside a block list voids the field and reads to the gate as
absent (BL-935's own two-commit fix).

Read that declaration as *suppressing a known-false candidate*, **not** as a
claim that BL-967 work was dropped. `5c8b0835f8` is live, correct BL-966 work
in flight on its own parcel; nothing about it should be reverted or re-merged
on BL-967's account, and it needs no action from QA beyond not blocking on it.

— By documenter (BL-967), 2026-08-20.
