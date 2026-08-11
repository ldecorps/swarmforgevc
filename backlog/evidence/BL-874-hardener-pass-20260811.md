# BL-874 — hardener pass — 2026-08-11

## Scope reviewed

Batch parcel received from architect at `00d0a8e7b9`, forwarded as two
separate `git_handoff`s (BL-871, BL-874) per Article 2.6. This file covers
BL-874 only; BL-871 has its own evidence file
(`BL-871-hardener-pass-20260811.md`).

Files this task touches: `swarmforge/scripts/portable_time_lib.sh` (new),
`specs/pipeline/steps/lib/portableTimeGuard.js` (new),
`extension/test/portableTimeGuard.test.js` (new),
`extension/test/bl874PortableTimeInvariants.property.test.js`, and the six
named `swarmforge/scripts/test/test_operator_runtime_*` /
`test_handoffd_stuck_escalation_email_wiring.sh` sites.

## BL-149 cooldown gate (per changed production file)

`run` for `portable_time_lib.sh`, `portableTimeGuard.js` (new, no `main`
baseline). `run` for `test_operator_runtime_fixture_reaper_sweep.sh`,
`test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh`,
`test_operator_runtime_sandbox_sweep.sh`,
`test_handoffd_stuck_escalation_email_wiring.sh` (11-18 days since last
integrated touch, past the 3-day cooldown). `skip-cooldown` for
`test_operator_runtime_sandbox_sweep_bounded_progress.sh` and
`test_operator_runtime_tick.sh` (touched within the cooldown window by the
concurrent BL-872 ticket the ticket's own notes flag as an orthogonality
overlap). Host quiet at gate time (load 3.51/4 cores).

## Mutation scope — no wired tool covers this task's changed files

`portable_time_lib.sh` is a shell function under `swarmforge/scripts/` —
the Babashka/shell layer has no mutation/CRAP/DRY tooling wired
(engineering.prompt Startup Tools), gated only by its own test suite.
`portableTimeGuard.js` is a plain Node module under `specs/pipeline/steps/lib/`,
not `tsc`-compiled to `out/`, so Stryker's `out/**/*.js` scope does not
reach it either. Did a hand-authored surgical mutation sweep instead of
skipping, per BL-638's precedent.

### Coverage gap found and closed

`portable_relative_touch_stamp`'s `case *)` branch (an unsupported unit,
e.g. a caller typo) had **zero test coverage anywhere in the repo**. All six
call sites this ticket fixed only ever pass `seconds`/`minutes`/`hours`
literally, so this defensive error path was live, untested production code
— exactly the class of gap this role exists to close.

Added a direct test to `bl874PortableTimeInvariants.property.test.js`
(alongside the existing invariant-3 real-subprocess tests, which already
drive the same `LIB_PATH` via `spawnSync`): calls
`portable_touch_relative 5 fortnights <file>` and asserts (a) nonzero exit,
(b) stderr names the bad unit, (c) the file's mtime is left untouched (the
function returns before ever calling `touch`).

**Confirmed non-vacuous** — hand-mutated the branch to set
`bsd_letter=S` and fall through into the BSD `date -v` call instead of
`return 1`ing; re-ran the new test in isolation:
```
✗ portable_relative_touch_stamp rejects an unsupported unit rather than silently miscomputing
  AssertionError: expected a nonzero exit for an unsupported unit
```
Restored the original `return 1`, re-ran: 6/6 pass in the file, `git diff`
on the shell lib empty (no stray mutation left behind). Committed at
`059feca431bb414b7ebcf144dd6c5cf3d6585971`.

No other mutation candidate in `portable_relative_touch_stamp` or
`portable_touch_relative` found productive: the BSD-letter case-statement's
alternate spellings (`sec`, `min`, `hr`, etc.) are unreachable by any real
caller (all six sites use the literal `seconds`/`minutes`/`hours` words),
and the GNU fallback branch (line 32) is untestable on this host by
construction — no GNU coreutils on PATH (confirmed: `which gtouch gdate`
returns nothing) — an honest, already-documented scope limit (architect's
BL-874 evidence, invariant 3) shared by the six original tests' own
pre-existing GNU syntax, unchanged by this ticket. Not worth a fabricated
stub-PATH GNU simulation for this pass; genuine Linux-host coverage is the
real fix, tracked implicitly by the six sites' own GNU-branch text staying
verbatim.

## required_wiring re-verified directly (own pass, not on prior word)

Ran each of the six sites' scripts directly with `bash <path>` on this
host:

| script | result | cause |
|---|---|---|
| `test_operator_runtime_sandbox_sweep_bounded_progress.sh` | exit 0, all checks pass | — |
| `test_operator_runtime_tick.sh` | exit 0, all checks pass, including the `swarm-seed-race-02` (BL-310) site — backdating genuinely bites | — |
| `test_operator_runtime_sandbox_sweep.sh` | exit 1 | pre-existing, unrelated (BL-413, `/proc` liveness detection absent on macOS) |
| `test_operator_runtime_fixture_reaper_sweep.sh` | exit 1 | same (BL-413) |
| `test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh` | exit 1 | same (BL-413) |
| `test_handoffd_stuck_escalation_email_wiring.sh` | exit 1 | pre-existing, unrelated (BL-349, `setsid` absent on macOS: `env: setsid: No such file or directory`) |

None of the four failures mention `illegal time specification`, `touch -d`,
or `date -d` — confirms the actual defect this ticket fixes (GNU-only
relative-time syntax) is gone from all six sites; the four failures surface
strictly *downstream*, pre-existing, out-of-scope macOS gaps the coder's own
evidence already identified and flagged to the specifier as follow-up
candidates, matching this ticket's own "unrelated reason... its own ticket"
carve-out. `BL-413` and `BL-349` (the root-cause tickets for the underlying
features) are already closed (`backlog/done/`); the gaps here are that
their *tests* assert Linux-only guarantees the macOS host cannot meet — a
distinct, correctly-deferred follow-up.

**Minor evidence-bookkeeping note** (not a defect, not bounced): the
coder's own evidence file states "Net: 3 of 6 scripts now reach a clean
exit 0" in its summary line, but its own itemized list two lines above
names only 2 (`test_operator_runtime_sandbox_sweep_bounded_progress.sh`,
`test_operator_runtime_tick.sh`) — matching what this pass independently
reproduced (2 clean, 4 failing on the two named unrelated gaps). Flagging
for the documenter/QA's awareness; does not change scope, acceptance, or
any test's own assertions.

`portableTimeGuard.test.js`'s own zero-violation assertion (`required_wiring`
item 7) re-confirmed passing directly: `npm test` run (below) includes it
green.

## Verification

- `npm run compile`: clean.
- `npm test`: 422/422 files, 7438/7438 tests pass (includes the new
  unsupported-unit test).
- `bl874PortableTimeInvariants.property.test.js` run in isolation: 6/6 pass.
- Six required-wiring sites: run directly, results and causes above.
- Scratch-file break-then-fix (ticket's own e2e step 4): not independently
  re-run this pass — already verified by the coder (evidence, step 4) and
  the architect (invariants review, invariant 1's break/fix on the real
  guard); no new risk surface from this pass's one test addition
  (unrelated function).

## Verdict

One real coverage gap found and closed (`portable_relative_touch_stamp`'s
unsupported-unit path), confirmed non-vacuous. No defect in this ticket's
own scope. The four shell-test failures are confirmed pre-existing,
unrelated, out-of-scope macOS gaps (BL-413, BL-349), independently
reproduced and root-caused, not attributable to this parcel. Forwarding to
documenter.

By hardender.
