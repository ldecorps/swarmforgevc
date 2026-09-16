# BL-1584 — a new property test with a sampled reach floor is refused at send

Coder, 2026-09-16.

## What was built

`swarmforge/scripts/sampled_reach_floor_guard_lib.bb`: one pure classifier
(`classify`) over a property test file's text, `{:verdict :reach-floor?
:constructed? :budget :matched}`, plus the impure send-time gate
(`findings-for-git-handoff`) wired into `swarm_handoff.bb` beside the
BL-1240 unregistered-test gate. `swarmforge/scripts/sampled_reach_floor_census_cli.bb`
runs the SAME classifier (via `census-row-for-text`, the one place it calls
`classify`) over every `extension/test/*.property.test.js` file and prints a
TSV row plus a summary line — never a second notion of reach floor,
construction, or budget (invariant 2), verified directly by property P2b
below rather than trusted by inspection.

Added-only (invariant 1): the gate refuses only a property test file THIS
parcel added (absent at the received commit recorded in the sender's
in_process mailbox, present at the forwarded one) with verdict
`sampled-low`. A merely-modified file, however shaped, is at most a
`SAMPLED_REACH_FLOOR WARNING:` line — never a refusal. Fail-open (invariant
3): an unresolvable task id, an unreadable forwarded commit, an unreadable
recorded received commit, or an unreadable file each warn (or, for no
recorded received commit at all — an ordinary first-hop parcel — stay
silent, same convention `merge_drop_guard_lib.bb`/BL-806 already follow) and
send, never refuse.

## Comments never match — a fix beyond the ticket's own literal text

The ticket's phrase-matching rule for `reach-floor?` already excludes
comments (it only reads inside an `assert(`/`assert.<fn>(` call's own
argument text), but `constructed?`'s `runsPerCell(` check was a bare
substring search over the WHOLE file, no such scoping. My own acceptance
step handler caught this the hard way: scenario 04's fixture appended the
comment `// touched, same shape - no runsPerCell( added` to prove a modified
file's shape was unchanged, and that comment's own text made `constructed?`
return true, silently swallowing the expected warning (verdict flipped from
`sampled-low` to `constructed`, and `decide-for-path` answers nil for a
modified+constructed file). Added `strip-comments` — a string-aware pass
that blanks `//` and `/* */` comments (escape-aware, string/template literal
content untouched) — and run it FIRST in `classify`, before any other check.
This also closes a second latent gap the fixture never happened to hit: a
comment sitting INSIDE an assert call's own argument parens (e.g.
`assert.ok(x, /* never exercised */ 'ok')`) would previously have counted
toward `reach-floor?` too, since the phrase scan reads the whole argument
span. Five unit cases cover this directly (a line comment naming
`runsPerCell(`, a block comment doing the same, a line comment naming
`assertReachFloor(`, a comment inside an assert call's own args, and a
`//`/`/*` occurring inside a STRING, which must NOT be treated as a comment
start).

## Two mint-time table cells corrected

The specifier's own acceptance feature file (scenario 06) pins an exact
verdict AND budget for each of the frozen corpus's 13 files. 11 of 13
matched the classifier exactly on the first run; two did not, and I
corrected them in place (feature file, with a comment explaining why) rather
than bending the classifier to match, because both cells conflict with the
classifier's own one consistent rule that the OTHER 11 rows (including the
harder, symmetric bl1113CursorHotfixStampOff case) confirm:

- `bl1281ReachFloorConstructionInvariants` (verdict `constructed`, so the
  cell is not gate-load-bearing either way): the mint-time table said budget
  `1`. The file carries FIVE draw sites — two `fc.sample(..., { numRuns:
  CELL_RUNS | TOTAL_RUNS })` calls and three `fc.assert` `numRuns:` options
  (`SEED_FLOOR`, the literal `1`, `Object.keys(PRE_CHANGE_FLOORS).length *
  2`) — four of the five are identifiers or computed expressions, not
  integer literals. Per the ticket's own rule ("`:unresolved` when any draw
  site's count is not an integer literal"), the file is `unresolved`, not
  `1`. Corrected.
- `pilotSafeDefects` (verdict `no-floor`, also not load-bearing): the
  mint-time table said budget `80`. The file's three `fc.assert` calls do
  carry literal `80`, `80`, `100`, but it ALSO calls
  `fc.sample(fc.array(TICKET_FIELDS_ARB, {...}), 1)` — a bare-count draw
  site the ticket's own description explicitly names as a fourth literal
  draw site (`fc.sample(<arb>, <int>)`). With it counted, the smallest
  literal is `1`, not `80`. Corrected.

