# BL-927 architect re-pass — 2026-08-19

## Scope

Follow-up to `BL-927-architect-bounce-20260819.md` (D1: `resident-live-role`'s
relocation into `handoff_lib.bb` silently swapped its subprocess mechanism
from `babashka.process` to `clojure.java.shell`, reintroducing the BL-061
deadlock shape one call deeper in the daemon's chase hot path). Received
back from cleaner as `merge_and_process cleaner 5dfe2a485e`; the fix commit
is `5dfe2a485e` (coder).

## D1 verified fixed

- `handoff_lib.bb` now requires `[babashka.process :as process]` alongside
  its pre-existing `clojure.java.shell :as sh`.
- `resident-live-role`'s one tmux call (line 637) is now `(process/sh
  "tmux" "-S" socket "list-panes" ...)`, matching `handoffd.bb`'s own
  `tmux!` helper (`(apply process/sh "tmux" args)`) and the file's stated
  guardrail.
- Return-shape compatibility confirmed by precedent, not assumed:
  `handoffd.bb:705` already destructures `{:keys [out exit]}` off a
  `process/sh` call the same way `sh/sh` results are used throughout this
  codebase — no shape mismatch.
- Scope precisely matches the requested remediation: `grep -n "sh/sh\|
  process/sh" swarmforge/scripts/handoff_lib.bb` shows exactly one call
  site switched (line 637); every other pre-existing `sh/sh` use in the
  file (lines 44, 98, 704 `session-exists?`, 738, 769, 863, 1086) is
  untouched, matching D1's own remediation note that no other call site
  needed to change for this ticket.
- Docstring addition on `resident-live-role` names the BL-061 rationale
  in place — future readers of this function won't repeat the mistake.

## Everything else re-checked

- No other files in the diff (`git show --stat 5dfe2a485e`): one file,
  `swarmforge/scripts/handoff_lib.bb`, +12/-2.
- Dependency-rule gate: `node out/tools/dependency-gate.js
  ../swarmforge/scripts/handoff_lib.bb` (run from `extension/`) → PASSED,
  no forbidden edges. No `extension/src`/`extension/out` files touched.
- Co-change: `handoff_lib.bb` shows its well-documented broad baseline
  coupling (daemon-hub file every sweep wires into, same pattern noted in
  the original BL-927 pass) — nothing new, no cross-boundary edge.
- Invariants 1-3 from the original pass are unaffected by this diff (no
  logic in `departing-role-blocking-handoff`, `live-role-agrees?`, or
  `rotate-resident-to!` changed) — re-ran their tests below to confirm no
  regression.
- Two-layer boundary / host-IO-ownership / webview-storage / secrets /
  integrate-not-fork: not applicable, same as the original pass — no
  extension-host/webview/tmux-substrate-layering code touched.

## Tests re-run independently (all green)

- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` → ALL TESTS
  PASSED (BL-927 cases included).
- `bash swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh`
  → 12/12 PASS.
- `node specs/pipeline/cli.js specs/features/BL-927-rotate-gate-resolves-departing-role-from-the-raw-marker.feature`
  → 7/7 Gherkin scenarios pass.

## Verdict

D1 fixed exactly as remediated, no new architecture violation, no
invariant violation, no correctness defect found. Clean sweep — items:
NONE. Forwarding to hardender.

By architect.
