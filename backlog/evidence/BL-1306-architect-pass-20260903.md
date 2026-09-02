# BL-1306 — architect pass, 2026-09-03

Reviewed cleaner commit `8d6c6851ab`, forwarding coder's `e9698c027a`
("derive the audit lookup key from the stored candidate, after routing") —
a defect in the same handoff-audit machinery I use every task in this
session.

## The fix, verified against the ticket's directive
- `swarm_handoff.bb::invocation-fingerprint` no longer independently
  constructs a lookup key — it is `(dissoc (audit-candidate ...) :version)`,
  structurally eliminating the two-construction drift (confirmed by
  reading `swarm_handoff.bb:874-895`).
- The invalidation call site moved inside the `let` that computes `routed`
  (confirmed at `swarm_handoff.bb:1114-1121`), and both the lookup and the
  store now pass the same `(:recipients routed)` and the same
  `(:canonical-commit validation)` — closes both the `:recipients` split
  the ticket names AND the `:commit` split it flags as "worth a look."
- `bb swarmforge/scripts/test/bl1306_audit_reroute_test_runner.bb` — ALL
  PASS, 8/8 assertions including the critical "edited draft still
  re-challenges" case (guards against buying queueing by disabling the
  audit).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1306-handoff-audit-reroute.feature` — 4/4 scenarios
  pass, including scenario 03 (a changed draft still invalidates).
- required_wiring: `bl1306HandoffAuditRerouteSteps` confirmed registered at
  `specs/pipeline/steps/index.js:22`, in the same commit as the draft→live
  conversion.
- Property test flakiness check (session pattern): both the
  rerouted/unrouted loop and the edited-draft generator increment their
  reach counters unconditionally within their own dedicated `fc.assert`
  passes (deterministic reach, same discipline as BL-1332/BL-1323/BL-1343
  applied proactively). Ran 6 consecutive times — 6/6 clean.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.

## Workaround retirement verified
Both the `handoff-protocol.md` "Draft `to:` at the ROUTED destination...
while BL-1306 is open" paragraph and its compact form in
`hardender.prompt` are removed — confirmed by reading the commit diff
directly (`e9698c027a`), not merely grepping post-hoc.

## Cross-file concurrency fix, verified not to regress siblings
The coder also age-guarded the stale-fixture sweep (10-minute threshold,
replacing an unguarded prefix sweep at module load) in the three OTHER
acceptance handlers it authored earlier this session (BL-1323, BL-1332,
BL-1343) — a real concurrency hazard (a sibling scenario's live fixture
root could be deleted by another scenario's load-time sweep). Verified
this introduces no regression by re-running all three siblings' acceptance
features individually: BL-1323 (7/7), BL-1332 (6/6), BL-1343 (6/6) — all
still green.

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
