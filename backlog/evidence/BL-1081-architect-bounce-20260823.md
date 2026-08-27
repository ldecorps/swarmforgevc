# BL-1081 architect bounce — 2026-08-23

Commit reviewed: `8d6a8c12e7` (cleaner tip, "BL-1081: reduce CRAP and separate
wire-field reading from message dispatch"), merged into architect as
`5eb215e39`.

Review pass complete per Article 4.4 (one bounce, full inventory):

- Dependency gate (`dependency-gate.js src/swarm/acp*.ts`): PASSED, no
  forbidden edges.
- Co-change report: nothing at or above threshold (single-commit frequencies
  only).
- `required_wiring` anchor `specs/pipeline/steps/index.js::bl1081`: satisfied
  (step handler registered).
- Property-test coverage: solid. `bl1081StructuredSeatControl.property.test.js`
  and `bl1081PaneTranscriptSurvives.property.test.js` are non-vacuous
  (break-then-restore evidence recorded in-file for 2026-08-23).
- Invariant 2 ("the pane still renders a human-readable transcript;
  observability and babysitter pane checks survive"): satisfied.
  `AcpHostSession.ingest` forwards every non-protocol line and every rendered
  event verbatim via `writeLine`; nothing is swallowed or replaced.

## D1 — required_wiring anchor targets dead code; invariant 1 not achieved in the live system (behavior, blame: coder)

`required_wiring` names `swarmforge/scripts/babysitter_assess.bb::stop-reason`
as "the place [the idle and stuck] decision is actually taken." It is not.

`swarmforge/scripts/babysitter_assess.bb` is documented dead code: **BL-781**
(paused, dated 2026-08-01 — three weeks before this ticket was written) found
it calls five symbols absent from `babysitter_assess_lib.bb`
(`assess-agent`, `mono-router-standing-roles`, `summarize-assess`,
`format-assess-report`, `format-telegram-glitch`) and has **zero live
callers** — BL-781 explicitly says "resist" fixing it; it is slated for
deletion, not repair. Verified independently in this review:

    git grep -n "defn assess-agent" swarmforge/   # no hits, anywhere
    git grep -l "babysitter_assess\.bb" -- ':!backlog/' ':!docs/'
      # only BL-1081's own new test files + the scenario-15 dead-code allowlist

The coder's own test-runner comment
(`swarmforge/scripts/test/acp_session_lib_test_runner.bb:82`, "because
babysitter_assess.bb itself is a top-level script that exits") and the
property test's comment (`bl1081StructuredSeatControl.property.test.js:21`,
"the same functions babysitter_assess.bb calls at its decision site") both
show the mental model that this file IS the live decision site. It is not —
that predates this ticket and is independently documented (BL-781).

The actual live per-role gathering function is `babysitter_check.bb`'s
`gather-role` (called from `swarm_ensure.bb`, `mono_router_lib.bb`,
`babysitterd_sweep_lib.bb`, `hardender.prompt`, `is_qa_ancestor.sh` — real
production callers). It computes `menu?` via a raw regex match
(`menu-pattern`) against captured `pane-text`, and idle-ness via a
pane-content hash-history comparison — exactly the pane-tail inference this
ticket exists to replace — with **zero reference to ACP, `acp-session-lib`,
or any structured fact**. Confirmed:

    grep -n "acp\|stop-reason\|assess-agent" swarmforge/scripts/babysitter_check.bb
      # only line 931: babysitter-assess-lib/scan-claim-risks (a DIFFERENT,
      # unrelated claim-progress function; not idle/stuck/menu)

Consequence: in the running swarm, an ACP-hosted seat's idle/stuck
determination still comes entirely from `babysitter_check.bb`'s pane-hash
comparison, unaffected by anything this ticket built. Invariant 1 ("Seat
control decisions for the spiked seat consume structured session signals...
never pane-tail heuristics alone") does not hold for the live system — only
for the isolated pure-function tests of `acp_session_lib.bb`, which are
correct in themselves but wired to nothing live.

Partial, real mitigation found and credited: `acpHostRuntime.ts`'s
`paneToolLabel` deliberately collapses tool-title prose to a bounded,
punctuation-free token specifically so a permission-request chrome line
cannot itself collide with `babysitter_check.bb`'s `menu-pattern` regex — a
genuine, working fix for one failure mode (the host's own status line
false-triggering the CRIT). It does not, however, make the CRIT (or idle
detection) consult any ACP fact; it only avoids one accidental collision.
QA procedure step 3's "routed or escalated" half of a permission moment also
has no live consumer anywhere (`permission-pending?`/`permissionPending` is
read only inside BL-1081's own files and tests — confirmed by
`git grep -l permissionPending`).

**Remediation**: wire ACP-fact consumption (idle verdict, menu-check
suppression, permission routing) into `babysitter_check.bb`'s `gather-role`
(or its caller) — the real decision site — not into
`babysitter_assess.bb`. `acp_session_lib.bb`'s pure functions
(`apply-acp-facts`, `menu-check-applies?`, `idle-decision`,
`permission-pending?`) look reusable for this as-is; the defect is the
wiring location, not the logic. `babysitter_assess.bb` should be left alone
per BL-781 (out of scope to fix; slated for deletion by that ticket).

The ticket's own `required_wiring` text will then be stale (it names the
dead file) — flagged separately to specifier+coordinator via `note`, since
that is a spec correction, not something the coder should silently
reinterpret.

By architect.
