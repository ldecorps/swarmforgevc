# BL-233 bounce evidence — 20260710 (QA, slice 4 / final)

## Failing command

No single command fails — every unit test (169/169 files, 2349 tests) and
every acceptance scenario (8/8) passes. The gap is what does NOT exist:

```
find extension/src/tools -iname "*recruiter*"
extension/src/tools/recruiter-discover.ts
```

Only slice 1's discovery CLI exists. There is no equivalent entry point for
acquire, qualify, rank, or recommend, and no end-to-end orchestrator that
chains them together and writes a report.

## Commit hash tested

`f0f383d` (QA's merge of documenter's slice-4 handoff `0a2492dd36`).

## First error excerpt

Not a test failure — a missing deliverable. The ticket's own `Scope:` line
(`backlog/active/BL-233-recruiter-model-scout-role-fit.yaml:70-72`) lists
five components this ticket is supposed to deliver: "discovery adapter,
acquire/secret-store adapter, battery-orchestration, best-value ranker,
report writer." Four of five map cleanly onto the four shipped slices:

- discovery adapter -> `discoverySource.ts` + `recruiter-discover.ts` (slice 1)
- acquire/secret-store adapter -> `acquire.ts` + `secretStore.ts` (slice 2)
- battery-orchestration -> `qualify.ts` + `complianceBatteryGate.ts` (slice 3)
- best-value ranker -> `rank.ts` (slice 4)

**"report writer" has no corresponding module anywhere.** `recommend.ts`
(slice 4) is the closest candidate, but it only builds one
`ConfChangeSuggestion` object for a SINGLE already-computed leaderboard - it
does not discover, acquire, qualify, or rank anything itself, is never
invoked by any CLI, and produces no printed/written report. Nothing in the
codebase chains `discover -> acquire -> qualify -> rank -> recommend`
end-to-end for even one role, let alone "per role" as the ticket's own
Wanted-behavior section describes.

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure - all tests are green precisely
because every scenario tests one already-isolated function against
hand-built fixture data. No scenario, in any of the four slices, drives the
recruiter end-to-end from real (or even faked) discovery input through to a
printed report - each slice's acceptance steps construct their OWN
mid-pipeline fixture data (e.g. slice 4's steps hand-build a
`ScoredCandidate[]` array rather than piping slice 3's real output into
slice 4's function). This is exactly the class of gap BL-149 exists to
catch: individually correct, individually green units with zero live
invocation path.

## Expected vs observed

Expected: per the ticket's own FORM decision ("an out-of-band tool/job -
run on demand or scheduled by the coordinator/operator") and Scope line
(a "report writer" is one of the five things this ticket delivers), the
operator should be able to run ONE thing and get a per-role best-value
report with a suggested `swarmforge.conf --model` line, after all four
slices ("all four slices are now built" per the feature file's own
Background comment) landed.

Observed: the operator can run `node recruiter-discover.js
<candidates-file>` (slice 1) and see a candidate list. There is no way to
acquire access, qualify, rank, or get a recommendation without hand-writing
a Node script that imports `acquireAccess`/`qualifyCandidate`/
`rankForRole`/`suggestConfChange` directly - none of which is a supported
or documented usage, and none of which exists today. The ticket's real-
world deliverable (a usable recruiter) does not exist despite every slice's
own local acceptance criteria passing.

## Suggested fix scope (coder/architect call, not prescribed here)

Some entry point (e.g. `extension/src/tools/recruiter-run.ts`, matching
`recruiter-discover.ts`'s existing "thin presenter, no derivation logic"
posture) that: reads discovered candidates, acquires access for each
(respecting the wall-escalation contract), qualifies each acquired
candidate via the battery, groups by role, ranks each role's compliant
candidates, and prints/writes the combined per-role report with each
role's suggested config line - the actual "report writer" the ticket's own
scope line names. Whether this belongs in slice 4 itself, a small
"slice 5: wire it together" follow-up, or a fifth Gherkin scenario in the
existing feature file driving the full chain end-to-end with faked
discover/acquire/battery seams is a specifier/architect call, not QA's -
flagging that the current state does not satisfy the ticket's own stated
Scope regardless of which shape the fix takes.
