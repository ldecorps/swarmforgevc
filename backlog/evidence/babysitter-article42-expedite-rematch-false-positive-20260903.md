# Babysitter Article 4.2 — a THIRD sub-cause: BL-1025's exemption is keyed on the expedite TIP sha, which the mandatory BL-1144 rematch destroys

Date: 2026-09-03 (Operator, event-driven run). Babysitter escalated two
`pipeline-code-on-main` findings:

- `74f8a405fd` "BL-1375: narrow the entangled-sibling refusal to
  withheld/unapproved siblings, and guard the replayed tree before a
  passenger rides" (single-parent, trailer `By coder.`)
- `76206f8255` "Rematch BL-1375 tip onto current origin/main (BL-1144
  publish-time purity)." (merge, trailer `By QA.`)

Both are **FALSE POSITIVES**. No pipeline code bypassed QA.

This is a NEW sub-cause, distinct from the two already on file:
- `babysitter-article42-union-merge-false-positive-20260903.md` (merge-path
  adjudication: BL-962's byte-identity exemption cannot clear a union merge)
- `coordinator-babysitter-article42-false-positive-20260902.md`
  (`land_step_cli.bb` replay commits carry no `By QA.` trailer)

## Verification (content and provenance, not subjects)

- The flagged content is BL-1375's own: `specs/pipeline/steps/index.js`,
  `specs/pipeline/steps/bl1375ApprovedSiblingsCanLandSteps.js`,
  `extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js`.
- QA ran a full, documented land pass on it and wrote the evidence:
  `backlog/evidence/BL-1375-qa-land-20260903.md` (commit `c6d858ab19`,
  trailer `By QA.`) — `LAND_CLEAN` from `land_step_cli.bb`, clean compile,
  a unit FAIL set diffed byte-for-byte against unmodified `main` (identical,
  standing debt), 7/7 acceptance, 3/3 property invariants, both bb runners
  ALL PASS, and all three `required_wiring` entries confirmed live.
- The expedite run's own QA hat is on file:
  `.swarmforge/expedite-approvals/2026-09.jsonl` →
  `{"ticket":"BL-1375","stage":"QA","approval":true,"verdict":"pass","commit":"c370d1e28a"}`.
- `main == origin/main` at `9857adc22c`.

## Root cause

BL-1025 **did** ship, and correctly: `is_qa_ancestor.sh:182` reads the
expedite-approval store. Run live this pass:

    is_qa_ancestor.sh c370d1e28a -> rc=0  ("has an expedite QA-hat approval on file")
    is_qa_ancestor.sh 74f8a405fd -> rc=1
    is_qa_ancestor.sh 76206f8255 -> rc=1

Two independent reasons the exemption cannot reach the shas that are
actually ON main:

1. **The store records the run's TIP; the sweep charges every commit.**
   Only `c370d1e28a` was ever recorded. `74f8a405fd` is one of that tip's
   own ancestors and was never recorded — so every non-tip commit of every
   expedite run is unexempted *by construction*, not by accident.
2. **The mandatory BL-1144 publish-time rematch changes the sha.** QA cannot
   land a stranded expedite branch onto a moved `origin/main` without
   rematching; the rematch produces `76206f8255`, a sha that by definition
   post-dates and cannot appear in the approval store. The approval's
   identity is destroyed by the very step that is required to publish it.

`swarmforge-QA` (tip `794ebe4426`, 2026-09-03T09:23Z) has not yet merged
`main` forward, so the ancestor predicate also answers "no" for now.

## Minimal correct action taken

None to the commits — the content is correct, wanted and QA-verified;
altering it would be wrong. **The alarm is transient and self-clearing:** it
stops firing as soon as QA merges `main` up into `swarmforge-QA`, so no nudge
was sent and nothing was minted (BL-1025 is already in `backlog/done/`; the
residual gap above is what a successor would have to name, and per
`stamp-off-byte-pin-blocks-its-own-authorized-followup` a successor must
declare `retires:` at mint — that is the specifier's call, not the
Operator's).

Recorded so this is not re-derived a fourth time.

By operator.
