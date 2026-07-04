source: hardener finding during BL-093 hardening, 2026-07-04 (coordinator relay)

Observation: while hardening BL-093, hardener confirmed every function it
touched is now at or under the complexity threshold (6), except two
pre-existing, untouched functions that were already over it before BL-093:
readSwarmRoles and runCommand. Correctly out of scope for BL-093 (neither
was meaningfully changed by that parcel; bundling an unrelated complexity
fix into it would violate the "no unrelated changes" guardrail) — but as a
result nothing currently tracks these two as debt to actually fix later.

Ask: specifier to write a small, scoped ticket to bring readSwarmRoles and
runCommand's complexity down to threshold, with regression tests through
the existing seams. Locate both functions and confirm current complexity/
CRAP numbers as part of speccing (not assumed here). Scope should stay
narrow — refactor for complexity only, no behavior change.
