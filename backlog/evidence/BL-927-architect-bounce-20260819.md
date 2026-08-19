# BL-927 architect bounce — 2026-08-19

Commit reviewed: `2d3133fa651b9000a90aba9224b5c6bb99adeb33` (BL-927, coder),
merged into the architect worktree at `57db20e081653add6b75975f39025cfd0161ede1`.

## D1 — resident-live-role's relocation silently swapped its subprocess
mechanism from babashka.process to clojure.java.shell, reintroducing the
exact deadlock shape BL-061 fixed, in the daemon's own chase hot path

**Class:** behavior (reliability regression). **Blamed role:** coder.

**What changed.** `resident-live-role` moved from `handoffd.bb` into
`handoff_lib.bb` (BL-927's own stated shape, to break the circular-load
problem and give the rotate gate and the chase call sites one shared
definition — that relocation itself is correct and required). But the
function's ONE subprocess call changed shell mechanism as a side effect of
the move:

- Pre-BL-927, in `handoffd.bb`: `(tmux! "-S" socket "list-panes" ...)`,
  where `tmux!` = `(apply process/sh "tmux" args)` —
  `[babashka.process :as process]` (handoffd.bb's own required alias).
- Post-BL-927, in `handoff_lib.bb:614-627`: `(sh/sh "tmux" "-S" socket
  "list-panes" ...)`, where `sh` = `[clojure.java.shell :as sh]`
  (handoff_lib.bb's own required alias, line 9).

**Why this is not cosmetic.** `handoffd.bb`'s own file header (lines 3-5)
states, unchanged by this diff:

> Subprocess calls use babashka.process, NOT clojure.java.shell: bb's
> clojure.java.shell shim can deadlock reading subprocess streams (observed
> hanging notify! mid-delivery and silently stalling the whole swarm,
> BL-061).

That guardrail exists because of a first-hand, root-caused, swarm-halting
incident (BL-057/BL-061): the daemon hung inside `notify!`, deterministically,
on repeated successive `clojure.java.shell/sh` tmux calls within one process
run ("never returns on the 4th tmux subprocess call" — stream-read deadlock
in bb's `clojure.java.shell` shim). The fix at the time was narrowly scoped
to `notify!`'s 3 calls; it did not touch `handoff_lib.bb`, which already
used (and still uses) `clojure.java.shell/sh` for its own tmux/git calls
(`session-exists?`, `respawn-pane`, etc.) — a pre-existing, wider exposure
this ticket did not create and is not asked to fix.

What THIS ticket does add: `resident-live-role` is now called from
`chase-poke-action` (`handoffd.bb:377-390`), which — in the very same
function invocation — ALREADY calls `handoff-lib/session-exists?` twice
(pre-existing, also `clojure.java.shell/sh`-based). That's 3 successive
`clojure.java.shell/sh` subprocess calls per role per chase sweep, in
exactly the call-count-triggered shape the BL-061 incident named ("the 4th
tmux subprocess call"), in the daemon's single highest-frequency hot path
(BL-921's own measured evidence: 535 landed wakes from this chase subsystem
in one day). `resident-live-role` is also called a second time from the
chase-driven rotation gate (`handoffd.bb:1351`, inside the ~1342-1359
`rotate-gate-and-execute!`-shaped block).

Before this ticket, `resident-live-role` was the one call in this exact hot
path that deliberately used the safe mechanism (matching the file's own
guardrail). BL-927's relocation silently undoes that protection for no
functional reason — nothing about resolving the departing role from live
identity requires `clojure.java.shell/sh` specifically.

**Not a hypothetical residual-risk nitpick — it is the SAME incident
shape** (successive `clojure.java.shell/sh` tmux calls, same daemon hot
path, same "silently halts the whole swarm" blast radius) that BL-061
exists to prevent, now reintroduced one call deeper.

**Remediation.** Give `handoff_lib.bb` a `[babashka.process :as process]`
require and implement `resident-live-role`'s single tmux call via
`process/sh` instead of `sh/sh` — matching the mechanism it used before
relocation and matching `handoffd.bb`'s own guardrail for this exact call
path. `babashka.process/sh` returns the same `{:exit :out :err}` shape
`sh/sh` does (see `handoffd.bb`'s own pre-existing `tmux!` usage), so this
is a one-line change inside `resident-live-role`, plus the new require —
no other call site, and no other pre-existing `sh/sh` use in
`handoff_lib.bb`, needs to change for this ticket.

## Everything else reviewed clean

- Dependency-gate (extension/.dependency-cruiser.cjs): a no-op for this
  parcel — BL-927 touches zero `extension/src` or `extension/out` files.
  A full-repo scan does show a real `acyclic` violation
  (telegram-front-desk-bot.ts <-> telegramCursorOperatorExec.ts /
  telegramCursorOperatorLiveness.ts), confirmed pre-existing and unrelated
  (already tracked at BL-759, not touched by this commit) — not part of
  this bounce.
- Co-change: handoff_lib.bb/handoffd.bb/index.js/the two test suites show
  expected, inherent coupling (this ticket's own stated shape touches all
  of them together); no new coupling signal.
- Invariant 1 (departing role from live identity, unreadable = divergence):
  holds — `live-role-agrees?` (mono_router_lib.bb:153-160, unchanged, reused
  not duplicated) already encodes unreadable-is-divergence; the new `cond`
  in `departing-role-blocking-handoff` routes an unreadable/blank
  `live-role-fn` result to the `:else nil` branch -> fail-open, verified by
  handoff_lib_test_runner.bb's two "unreadable" cases and acceptance
  scenario 02.
- Invariant 2 (fail-open only widens, BL-805 cases untouched): holds —
  missing/blank marker and unknown-marker-role still short-circuit to
  fail-open WITHOUT calling `live-role-fn` at all (proven by the
  `never-called` unit tests, a genuine non-vacuity check), and the new
  residual-role-also-invalid path also falls through to fail-open.
- Invariant 3 (daemon's own rotation ungated): holds — `rotate-resident-to!`
  itself is untouched by this diff; acceptance scenario 04 drives the REAL
  function and confirms it proceeds and respawns despite a real blocking
  parcel.
- required_wiring: satisfied — `departing-role-blocking-handoff` genuinely
  calls a live-identity probe (default `resident-live-role`), not a
  resolver nothing feeds; confirmed by reading the code and by the
  integration test's fake-tmux fixture actually exercising the default
  0-arity probe end to end.
- All tests run and green: `handoff_lib_test_runner.bb` (unit, BL-927 cases
  included), `test_rotate_to_role_stuck_parcel_gate.sh` (12/12, including
  new scenarios 10-12), acceptance feature BL-927 (7/7 scenarios via
  `specs/pipeline/cli.js`).
- No architecture-boundary concerns: this parcel touches no extension-host/
  webview/tmux-substrate-layering code at all (pure swarm-infrastructure
  Babashka + a JS acceptance step handler).
