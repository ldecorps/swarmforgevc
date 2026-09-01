# BL-1303: cleaner no-op on a duplicate coder parcel — 2026-08-31

Received a second `git_handoff` from coder (`_001534`, commit `4102c05e0c`,
task `BL-1303-pre-merge-commit-still-doesnt-reach-the-guard`) after already
forwarding the ticket's real fix to architect (`4e3172dc96`, task
`BL-1303-a-feature-on-main-always-has-a-registered-handler`, queued
successfully at 04:33:20Z).

`4102c05e0c` is `Merge architect BL-1303 bounce fbcc7b7712 into coder. By
coder.` — `fbcc7b7712` was already merged into `swarmforge-cleaner` hours
earlier (commit `805387db5c`) and is an ancestor of the parcel already
forwarded to architect. The only new content is one evidence file
(`backlog/evidence/BL-1303-coder-merge-path-20260831.md`), a duplicate
summary of the same remediation already reviewed and forwarded. No new
functional change.

This looks like coder's drain of `_001332` (the `back-all` reverse-hop
merge-only copy of the same bounce) sent as an ordinary forward instead of
handled merge-only per Article 2.4 — a housekeeping artifact, not a second
task.

**Decision (Article 1.9, No-Op Rule):** merged for the record (evidence
file only, no conflicts) but NOT forwarded — sending a second `git_handoff`
for BL-1303 while the real fix is already in flight to architect would
itself be the two-concurrent-chains shape BL-760's guard exists to catch.
Completing this batch item via `done_with_current.sh` with no additional
send.
