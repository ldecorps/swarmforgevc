# BL-332 QA bounce evidence — 2026-07-14

## 1. Failing command
```
node ./tmp/bl332-repro.mjs
```
(a minimal repro driving the compiled `recreateTopicFromRecord` from
`extension/out/concierge/topicRecreation.js` with a `postMessage` adapter
that always returns `false`, i.e. every send during replay fails)

## 2. Commit hash tested
`3f369658321211ed98ac2712807c129732265e86` (documenter's BL-332 handoff to QA),
merged into QA's worktree at `967caa3c` ("Merge documenter 3f369658 (BL-332)
for QA verification").

## 3. First error excerpt
```
{"result":{"success":true,"topicId":42},"recordTopicIdWasCalled":true}
DEFECT CONFIRMED: recordTopicId was called even though every postMessage failed.
```

## 4. Failure class
`behavior`

## 5. Expected vs observed
Expected: when every `postMessage` during replay fails, `recreateTopicFromRecord`
must return `{ success: false }` and must NOT call `recordTopicId` (the mapping
must never be armed onto a topic silently missing its content) — this exact fix
was already authored by the coder in this same session at commit `19723fe0f87d`
("BL-332 fix: never arm the topic mapping when a replay postMessage fails").
Observed: the commit handed to QA (`3f369658`) contains the PRE-FIX code —
`await adapters.postMessage(...)` results are discarded (both for the header and
every replayed message) and `adapters.recordTopicId(...)` runs unconditionally,
so a total replay failure is reported as `{ success: true }` and the ticket gets
permanently armed to a topic with none of its history.

## Root cause (for the coder, so this isn't re-diagnosed)
This is a lineage-loss defect, not a fresh bug: the hardener bounced BL-332 back
to the coder for exactly this defect (`cb87b581` "Merge hardener 62c7c8b357
(BL-332) for coder rework"), the coder fixed it correctly at `19723fe0`, and a
"reconciled fork" merge chain (`9097dedf` → `09b04e22` → ...) carried that fix
forward — but the branch that actually reached the documenter (`54cb74b8` →
`11768b18` → `967b79a4` → `3f369658`) was built by merging `bd67b514` (BL-332's
state *before* the hardener bounce) together with a *separate* BL-359 hardening
line, never reconciling in the `19723fe0` fix. Confirmed via
`git merge-base --is-ancestor 19723fe0 3f369658` → not an ancestor.
Verify with `git merge-base --is-ancestor <your-new-forward-commit>
19723fe0` — or simply re-merge `19723fe0` (or its tip `09b04e22`) into your
branch — before forwarding again, per the constitution's "Forwarded Commits
Carry Their Lineage" rule.
