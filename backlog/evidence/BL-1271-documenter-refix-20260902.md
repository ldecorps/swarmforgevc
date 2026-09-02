# BL-1271 — documenter pass (refix), 20260902

Received: hardener commit `06b273043d` (BL-1271: hardener re-pass after QA
bounce), forwarded from architect's re-pass `c96c3570b6` on top of
cleaner's rework `03b3501b6f`.

## Bounce inventory travels (Article 4.4)

The one prior bounce (`backlog/evidence/BL-1271-qa-bounce-20260902.md`,
D1, blamed `cleaner`): the cleaner's dedup consolidation had deleted/
renamed the two pre-existing-duplicate assertion names, violating the
ticket's own invariant 2 ("every assertion name present before this ticket
is still present after it").

**Verified fixed, not merely claimed fixed.** Grepped the merged tree for
both original assertion-name strings:

```
$ grep -n '"top-expedited-paused-candidate-08 (BL-900): called with no epic-index (1-arity) still ranks by own priority, unchanged"' swarmforge/scripts/test/dispatch_gap_test_runner.bb
556:(assert= "top-expedited-paused-candidate-08 (BL-900): called with no epic-index (1-arity) still ranks by own priority, unchanged"
$ grep -n '"top-expedited-paused-candidate: priority breaks ties among multiple expedited candidates"' swarmforge/scripts/test/dispatch_gap_test_runner.bb
562:(assert= "top-expedited-paused-candidate: priority breaks ties among multiple expedited candidates"
```

Both original names present. D1 is closed — no open item remains blamed on
documenter or any other role for this ticket.

## Review inventory

- No other open bounce items exist (`bounce_history` on the ticket YAML
  lists exactly this one entry).
- The rework is scoped identically to the original pass: only
  `swarmforge/scripts/test/dispatch_gap_test_runner.bb` changed
  (restoring both assertion forms) — no production `.bb` logic touched, no
  `promotion_gates_lib.bb` change.
- Documentation decision from the first documenter pass
  (`backlog/evidence/BL-1271-documenter-20260902.md`) still holds: purely
  internal test-fixture repair, no production behavior changed, nothing in
  `docs/` describes this suite, no diagram depicts it. Re-grepped `docs/`
  for `dispatch_gap_test_runner`/`BL-1271`/`BL-900` — still nothing to
  correct.

## Verdict

NONE — no documenter-domain defect, no doc change warranted. Forwarding
the received commit `06b273043d` unchanged (via this evidence-recording
merge commit).

By documenter.