Both corrections are demonstrated non-vacuously by property P2a (an
independently-constructed reference budget/verdict, drawn from the same
piece vocabulary, checked against `classify`'s own answer over 400 runs) and
directly pinned by acceptance scenario 06's own 13-row table, which the
generated test now runs against the corrected values and passes.

## The invariants (BL-654)

`swarmforge/scripts/test/bl1584_sampled_reach_floor_property_runner.bb`,
seeded LCG, 400 runs each, three invariants:

- **P1** (invariant 1): pure, over `decide-for-path`. Stated as an
  equivalence — refuses exactly when `kind=:added` and `verdict=:sampled-low`
  — so a decision table that refused everything or nothing would each fail
  one direction. 10 `{kind verdict}` combinations, floor 10 each (measured:
  1 to 52 — the two smallest, `[:sampled-high :one-literal true]` at 1 per
  100-combination bucket in P2's own coverage map, are P2's cells, not
  P1's; P1's own floor of 10 held on every combination). P1b asserts
  `decide-for-path` never answers more than one `{:action ...}` per path.
- **P2** (invariant 2): file text built from explicit pieces (a random
  known-phrase assert or a plain one, a mix of literal/non-literal `numRuns`
  draw sites or none, an optional `runsPerCell(` call) so every verdict
  class is CONSTRUCTED, not hoped for. P2a checks `classify`'s own verdict
  and budget against an independently-computed reference from the same
  pieces. P2b checks the census CLI's `census-row-for-text` never diverges
  from `classify`'s own answer on identical text — the one-classifier claim,
  asked directly rather than trusted from shared code.
- **P3** (invariant 3): three fail-open shapes against a real (tiny) git
  fixture — an unreadable forwarded commit, an unresolvable task id, an
  unreadable recorded received commit — each drawn with random garbage
  values, floor 5 each (measured 131/132/137).

**Non-vacuity, by breaking the code and running:**

| break | result |
|---|---|
| a modified+sampled-low file is refused instead of warned | P1 FAILS at seed 1440974758 |
| the census CLI's row hard-codes `no-floor` regardless of the real verdict | P2b FAILS at seed 42 |
| an unreadable forwarded commit is answered with a fabricated refusing finding | P3 FAILS at seed 42 |

Restored; ALL PASS.

## The fixture corpus

`specs/pipeline/fixtures/bl1584/*.property.fixture.js` — the 13 named files
copied verbatim from `main` at `42e2979ed5`, renamed so no vitest glob or
manifest sweep ever picks them up. Verified against the real files at that
commit (`git show 42e2979ed5:extension/test/<name>.property.test.js`) before
copying — content is byte-identical.

## Runs

| what | result |
|---|---|
| `sampled_reach_floor_guard_lib_test_runner.bb` | ALL PASS |
| `bl1584_sampled_reach_floor_property_runner.bb` | ALL PASS, 400 runs each |
| BL-1584 acceptance (`specs/pipeline/scripts/run_acceptance.sh`) | **32/32** |
| suite inventory | ok — 520 files, 516 standing, 4 excluded |
| `sampled_reach_floor_census_cli.bb .` over the live tree | 407 rows + summary; 40 constructed, 11 no-draw, 286 no-floor, 18 sampled-high, 52 sampled-low — a difference from the mint-time census (117 with a floor, 7 constructed) is expected: sweep slices BL-1585/1586/1587 and the comment-scoping fix above both moved counts since mint, and the qa_e2e_procedure's own step 1 already anticipates this |

Not run from this pane: the tmux-driving shell suite
(`test_swarm_handoff_*.sh`) and `run_bb_suite.sh` itself, per the
constitution's own tmux-safety warning (BL-657/BL-373 incidents) — QA's own
`qa_e2e_procedure` step 3 (live break-then-restore in a scratch worktree)
covers the real send path from a detached host shell.

## Out of scope, untouched

Sweeping the 108 pre-existing files (BL-1585/1586/1587 and the epic's
remaining slices); per-`fc.assert` classification (epic follow-up slice);
`extension/test/helpers/reachFloors.js` and every live property test file —
`git diff main...HEAD --name-only` names only the lib, the CLI, the
`swarm_handoff.bb` wiring, the fixture corpus, the feature file (two data
cells), the manifest row, and the step handler; no
`extension/test/*.property.test.js` path appears.
