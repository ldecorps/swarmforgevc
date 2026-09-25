# BL-1740 hardener finding: handoffd.bb's real `:pause-hold-active?` wiring
# has no automated test — only a QA-manual grep stands guard

Not a defect in BL-1740's own commit. The coder's fix
(`swarmforge/scripts/chase_sweep_lib.bb`'s `sweep-role-inbox!` reading
`(optional-adapter-call adapters :pause-hold-active? role)`, and
`handoffd.bb`'s adapter map entry `:pause-hold-active? (fn [role]
(handoff-lib/pause-hold-active?))`) is correct and matches the ticket
exactly — verified independently (see
`backlog/evidence/BL-1740-hardender-20260925.md`).

## The gap

Hand-mutated `handoffd.bb` in place: changed the map key
`:pause-hold-active?` to `:pause-hold-active` (dropped the trailing `?`
only — the right-hand-side function `(fn [role]
(handoff-lib/pause-hold-active?))` was left untouched). This is exactly
the class of typo a real edit could introduce (a keyword/function-name
near-miss).

Every check available to this pass stayed green against the mutant:
- `node specs/pipeline/cli.js specs/features/BL-1740-...feature`: 4/4 —
  the feature's own CLI (`bl1740ChaseSweepPauseFromCallerCli.bb`) never
  loads `handoffd.bb`; its `live` mode wires `handoff-lib/pause-hold-active?`
  directly as the adapter function inside the CLI's OWN synthetic adapter
  map, literally re-typing the key `:pause-hold-active?` in that file
  rather than reading it from `handoffd.bb`. It proves the ADAPTER
  MECHANISM (that `sweep-role-inbox!` honours whatever function is wired
  under that key), never that `handoffd.bb` itself wires the real one
  correctly.
- `bash swarmforge/scripts/test/test_chase_sweep.sh`: ALL PASS — drives
  `chase_sweep_lib.bb` directly with its own fixture adapters, never loads
  `handoffd.bb`.
- `bash swarmforge/scripts/test/test_handoffd_pause_suppresses_outbound_wakes.sh`:
  ALL PASS, including "chase-sweep! itself never ran while the pause is
  active" — this test spawns the REAL daemon and proves the OUTER
  `outbound-wakes-suppressed?` gate (`handoffd.bb:5672`,
  `backlog-depth-lib/pause-active?`, a DIFFERENT module than
  `handoff-lib/pause-hold-active?`) already prevents `chase-sweep!` from
  running AT ALL while paused, in the daemon's real main-loop path
  (`(when-not (outbound-wakes-suppressed?) (run-sweep! "chase-sweep" #(chase-sweep! ...)))`,
  `handoffd.bb:~5672-5675`). The adapter this ticket wires is therefore
  UNREACHABLE from that call site today — it can only matter for a caller
  of `chase-sweep!`/`run-sweep!` that bypasses this outer gate (the exact
  isolated-fixture shape BL-1740's own bug report described: a property
  test or scratch `bb -e` snippet calling `run-sweep!` directly).
- `bash swarmforge/scripts/pre_qa_gate.sh BL-1740 <commit>`: prints `OK`.
  The ticket's own `required_wiring` anchor
  (`swarmforge/scripts/handoffd.bb:::pause-hold-active?::...`) is checked
  by `pre_qa_gate_lib.bb`'s `wiring-findings` as a bare
  `(str/includes? content pattern)` substring test — it does not require
  the pattern to appear as a map KEY, only ANYWHERE in the file. The
  mutated file still contains the literal substring `pause-hold-active?`
  (from the untouched right-hand-side `(handoff-lib/pause-hold-active?)`
  call one token away), so the gate reports success even though the map
  key it exists to pin is gone.

Restored `handoffd.bb` byte-for-byte before continuing (`git status
--short` clean); this finding is recorded, not left mutated.

## What this means

A future edit that silently breaks the literal map-key binding in
`handoffd.bb` (a typo, a refactor that renames the key without updating
both sides, a merge conflict resolved wrong) would pass every automated
check in this repository. The only thing that would catch it is a human
running the ticket's own `qa_e2e_procedure` step 4 grep BY HAND — which
is a one-time land-gate step, not a standing regression guard. Once
BL-1740 lands and its register row retires, nothing runs that grep again.

## Why not fixed in this pass

Closing this properly needs either (a) a daemon-spawn wiring test in the
`test_handoffd_*_wiring.sh` family (this repo's own established pattern
for "prove the real daemon reaches X" — see
`test_handoffd_pause_suppresses_outbound_wakes.sh`,
`test_handoffd_cooldown_sweep_wiring.sh`) exercising a path that reaches
`chase-sweep!` while bypassing the outer `outbound-wakes-suppressed?`
gate — nontrivial fixture work, well outside a single hardening pass's
proportionate scope, and adjacent to but not owned by BL-1740's own Scope
(BL-1740's fix is correct; this is a gap in the SURROUNDING verification
tooling); or (b) tightening `pre_qa_gate_lib.bb`'s `wiring-findings` to
require a pattern to match at a line boundary / as a map key rather than
anywhere-in-file — a change to a shared gate tool used by every ticket's
`required_wiring`, not this ticket's file, and a decision the specifier
should make deliberately (tightening it could also newly break OTHER
tickets' existing loose pins).

Routed as a note (priority 00) to the specifier and coordinator rather
than a parcel — a spec/tooling-completeness finding, not a BL-1740 code
defect (per this role's spec-gap handling).

By hardender.
