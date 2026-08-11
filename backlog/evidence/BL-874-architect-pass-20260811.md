# BL-874 — architect pass — 2026-08-11

## Scope reviewed

Parcel received from cleaner at `328211e3e5` (same merge commit as
BL-871, forwarded as a separate `git_handoff` per Article 2.6 — own
evidence file `BL-871-architect-pass-20260811.md`). Coder commit in scope:
`313615756`..`30c8fe251a` — "BL-874: portable relative-mtime helper for
shell tests, standing guard".

Files touched: `swarmforge/scripts/portable_time_lib.sh` (new),
`specs/pipeline/steps/lib/portableTimeGuard.js` (new),
`extension/test/portableTimeGuard.test.js` (new, standing gate),
`extension/test/bl874PortableTimeInvariants.property.test.js` (new), and
the six named `swarmforge/scripts/test/test_operator_runtime_*` /
`test_handoffd_stuck_escalation_email_wiring.sh` sites that now source the
shared helper.

## required_wiring — re-verified fresh, not taken on the coder's word

Grepped all seven `required_wiring` sites directly for
`portable_time_lib.sh` / `portable_touch_relative` / any remaining inline
`date -d` / `touch -d`: all five explicitly named sites, plus the sixth
(`test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh`, same
shape, not separately named but sharing the identical defect per the
coder's own note) source the lib and call `portable_touch_relative`. Zero
remaining inline GNU-only invocations at any of the six. The seventh wiring
item (`portableTimeGuard.test.js`'s zero-violation assertion sitting in
the standing per-parcel suite) confirmed present and confirmed
`portableTimeGuard.test.js` matches `vitest.config.mjs`'s default include
(only `**/*.property.test.js` is excluded there) — it runs in the suite
every parcel runs, not a suite nothing runs.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against every file this task
touched: **PASSED, no forbidden edges.**

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the same file set:
the six `test_operator_runtime_*`/`test_handoffd_*` sibling files report
high mutual co-change counts ("SUSPECTED COUPLING") with each other and
with `operator_runtime.bb`/`operator_lib.bb`. Expected and benign — this
is the same sibling-file family BL-874 itself deliberately touches all six
members of for the identical defect class (mirroring BL-872's precedent
for the same family). `index.js` again shows the same registry-wide
high-frequency coupling noted in every prior pass; not new here. No
coupling defect found.

## Invariants review (BL-654)

All three declared invariants have executable encodings in
`bl874PortableTimeInvariants.property.test.js`, coder-authored. Non-vacuity
independently confirmed for the two generative ones — broke the real
implementation, watched the test fail, restored via `git checkout`,
re-ran green:

1. *"One shared helper, no inline reimplementation."* Fuzzes
   `portableTimeGuard.js`'s classifier over generated inline-violation and
   helper-based shapes (surrounding noise, quote style, cmd, relative-time
   spec). Broke it by forcing the regex match to always be `null` — test
   failed immediately (`expected: true, received: null`). Restored.
2. *"A new violation turns the gate red in the introducing parcel."*
   Non-generative/structural by design (ticket's own text: "there is no
   input domain to vary"), mirroring `tempDirTrapGuard.property.test.js`'s
   precedent for the same invariant shape. Asserts `findPortableTimeViolation`
   is defined in exactly one file repo-wide and that the standing test file
   contains the zero-violation assertion — both checked against the real
   files on disk, inherently non-vacuous (would fail if the guard were
   duplicated or the standing assertion removed).
3. *"Same relative input → same resulting mtime on BSD and GNU."* Honest,
   stated scope limit: this host has no GNU coreutils, so only the BSD
   branch (the newly-added arithmetic) is exercised; the GNU branch
   forwards the six original tests' own pre-existing syntax verbatim,
   unchanged by this ticket. Drives the real shared lib via a real bash
   subprocess for amount 1–500 across seconds/minutes/hours, reading the
   real resulting mtime back. Broke it by mis-mapping the `minute` unit
   letter to `S` instead of `M` — test failed ("expected mtime within
   2093ms ... diff 58961.5ms"). Restored.

## Property testing pass (architect-owned)

`portableTimeGuard.js` (the one new pure module) is already covered
comprehensively by the coder's own invariant-1/2 property tests plus
`portableTimeGuard.test.js`'s example-based and break/fix-on-real-fs
cases. `portable_time_lib.sh` is a shell function, not property-testable
directly with fast-check, and is exercised via invariant 3's real-subprocess
property test. No undercovered pure module found; nothing added.

## Scope discipline

Coder's evidence flags two pre-existing, unrelated macOS gaps found while
running the six previously-red scripts past the point that used to crash
(`/proc`-based liveness detection, BL-413; `setsid` absence, BL-349) as
follow-up candidates for the specifier rather than folding a fix for
either into this parcel. Read `operator_runtime.bb`'s `live-process-paths!`
directly to confirm the `/proc` dependency is real and pre-existing
(BL-413, dated a month before this ticket) — correct call to leave both
out; neither is GNU-relative-time syntax, which is this ticket's only
declared scope.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener, no changes made.

By architect.
