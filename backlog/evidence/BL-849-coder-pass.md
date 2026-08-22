# BL-849 — coder pass

Swarm review-stamp-off of the hand-landed Darwin orphan-janitor hotfix
(`f9cf29c2`). Per the ticket's own posture (BL-811-style): confirm or
refute the two declared invariants, fix what's confirmed narrowly, promote
the parked `.feature.draft` to a live `.feature` with step handlers, and
author declared-invariant tests (BL-654). Files reviewed exactly as listed
in the ticket: `process_table_lib.bb`, `orphan_janitor_lib.bb`,
`orphan_janitor_sweep_lib.bb`, `orphan_agent_reaper_sweep_lib.bb`, and their
two test runners.

## Invariant 2 — CONFIRMED holding, no fix needed

"No ancillary kill ever matches a host-repo path: the disposable-root
extract stays mandatory on every reap decision." `orphan_janitor_lib.bb`'s
`tmp-ancillary-cmdline?` requires `extract-disposable-root` to match
(non-nil) as a hard `and`-ed precondition alongside every specific ancillary
pattern (babysitter tmux, `babysitterd.sh`, `tmux`, bridge, bot, `claude -n
Babysitter`) — a host-repo cmdline can never satisfy it regardless of which
sub-pattern it happens to also match. `orphan_janitor_lib_test_runner.bb`
already carries explicit negative cases proving this (`host babysitterd.sh
never detected`, `host .swarmforge/tmux swarmforge-coder never detected`,
`host bridge never detected`, `host Operator claude never detected`) — all
pass unmodified.

## Invariant 1 — REFUTED as landed, fixed narrowly

"A reaper that cannot enumerate processes on its host reports that it
cannot, and never reports zero candidates as a clean sweep." As landed,
`process_table_lib.bb`'s `list-pids!`/`list-processes!` wrapped their whole
body in `(catch Exception _ [])` — any enumeration failure (Linux `/proc`
listing or Darwin `ProcessHandle/allProcesses` throwing) silently became an
empty vector, indistinguishable from a genuinely clean host. Both
`orphan_janitor_sweep_lib.bb` and `orphan_agent_reaper_sweep_lib.bb`'s
`scan-candidate-pids!` had the identical `catch Exception _ []` shape, and
neither `sweep!` had any way to report the difference — the committed test
suite covered only the happy path (`process_table_lib_test_runner.bb`
asserts `list-processes!` finds live processes; never that enumeration
*failure* is reported). This is exactly darwin-orphan-janitor-02, the
draft's own pre-approved acceptance scenario — confirmed failing before the
fix (manually re-added the old `catch Exception _ []` shape, reran
`orphan_sweep_enumeration_unavailable_test_runner.bb`: the "nil candidates
reports unavailable" assertions failed as expected; restored).

**Fix**: `list-pids!`/`list-processes!` now return `nil` on enumeration
failure, never `[]` (the `/proc` branch propagates `list-pids!`'s own `nil`
via `when-let` rather than `keep`-ing over it, which would silently
re-degrade a failed read back into an empty-but-successful result).
`scan-candidate-pids!` in both sweep libs now propagates `nil` through
unchanged (`when-let` instead of catching to `[]`). `sweep!` in both now
checks `(nil? candidates)` first and logs "process table unavailable this
sweep — skipping" instead of iterating and printing "swept 0, reaped 0".
Verified directly (see commit): injecting a nil-returning
`:list-candidate-pids!` adapter produces the unavailable message with zero
kill/audit calls; an empty (non-nil) vector still produces the original
"swept 0, reaped 0" message unchanged (no regression on the true-clean-host
path).

## Review goal 3 — a related, narrower gap found and fixed

"Confirm `lsof`-based cwd resolution degrades safely when `lsof` is
missing, slow, or denied." `process_table_lib.bb`'s `cwd!` already degrades
correctly (nil on Darwin when `lsof` fails) — but
`orphan_agent_reaper_sweep_lib.bb`'s `cwd-inside-root?` computation
(`boolean (and cwd (str/starts-with? cwd ...))`) silently collapsed
"cwd unresolved" and "cwd resolved and confirmed outside root" into the
same `false`, and `orphan_agent_reaper_lib.bb`'s `reapable?` treats
`cwd-inside-root? false` as "safe to reap" — meaning a genuinely
unresolvable cwd (exactly what a missing/slow/denied `lsof` produces) fails
OPEN, not closed. This is darwin-orphan-janitor-06, also a pre-approved
scenario in the draft. `orphan_agent_reaper_lib.bb` is not in the ticket's
own "files to review" list (BL-486, pre-existing) — flagged here rather
than silently left broken because the ticket's own acceptance scenario 06
requires it and it is the direct, narrow consequence of this ticket's own
Darwin `cwd!` work, not a widening into unrelated territory.

**Fix**: `reapable?` gained a `:cwd-resolved?` key (`:or {cwd-resolved?
true}` — every pre-BL-849 caller, including the existing
`orphan_agent_reapable_decision_acceptance_runner.bb` JSON bridge, is
unaffected since it never passes this key), checked as its own gate
immediately after `cwd-inside-root?`. `orphan_agent_reaper_sweep_lib.bb`
now computes `cwd-resolved? (some? cwd)` and passes it through. BL-486's
own acceptance feature (`specs/features/BL-486-reap-orphaned-agent-
processes.feature`) reruns green, 8/8, unmodified — confirms backward
compatibility.

## Acceptance: draft promoted to live

`specs/features/BL-849-swarm-stamp-darwin-orphan-janitor-hotfix.feature`
(DRAFT preamble removed), step handlers in
`specs/pipeline/steps/bl849DarwinOrphanJanitorHotfixSteps.js`, driving the
real Babashka functions via a JSON-bridge acceptance runner
(`swarmforge/scripts/test/bl849_orphan_janitor_acceptance_runner.bb`, same
pattern as BL-486/BL-458). `run_acceptance.sh`: 8/8 subtests pass (6
scenarios, 2 as two-example Scenario Outlines).

Scenario 03's "Linux proc tree" row cannot be exercised against a literal
Linux host from this Darwin dev machine — `procfs-available?` hardcodes the
literal `/proc` path by design, not a redirectable test seam. That row
instead replicates `cmdline-from-procfs`'s own NUL-byte-join parsing
contract against a real synthetic `/proc/<pid>/cmdline`-shaped fixture file,
proving the parsing logic itself is correct. Per the ticket's own QA
procedure item 4, this is **not** a substitute for a real Linux host pass —
record that explicitly at final QA sign-off rather than treating this row's
green result as covering it.

## Non-vacuity (BL-654)

Two declared invariants, both admit an executable encoding — no "stated
reason" exemption needed. Given the review's own conclusion (invariant 2
already correct, invariant 1 was the confirmed defect), the meaningful
non-vacuity proof for invariant 1 is the CONFIRM/REFUTE cycle itself,
already run above (old code fails
`orphan_sweep_enumeration_unavailable_test_runner.bb`, fixed code passes).
Invariant 2 is proven non-vacuous by `orphan_janitor_lib_test_runner.bb`'s
own pre-existing host-path negative cases (unmodified, still passing).

