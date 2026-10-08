# BL-1880 — coder bounce-fix evidence (2026-10-07)

QA bounce (bounce_count 1, backlog/evidence/BL-1880-QA-20261007.md, commit
c5c4c50d1e): 4 defects, all in `extension/src/tools/qa-bounce-line.ts` and
its step handler. Omission/insufficiency bounce — nothing reverted.

## D1 — the window's own bouncing-role split never printed; all-time clauses unlabelled

`formatBounceWindowLine` printed `report.allTimeByBouncingRole` right after
the window's producing-role split with no label, so it read as a breakdown
of the window total above it; `report.windowByBouncingRole` (already
computed, already in the JSON) never appeared on the line at all.

Fixed: the window segment now prints `report.windowByBouncingRole`
immediately after the producing-role split; the all-time bouncing-role and
ticket-type clauses are each explicitly prefixed `all-time by ...`. The
line's ending (`all-time total: N`) is unchanged, so scenario 05's
"labelled all-time, last" still holds literally.

Live check (QA's own repro command) now prints:

    Bounces since 2026-10-06T02:43:34+01:00: 22 - by producing role: coder x21 (...), hardender x1 (...) - by bouncing role: QA x20, architect x2 - all-time by bouncing role: QA x288, architect x155, ... - all-time by ticket type: defect x344, ... (1.0 defects/bounce) - all-time total: 552

the window's own `QA x20, architect x2` is now readable right after the
producing-role split, and every clause after it is labelled `all-time`.

## D2 — scenario 06's own step checked a subset, not every count

`bl1880BriefingBounceWindowSteps.js`'s "every count in the JSON equals the
count the line prints" step asserted `windowTotal`, `allTimeTotal`, and
each `windowByProducingRole` role's count — never `windowByBouncingRole`
or any role's `trend` array, so it passed green while D1's own bug (the
window bouncing-role split missing from the line entirely) sat right next
to it unnoticed.

Fixed: the step now also asserts each `windowByProducingRole` entry's
`trend` values appear in its own role clause, and each
`windowByBouncingRole` entry appears in the WINDOW segment specifically
(checked against the line split at `- all-time`, so a count that only
happens to appear in the all-time segment does not accidentally satisfy
the assertion).

## D3 — window start was the briefing file's own commit, not the send

`findPreviousBriefingSentAtIso` read `git log --follow` on the previous
day's `docs/briefings/<day>.md` file — when the FILE was committed, not
when it was SENT. The email sweep commits the file, sends it, then
separately commits `docs/briefings/.sent.json`'s "record sent marker" —
measured 5h28m apart on 2026-10-02 (00:35Z file commit vs 06:03Z send).
Reading the file's own commit left a gap between two consecutive windows
in which a bounce was counted twice.

Fixed: the function now finds the commit that ADDED the day's key to
`.sent.json` via `git log -S'"<day>.md"'` (the pickaxe: the commit whose
diff changed the number of occurrences of the exact quoted JSON string) —
since a day key, once added, is never removed or re-added in practice,
exactly one commit matches. Falls back to the oldest matching commit if
more than one ever did (same defensive posture the file-commit approach
used), confirmed by a test that contrives a remove-then-readd history.

Live check: `git log -S'"2026-10-06.md"' --format=%aI -- docs/briefings/.sent.json`
→ `2026-10-06T02:43:34+01:00`, matching `fa6eb647b6`'s own commit date
exactly; the live CLI's `windowStartIso` now reads the same value (see D1's
live check above).

## D4 — the window had no upper bound at the render time

`recordsAfter` filtered only `at > start`, with no upper bound — a render
behind the wall clock (`--at` injects exactly this case) counted bounces
that happened AFTER the moment it is reporting for.

Fixed: `recordsAfter` now takes `nowIso` and filters `start < at <= now`.
Its one call site (`buildBounceWindowReport`) passes the report's own
`nowIso` through. `computeSevenDayTrend` already bounded itself at
`nowIso`; this closes the same gap for `windowTotal`/`windowByProducingRole`/
`windowByBouncingRole`, which all derive from the same `windowRecords`.

