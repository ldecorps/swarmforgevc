# Article 4.2 escalation `pipeline-code-on-main-a7c3ef9974` — FALSE POSITIVE (operator adjudication)

- **Adjudicated:** 2026-09-07T18:09Z (UTC), by the operator.
- **Subject:** `pipeline-code-on-main-a7c3ef9974a48922c0b31d31d6be02b2820ab774`
- **Claim:** merge `a7c3ef9974` "Merge remote-tracking branch 'origin/main'" touches
  `specs/pipeline/steps/bl1463EscalatingLandStepNamesSiblingSteps.js` outside QA.

## Verdict: no unapproved pipeline code landed. Close.

## Evidence

1. **The merge introduces nothing of its own.** `git log -1 --cc a7c3ef9974` produces an
   EMPTY combined diff — it is a trivial two-parent union (`b1eda957a8` local main,
   `b63b3c816f` origin/main), not an evil merge. The flagged file is byte-identical in
   the merge and in parent `b63b3c816f` (blob `850fa3432e`); it is simply absent from the
   other parent, which is what makes the per-commit scan attribute it to the merge.
2. **The file's real introducing commit is QA-approved.** It was added by
   `a90e80a669` "BL-1463: tip-pure replay onto origin/main (hand-built — BL-1472/1473/1474
   block the automated land step)", authored *By QA.*, and
   `swarmforge/scripts/is_qa_ancestor.sh a90e80a669` exits **0**:
   `approved: a90e80a669 is a land-step replay of approved source adfc35e0c8`
   (`.swarmforge/land-approvals/2026-09.jsonl`, recorded as `a90e80a669` — BL-1334).
   `a90e80a669` is an ancestor of `b63b3c816f`, which is an ancestor of the merge.
3. **Why it still flagged.** The Article 4.2 predicate is ancestry-only/per-commit: it does
   not credit a main-sync merge that merely carries already-approved code forward, so
   `is_qa_ancestor.sh` returns 1 for `a7c3ef9974` (and for both parents) while returning 0
   for the commit that actually authored the code. Same known shape as
   `babysitter-article42-*-tip-pure-land-false-positive-*` and
   `...-union-merge-false-positive-20260903.md`.

## Close-out recorded here so this subject does not re-fire un-adjudicated

The land-approval that stops the re-fire for this hand-built land already exists
(`is_qa_ancestor.sh a90e80a669` → 0). No waive is needed and none was recorded; the
operator took no code action. Swarm health at adjudication time: 9 role panes live,
handoffd heartbeat 2026-09-07T18:08:35Z (28s fresh), HEAD advancing (merge authored
18:07:34Z), backlog active=5 / paused=94 / done=708.