**No `*.property.test.js` file for these two invariants**: this ticket's
entire surface is Babashka/Clojure (`.bb`), not the TypeScript extension —
there is no `fast-check`-equivalent generative-testing framework wired into
this repo's Babashka tooling, and building one is squarely the kind of
widening the ticket explicitly forbids ("not a rewrite ticket... do not
widen here"). Both invariants are instead encoded as targeted, deterministic
assertion tests exercising the real functions with real (non-fabricated)
inputs: `swarmforge/scripts/test/orphan_sweep_enumeration_unavailable_test_
runner.bb` (invariant 1, both sweep libs, plus a same-file regression check
that a genuine reapable candidate still gets reaped when candidates is a
real vector) and the existing `orphan_janitor_lib_test_runner.bb` host-path
negative cases (invariant 2). This is recorded as the BL-654 "stated reason"
for the file-format substitution, not for skipping the test.

## Follow-ups

None minted — every finding from the review goals was narrow enough to fix
directly in this parcel (invariant 1's silent-empty coercion, and the
review-goal-3 cwd-resolution gate), matching "open narrow follow-up tickets
for anything found" with nothing left over that needed its own ticket.

## Commands run

```
bb swarmforge/scripts/test/process_table_lib_test_runner.bb
bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb
bb swarmforge/scripts/test/orphan_agent_reaper_lib_test_runner.bb
bb swarmforge/scripts/test/orphan_sweep_enumeration_unavailable_test_runner.bb
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-849-swarm-stamp-darwin-orphan-janitor-hotfix.feature
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-486-reap-orphaned-agent-processes.feature   # regression
```

All green. By coder.