## Invariants (BL-654) — extended, not rewritten

`extension/test/qaBounceWindow.property.test.js` (existing file from the
first pass):

- Invariant 1's own test: the `removed-in-window` classification now
  requires `at-or-before NOW` too (D4) — a removed FUTURE record (the
  generator's own `offsetFromNowMs` can be negative, "slightly in the
  future") no longer wrongly expects `windowTotal` to drop, since it was
  never counted in the first place.
- Invariant 2's own test: updated `recordsAfter` call for the new 3-arg
  signature.
- New case (QA's own remediation pointer for D3): "two consecutive
  renders, each at its own send time, never share a bounce" — pure over
  `recordsAfter` itself, building window A = (t0, t1] and window B =
  (t1, t2] from one record at an arbitrary offset from the shared
  boundary t1 (before A, inside A, exactly at the boundary, inside B,
  after B — by construction), asserting a record is never counted in
  both. 100 runs, floor 10 on each of the 5 shapes.

**Non-vacuity**: every new/changed assertion above is proven by the real
bug it targets — D1's live repro genuinely printed the old mislabelled
line against the pre-fix binary (QA's own evidence); D3's fix is checked
against the real `.sent.json` history (`git log -S`, confirmed to match
`fa6eb647b6`'s real commit date); D4's new unit case
(`recordsAfter excludes a record exactly at, and after, the render time`)
and the new two-consecutive-renders property case both fail without their
respective fixes by construction (a record after `now` only gets excluded
because of the new upper-bound clause; two windows only stay disjoint
because `recordsAfter`'s own start/end comparison is exclusive-then-inclusive
in the right order).

## Scope

`extension/src/tools/qa-bounce-line.ts`, its two test files, the step
handler. No file outside these four changed.

## Verification at this commit

| check | result |
|---|---|
| `npm run compile` | clean |
| `npx vitest run test/qaBounceLineCli.test.js` | 40/40 (added 2 D4 cases, 1 D1 strengthening, rewrote 1 D3 fixture-dependent case; all commitBriefingFile call sites now also commit `.sent.json`) |
| `npx vitest run --config vitest.properties.config.mjs test/qaBounceWindow.property.test.js` | 3/3 (2 existing invariants, 1 new D3 case), non-vacuous |
| `run_acceptance.sh` BL-1880 feature | 6/6, including the strengthened scenario 06 |
| `run_acceptance.sh` BL-454/635/688/689 (regression) | 8/8, 15/15, 15/15, 10/10 — unchanged |
| Live repro against the real repo (`qa-bounce-line.js --target <main worktree>`, and `--json`) | window start matches `.sent.json`'s own send-marker commit; window bouncing-role split now on the line; all-time clauses labelled |
| `npm test` (full unit lane, run standalone via `npx vitest run` to avoid an unrelated host-load-dependent BL-871 RPC-heartbeat flake in the wrapper script - see note below) | 656 files / 11253 tests, 0 failed, 0 unhandled errors |
| `node --test` specs/pipeline/test lane (run standalone, same reason) | 360/360 |
| `npm run test:properties` (full property lane) | 526 files / 1451 tests, 0 failed; 3 unhandled errors, all the allowlisted BL-871 `onTaskUpdate` timeout |

**Note on `npm test`'s wrapper exit code**: one full `npm test` run this
session exited 1 with every individual test passing (656/656, 11253/11253)
because of 50 instances of the allowlisted BL-871
`[vitest-worker]: Timeout calling "onTaskUpdate"` RPC-heartbeat timeout -
documented as property-lane-only in the engineering rules, but the same
vitest-internal mechanism (a worker blocked in a long synchronous
subprocess call starves its own heartbeat) is not actually lane-specific;
`vitest.config.mjs` (the unit lane) does not set
`dangerouslyIgnoreUnhandledErrors`, so it surfaced there under unusually
high host load (518s of work that run, against prior same-session runs
around 230-400s). Re-running the unit lane standalone (`npx vitest run`,
no wrapper) immediately after, on the identical commit, passed with 0
unhandled errors. Not touched by, or related to, this parcel's diff.

By coder.
