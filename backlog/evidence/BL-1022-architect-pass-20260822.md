# BL-1022 architect pass — 2026-08-22

**Parcel:** cleaner forward `7fc90530e9` (coder's own commit — "BL-1022:
close the daemon subprocess-API gate over spawn edges, not only load
edges"), merged into architect at `171f8e6a3`. Cleaner reviewed clean and
forwarded as-is (no cleaner-added commit in the range).

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect found
in the parcel's own changed code.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary rules:** N/A. This parcel touches
  no `extension/` file at all (`swarmforge/scripts/master_checkout_drift_lib.bb`,
  two new `swarmforge/scripts/test/*.bb` files, two extended
  `swarmforge/scripts/test/*_test_runner.bb` files, one new acceptance-step
  file, `specs/pipeline/steps/index.js`). It is maintained-fork
  `swarmforge/` test/gate tooling, not VS Code extension/webview code — the
  tiles/webview/tmux-substrate boundary, secrets-in-host, and
  no-webview-storage rules do not apply to this diff.
- **Dependency-rule hard gate (BL-259):** `node extension/out/tools/dependency-gate.js
  <each changed file>` errors "can't open" for every changed file — none
  sit inside `extension/`'s import graph, so the gate has nothing to check
  for this parcel. Ran a full-repo scan (`node out/tools/dependency-gate.js`
  from `extension/`) for baseline confirmation: reproduces exactly the
  known pre-existing BL-759 `telegram-front-desk-bot.ts` acyclic cycle,
  unrelated to this parcel. CLEAN for this parcel (nothing to gate).
- **Co-change coupling (BL-255):** ran `node extension/out/tools/co-change-report.js`
  over all seven changed files. "Suspected coupling" surfaces
  `handoffd.bb`, `daemon_cycle_guard_lib.bb`, `control_plane_lib.bb`, and
  `briefing_email_lib.bb` — none touched by this parcel. Checked against the
  ticket's own explicit scope statement: "Out of scope: removing the banned
  API from any specific script (BL-1021), and the bounded-wait behaviour of
  `sh!` itself (BL-1021)" — this parcel adds a pure closure-walk function
  only; it deliberately does not touch the daemon or the guard-chokepoint
  lib themselves. The coupling signal reflects earlier tickets (BL-967) that
  genuinely co-evolved daemon + guard-runner; not evidence this parcel is
  incomplete.
- **Declared invariant (1)** — "The subprocess-API ban is enforced over
  every file the daemon can reach, by any edge kind": encoded as P1 in
  `bl1022_daemon_closure_property_runner.bb`, generator constructs
  alternating spawn/load chains (2-5 nodes, cyclic sometimes) plus noise,
  expected set derived independently from the generated adjacency, never by
  re-running the walk. Independently verified non-vacuous by hand, not by
  trusting the commit message: forced `kinds` to `#{:load}` regardless of
  the `edge-kinds` argument in a scratch-restored copy of
  `master_checkout_drift_lib.bb`, re-ran the property runner live — **187
  failures**, exact match to the commit's claimed count — then restored the
  file byte-for-byte (`diff` confirmed) and re-confirmed `ALL PROPERTIES
  HOLD` at baseline.
- **Declared invariant (2)** — "The gate reports the closure it actually
  covered, so a shrinking closure is visible rather than silently passing":
  encoded as P2/P4 in the same runner. Independently verified non-vacuous:
  dropped the `[:spawn f]` reached-by update in a scratch-restored copy,
  re-ran live — **722 failures**, exact match to the commit's claimed
  count — then restored and re-confirmed clean.
- **Correctness read of the parser (`spawn-forms`/`extract-spawn-targets`/
  `resolve-spawn-target`):** traced by hand against the real closure output.
  Runtime detection is scoped to `bb|bash|sh|zsh` only; spawns under other
  runtimes (`node`, `git` — both used extensively by `handoffd.bb` via the
  sanctioned `daemon-cycle-guard-lib/sh!` chokepoint) are invisible to
  `spawn-forms` entirely. Checked this is not a re-opened blind spot: those
  targets are never `.bb` source (a compiled JS tool, or the `git` binary),
  so they cannot embed the banned `clojure.java.shell`/`babashka.process`
  Clojure namespaces the ban exists to catch — excluding them is a correct
  scope boundary, not a silently-dropped edge of the kind this ticket
  exists to close. The position-scanned (not text-matched) spawn detection
  correctly handles multiple spawns per file (the defect the coder's own
  non-vacuity check found and fixed during authoring, per the commit
  message) — confirmed by reading `spawn-forms`'s loop, which advances `i`
  by position on every iteration regardless of match.
- **Reported counts cross-checked for internal consistency:** live gate
  output reports "53 files (1 entrypoint, 1 reached by spawn) ... spawn-only
  files: 15". Confirmed these are two different measures, not a
  contradiction: only `swarm_handoff.bb` has a direct `:spawn` edge in its
  own `reached-by`, because there is exactly one spawn edge in the real
  graph (`handoffd.bb` → `swarm_handoff.bb`); the other 14 "spawn-only"
  files (in the closure now, absent from the old load-only closure) are
  reached by `:load` edges transitively downstream of that one spawn
  gateway. 53 − 38 = 15 matches exactly.
- **Note to specifier re: the three newly-visible offender files**
  (`handoff_inject_lib.bb`, `pre_qa_gate_gather_lib.bb`, `salvage_lib.bb`):
  commit message claims this was sent. Confirmed directly —
  `.swarmforge/handoffs/specifier/inbox/in_process/00_20260822T045009Z_000435_from_coder_to_specifier_for_specifier.handoff`,
  `type: note`, `priority: 00`, message "BL-1022 7fc90530e9: 3 more
  unbounded-subprocess files on daemon path". Not a dropped spec-gap.
- **Verification re-run live** (not trusted from the commit message):
  - `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` →
    `ALL PASS: daemon_cycle_guard_lib.bb`.
  - `bb swarmforge/scripts/test/master_checkout_drift_lib_test_runner.bb` →
    `ALL TESTS PASSED`.
  - `bb swarmforge/scripts/test/bl1022_daemon_closure_property_runner.bb` →
    `300 runs`, all coverage floors cleared, `ALL PROPERTIES HOLD`.
  - `node specs/pipeline/cli.js specs/features/BL-1022-daemon-guard-closure-follows-process-spawn-edges.feature`
    → **4/4** (all four scenarios).

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

`extract-spawn-targets`/`resolve-spawn-target`/`bb-basename` are enumerable
small-shape parsers ("three shapes resolve, and they are the three that
occur"), already exercised by seven direct example cases covering resolved
(literal, path-plumbing, same-file helper), unresolved, non-bb, commented,
and no-spawn inputs, plus indirectly by the declared-invariant property
runner's randomized `render`-generated spawn/load chains (300 runs). No
clear round-trip/idempotence/ordering property beyond what the declared
invariants already assert; nothing further to add rather than manufacture a
vacuous one.

## What was NOT re-litigated

- `resolve-daemon-executed-paths` (the BL-839 drift-check entry point):
  unchanged in behaviour by design (delegates to `resolve-daemon-reachability`
  with `:load` only) — confirmed by the new backward-compatibility unit
  test and by `master_checkout_drift_lib_test_runner.bb` passing unchanged.
  Widening the drift check's own scope is explicitly a different, un-taken
  decision per the commit message and the ticket's scope.
- Removing the banned API from `handoff_inject_lib.bb`,
  `pre_qa_gate_gather_lib.bb`, or `salvage_lib.bb`: explicitly out of this
  ticket's scope (BL-1021's), correctly held as a ratchet instead, and
  routed to the specifier as a note (confirmed above) rather than fixed or
  silently dropped here.

— By architect.
