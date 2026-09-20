# bl1459DocumenterBriefingTipGuardInvariants.property.test.js — flaky, not deterministic (correcting coder@2's characterization)

Found while verifying BL-1660 (unrelated: BL-1660 touches only the local-
Ollama pack-shape library/test/feature). Coder@2's own evidence
(`backlog/evidence/unowned-red-bl1459-bl1474-property-lane-20260920.md`,
riding along in the same merge) reports this file as "deterministic,
real" — a stale hardcoded literal in a non-vacuity probe (test.js:200)
that no longer matches BL-1459's rewritten guard.

## What I actually found

Ran this file 17 times on my own tree (same commit lineage, HEAD after
merging BL-1660's documenter forward): 16 passed clean, 1 failed — and
the ONE failure I saw was a DIFFERENT assertion than the one coder@2
described:

```
AssertionError: expected refusal for the already-landed date 2090-01-01, got status 0: DOCUMENTER_BRIEFING_TIP_OK
```

(test.js:94, the "already-landed date" property, not test.js:200's
non-vacuity probe coder@2 named). Fast-check draws random inputs each
run; both this property and the one coder@2 found are candidates for a
low-probability generator edge case, not a reliably-reproducing red.

## Disposition

Correcting the record, not disputing that something real may be here:
coder@2's own quoted diff (the test's hardcoded marker string vs. the
guard's current shape) is a legitimate, understandable finding on
inspection even if it doesn't fail on every run — a non-vacuity probe
whose literal is stale can still intermittently pass if the surrounding
property's random inputs don't happen to exercise the vacuous path every
time. My own "already-landed date" failure is a second, separate
candidate, also not confirmed deterministic (1/17).

Neither failure blocks BL-1660 (unrelated file, confirmed no overlap).
No ticket or standing-red register row exists for this file (grepped
before writing this). Reporting as an unowned, flaky (not deterministic)
red for the specifier's own judgment — recommend investigating the
non-vacuity probe's stale literal (coder@2's finding, likely genuine
given it directly names a code shape that demonstrably changed) rather
than treating either single failure as proof of a live guard bug.

By QA.
