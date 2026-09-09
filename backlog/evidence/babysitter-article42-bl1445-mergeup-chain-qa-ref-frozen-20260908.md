# Article 4.2 escalation storm — BL-1445 merge-up chain (10 subjects), 2026-09-08T04:40Z

Operator adjudication. **All ten are the same false positive.** No waive, no
relaunch, no code/backlog edit.

## Subjects delivered this run

`pipeline-code-on-main-<sha>` for: `94afddfff2`, `ccc88f9d0f`, `ff7b9f4b9b`,
`1175f22eb0`, `03b6f233f2`, `6ea7786af1`, `4238936086`, `1fa5e1a35a`,
`cfa1994b98`, `5ebca5d530` — every commit of the BL-1445 coder→cleaner→
architect→hardender→documenter→QA merge-up chain that touches
`extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js`
and/or `specs/pipeline/steps/bl1445StaffingGateWiringTestDecidesOverrideSteps.js`.

These are NOT new lands. They are the ancestry of the single BL-1445 land
`5df134812c`, already ruled a false positive twice today in
`babysitter-article42-bl1445-orphaned-source-false-positive-20260908.md` and
`babysitter-article42-bl1445-qa-handland-stale-qa-ref-20260908.md`.

## Root cause (unchanged, now producing 10 subjects per sweep instead of 1)

`swarmforge-QA` is **frozen at `27460ebd8b`** ("BL-1471: QA review pass evidence
(NONE)", 2026-09-08T03:18:58Z). `is_qa_ancestor.sh` tests ancestry against that
ref (lines 309/382). Every chain commit therefore reports `qa-anc=NO`,
`on-main=YES`, and the sweep flags each one separately.

Verified this pass: `is_qa_ancestor.sh 94afddfff28a...` → **exit 1**.

## The one NEW fact vs. the earlier adjudications — checked, still clean

The earlier write-up rested partly on "the bounced coder commit `5ebca5d530` is
not an ancestor of main". **That is no longer true** — the merge-up chain carried
it onto main as ancestry. Content was re-checked directly and the bounced content
did **not** ride along:

| file | bounced `5ebca5d530` | `main` (`c90bd34027`) | approved land `5df134812c` |
|---|---|---|---|
| `...OverrideInvariants.property.test.js` | `61baedcfe5` | `937b465105` | `937b465105` |
| `...OverrideSteps.js` | `d22b4b0b08` | `ecefd00e54` | `ecefd00e54` |

Main's tree is byte-identical to the QA-approved land and different from the
bounced blob — the post-bounce rework, exactly what BL-952 permits. Bounce on
file: `{"ticket":"BL-1445","commit":"5ebca5d530","by":"architect",
"at":"2026-09-08T03:05:38Z"}` — it names the reworked-away commit, not main's
content. **No unreviewed content is on main.**

## Why the previous run's nudge did not take (this is the actionable part)

Operator queued `50_20260908T043056Z_007400_from_coordinator_to_QA.handoff` at
04:30:56Z reading *"merge main into **swarmforge-QA** to clear Art 4.2"*.
It reached QA at 04:39:25Z as `007403`, **reworded by the coordinator** to
*"merge main into **QA**"* — the ref name dropped.

QA acted on the reworded text against the wrong object and completed the parcel:

```
● Already fully synced with origin/main — nothing to merge. Completing the parcel.
● QA's worktree is already at origin/main tip (c90bd34027) — no merge was needed.
  Queue is empty (NO_TASK).                                   (done 5:39 AM = 04:39Z)
```

QA's **worktree** is checked out on `bl1471-landing` at `c90bd34027` — genuinely
current. Its **branch ref `swarmforge-QA`** is a different object and is the one
the predicate reads. "Worktree synced with origin/main" ≠ "swarmforge-QA
advanced". The instruction was satisfiable against the wrong target, so QA
truthfully reported success while the ref stayed frozen.

**Operator notes are not delivered verbatim** — the coordinator rewords them.
A second identically-shaped nudge would be reworded the same way and fail the
same way, so none was sent (operator prompt: a nudge that does not take escalates
to the human rather than being repeated blindly).

## Swarm health at adjudication time — GREEN

9/9 panes alive; `handoffd.heartbeat` `2026-09-08T04:38:03Z` vs now
`2026-09-08T04:39:31Z` (fresh); daemon sweeps cycling normally.
A **planned control pause** is active — `.swarmforge/operator/control-pause.json`
`{"active":true,"untilMs":1788843600000}` = expires `2026-09-08T05:00:00Z` — so
`poll-skip-paused delivery frozen while a pause is active` in the daemon log is
the expected closing-ceremony state, not a fault. `sync-deliver` still works
(007403 landed during it). Not a stall.

## Operator action

**None inside the swarm.** One NOTIFY to the human (SUP-17) with the above,
because this re-fires every sweep, self-heal has not occurred in ~80 minutes, and
the one corrective nudge available to the operator was defeated by the reword.

The fix is a single git operation owned by QA, not the operator: advance the
`swarmforge-QA` **branch ref** past `main` (`c90bd34027`). That clears all ten
subjects at once, plus `5df134812c`, without any waive or record change.

Timestamps: host is UTC+1; every value here is UTC (`date -u`).
