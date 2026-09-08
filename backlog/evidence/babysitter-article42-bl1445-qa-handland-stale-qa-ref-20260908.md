# Article 4.2 escalation `pipeline-code-on-main-5df134812c` — FALSE POSITIVE (operator adjudication, 2026-09-08T03:57Z)

**Subject:** `pipeline-code-on-main-5df134812c90829501fb5f257c3b8ed2e686ae54`
**Commit:** `5df134812c` "BL-1445: tip-pure replay onto origin/main (BL-1241 land-step remedy)"
**Flagged pipeline files:**
`extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js`,
`specs/pipeline/steps/bl1445StaffingGateWiringTestDecidesOverrideSteps.js`

## Verdict: false positive of the known ancestry-only class. NO action taken.

`is_qa_ancestor.sh 5df134812c` exits **1** with:

```
not approved: 5df134812c has a land-replay record naming source d3490a7a95,
which is not itself approved (.swarmforge/land-approvals/2026-09.jsonl)
```

That exit 1 is **not** an unapproved land. QA did record the land-approval:

```
.swarmforge/land-approvals/2026-09.jsonl:99
{"at":"2026-09-08T03:55:48Z","ticket":"BL-1445","commit":"5df134812c","source":"d3490a7a95"}
```

The predicate fails only because the named source `d3490a7a95`
("Merge remote-tracking branch 'origin/main' into bl1471-landing") is **not yet an
ancestor of the `swarmforge-QA` ref** — that ref is stale at `27460ebd8b`
(BL-1471 QA review pass evidence, 03:18:58Z), 37 minutes behind the land.
This is the standing "Article 4.2 predicate is ancestry-only, QA hand-land always
flags" pattern: it self-heals on the next main→QA merge.

## The bounce question, checked explicitly (BL-952)

There is a real bounce on file for this ticket, so this was NOT waved through on
the ancestry argument alone:

```
.swarmforge/bounces/2026-09.jsonl
{"ticket":"BL-1445","producingRole":"coder","ticketType":"defect",
 "failureClass":"behavior","commit":"5ebca5d530","by":"architect",
 "at":"2026-09-08T03:05:38Z"}
```

`5ebca5d530` is the coder's original BL-1445 commit, bounced by the architect
(D1: the scenario-02 source-detection regex is blind to the `source "$SWARMFORGE_SH"`
idiom — see `backlog/evidence/BL-1445-architect-bounce-20260908.md`, which landed
inside `5df134812c` itself).

**The bounced content did not ride onto main.** Content hashes of the two flagged
pipeline files:

| file | on main (`5df134812c`) | source (`d3490a7a95`) | bounced (`5ebca5d530`) |
|---|---|---|---|
| `...OverrideInvariants.property.test.js` | `f63505467e` | `f63505467e` | `5c70d9c0cf` |
| `...OverrideSteps.js` | `e2db0808fd` | `e2db0808fd` | `1880d1e210` |

Landed content is byte-identical to the approved source and **different** from the
bounced commit — i.e. it is the post-bounce rework, exactly what BL-952 is meant to
let through. `5ebca5d530` itself is not an ancestor of main.

## Record wart worth knowing (not itself a violation)

The line above it in the same store is an earlier replay attempt whose source is the
**bounced** sha:

```
:98 {"at":"2026-09-08T03:53:46Z","ticket":"BL-1445","commit":"77dd02958b","source":"5ebca5d530"}
```

`77dd02958b` is **not** on main (not an ancestor), so nothing bounced was published —
but a land-approval row naming a bounced source is a record-hygiene defect in the land
step's replay bookkeeping. Noted, not ticketed by the operator.

## QA state at adjudication time

QA is mid-close-out, not idle: pane spinner `Frosting… (10m 48s)`, it had just
committed `0529a715ed` and was composing the merge-up broadcast
`type: note … "BL-1445 QA-approved 5df134812c - merge your branch up to QA's"`
to coder/cleaner/architect/hardender/documenter. The merge that makes
`is_qa_ancestor.sh` exit 0 is the very thing in flight.

## Operator action

**None.** No nudge to QA (it is actively completing the close-out), no waive, no
relaunch, no code/backlog edit. If a repeat delivery of this same subject arrives
*after* `swarmforge-QA` has advanced past `d3490a7a95` and the predicate still exits 1,
that is a genuinely different fact and should be re-derived then.

Timestamps: host is UTC+1; every value here is UTC (`date -u`; git author
`2026-09-08T04:55:42+01:00` → `03:55:42Z`).

## Re-fire 2026-09-08T04:28Z (operator run 2)

Same subject `pipeline-code-on-main-5df134812c...` re-delivered. NOT re-derived
(per operator prompt: repeat delivery of a subject this file already names).
State unchanged: `is_qa_ancestor.sh 5df134812c...` still exits 1 —
"land-replay record naming source d3490a7a95, which is not itself approved" —
because `swarmforge-QA` is STILL at 27460ebd8b (03:18:58Z), i.e. the ref never
advanced past d3490a7a95. QA was mid-close-out at 04:01Z (composing the merge-up
broadcast) when the supervisor alarm-and-halt at 04:27:52Z killed the whole
swarm; QA's inbox came back empty (new=0 in_process=0), so that broadcast was
lost with the pane. The close-out is therefore UNRECORDED and will keep
re-firing until QA advances swarmforge-QA past d3490a7a95.

Action taken: ONE queued note to QA (no waive, no relaunch, no operator merge):
`50_20260908T043056Z_007400_from_coordinator_to_QA.handoff` —
"BL-1445 landed 5df134812c: merge main into swarmforge-QA to clear Art 4.2".

## Re-fire 2026-09-08T04:38Z (operator run 3) — full commit-chain, note 007400 lost

Ten new `pipeline-code-on-main-<sha>` findings delivered, one per commit in the
BL-1445 pipeline lineage (`5ebca5d530` .. `94afddfff2`, the coder→cleaner→
architect→hardender→documenter→QA merge chain). All ten are ancestors of
`d3490a7a95` (confirmed via `git merge-base --is-ancestor`), which is itself an
ancestor of current `main` (`c90bd34027`) — this is the SAME already-approved
land re-surfacing commit-by-commit, not a new incident. `is_qa_ancestor.sh` on
both `5df134812c` and `d3490a7a95` still exits 1; `swarmforge-QA` is still
pinned at `27460ebd8b` (unchanged since 03:18:58Z).

The note queued in run 2 (`...007400...`) never reached QA: it is absent from
`.swarmforge/handoffs/QA/` entirely (new/in_process/completed all checked) —
lost in the 04:27:52Z supervisor alarm-and-halt total-swarm-death (see
[[handoffd-supervisor-alarm-halt-silently-kills-whole-swarm]]), same as the
merge-up broadcast QA itself was composing at the time. QA's inbox is now
empty (idle, not stuck on another parcel), so this is safe to resend.

Action taken: resent the nudge —
`50_20260908T043925Z_007403_from_coordinator_to_QA.handoff` —
"BL-1445 landed 5df134812c: merge main into QA to clear Art 4.2". No waive, no
relaunch, no operator-side merge. Once QA merges `main` (or otherwise advances
`swarmforge-QA` past `d3490a7a95`), the predicate self-heals for the whole
chain at once — no per-commit waive needed.
