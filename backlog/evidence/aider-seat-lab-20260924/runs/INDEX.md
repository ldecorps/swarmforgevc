# Runs — validity index (see ../../aider-seat-lab-20260924.md for the table)

Valid: every run folder below EXCEPT the three listed as invalid.
S5d (20260924T000421) was stopped at turn 11 by the operator, so it has no
scorecard; its llm.log and git-log.txt are the record.

Invalid (harness bugs, kept for honesty):
- 20260923T235233-S1a-stale-note, 20260923T235433-S2a-qa-approval: the idle
  detector did not recognise aider's `ask>` prompt (startup-timeout).
- 20260924T002945-S6-driver-whole: the fixture's old tests were already green,
  so the driver "handed off" an UNCHANGED tree in 96 s. This is why the gate
  now needs a red→green acceptance test + a model commit + an untouched spec.

Not copied: two S6d runs that were stopped at startup while the batch was
reordered (no model turn).

"turn-cap" after a completed sequence (S1b, S3b, S1c, S3c) is the harness's
NO_TASK stop bug, fixed after round 3. "steps" is the verdict.
