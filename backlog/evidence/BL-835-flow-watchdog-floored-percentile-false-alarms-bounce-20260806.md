# BL-835 — documenter bounce, 2026-08-06

Received: hardener merge_and_process, commit `8cca02bc74` (BL-835: harden
threshold-table-stale? and read/write round-trip).

Documenter's own pass (Specification.MD "Flow Watchdog (BL-577) > Configuration"
section, `Last Updated` entry, and the matching `swarmforge.conf` comment) was
complete and committed (`03282c15`) before attempting the forward to QA.
`swarm_handoff.sh`'s pre-QA durability gate (BL-531/BL-761) refused the send.

## Inventory — one item, complete pass

**D1 — wiring: required_wiring entry does not literally match the test's assertion text**

- **class:** unit (wiring-contract mismatch; the underlying behavior is
  genuinely tested, only the required literal string is absent)
- **blamed role:** coder
- **remediation pointer:** `swarmforge/scripts/test/flow_watchdog_test_runner.bb`,
  the `BL-835 floored-percentile-reject-02` assertion (~line 702, committed in
  `17ba35e7` "BL-835: flow-watchdog min-warn-ms is a reject gate, not a floor").
  The ticket's `required_wiring` (backlog/active/BL-835-...yaml) declares:

  ```
  swarmforge/scripts/test/flow_watchdog_test_runner.bb::sub-floor samples do not WARN a 90s parcel under global 15m
  ```

  The file's actual assertion message is `"a ~90s parcel on that sub-floor
  route does not WARN under the global pair"` — functionally the same
  scenario, but `pre_qa_gate_lib.bb`'s wiring check is a literal
  case-sensitive substring match (`str/includes?`), so it fails closed.
  Fix: either add the literal required_wiring phrase into that assertion's
  message/comment, or (if the phrase itself should change) coordinate with
  the ticket's required_wiring field so both sides agree — do not alter the
  test's actual behavior, only its wording, to satisfy the gate.

**Blocked checks:** none — this is the only gate documenter's send attempt
hit; nothing else was blocked behind it.

**Other checks in documenter's own pass:** NONE — docs currency, diagram
currency (not applicable, no topology/architecture change), and Last Updated
freshness all checked clean; see reverted commit `03282c15` for that content
(reapply on redo, unchanged).

## Action taken

Per "Never Blind-Forward A Bounce You Cannot Fix" (this is outside
documenter's domain: test-file wording, not a doc defect) and "A Bounce Must
Be Reverted Out Of The Bouncing Branch": reverted the hardener merge
(`5ad9a1c7`) and documenter's own commit built on top (`03282c15`) via commit
`72a1e955`, confirmed by content diff against the pre-merge tree — this
content is not an ancestor of `main`, so the ancestry exception does not
apply. Routing this parcel to **coder** (the routing table's default for an
"ordinary implementation, logic, or wiring defect").
