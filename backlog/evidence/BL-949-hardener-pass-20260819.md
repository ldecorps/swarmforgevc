# BL-949 hardener pass — 2026-08-19

## Reviewed commit
`e461848af9` ("BL-949: architect pass - wiring tests are non-vacuous and
scoped to what they prove, forwarding to hardener"), merged into hardener
as this parcel. No bounce.

## Why this pass mattered beyond the usual
This is the actual fix for the `conciergeTick.test.js` red baseline that
QA's BL-631 pass had to triage around, and that BL-950 (hardened earlier
today) now permanently gates against recurring untraced. Getting the
non-vacuity check right here is the whole point of the ticket — a
"corrected" test that quietly became vacuous would look identical to a
real fix in every suite re-run.

## Scope, precisely
`git show --stat 896e1d5cb` — 3 files: `extension/test/conciergeTick.test.js`
(2 tests re-expressed), the new acceptance step handler, `index.js`'s
registry line. No `extension/src/` file touched (constraints forbid it),
no `pipelineBoard.test.js` touched.

## Tooling scope check
`extension/test/conciergeTick.test.js` is touched, but no
`extension/src/*.ts` file is — Stryker (`--mutate` scoped to compiled
`out/**/*.js` from `src/`) and CRAP/DRY (both scoped to `src/*.ts`) are
therefore still inapplicable, same as the constraint that forced this
distinction on every ticket this session.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load 35–50 on 4 cores. Neither
   changed file uses `mkdtemp` or starts a tmux server (grepped both —
   zero matches), so the two standing whole-tree guards from this
   session's own rule don't structurally apply here regardless of load.
2. **Independent re-run of both files' own tests**:
   - `npx vitest run test/conciergeTick.test.js` — **111/111 pass**
     (was 2 failed | 109 passed on `main` before this fix).
   - `run_acceptance.sh
     specs/features/BL-949-concierge-board-wiring-asserts-the-live-layout.feature`
     — **5/5 PASS**.
3. **Own independent non-vacuity break, on a DIFFERENT break point than
   the architect already tested** (architect broke the role-held join;
   I broke the active-membership join instead, for genuinely new
   coverage rather than a duplicate check): edited
   `conciergeTick.ts:575` from `activeIds: activeMembershipIds(folders)`
   to `activeIds: []`, recompiled, re-ran the suite — **7 failures**,
   including `BL-473: a ticket physically in backlog/active/ that no
   role holds still renders, in the not-started state` (the exact test
   this break point's own commit-message claim names). The other 6
   failures are pre-existing tests elsewhere in the same file that also
   depend on active membership — broader collateral than a narrowly
   scoped break, which is reassuring context (active-membership is
   genuinely load-bearing suite-wide, not a coincidence this one test
   happens to touch) rather than a concern. Restored the source line,
   recompiled, reconfirmed **111/111 green** and `git status --short`
   clean.
4. **Invariant 1, independently re-confirmed by grep**: `grep -n
   'u00a0' extension/test/conciergeTick.test.js` — both hits are inside
   a `norm`/`norm473` normalization helper (`l.replace(/ /g, ' ')`),
   never an expected literal. Matches the ticket's own qa_e2e_procedure
   step 4 exactly.
5. **Required wiring**: `bl949ConciergeBoardWiringSteps` confirmed
   registered in `specs/pipeline/steps/index.js` (grepped directly).
6. **Leak/process check**: `git status --short` clean; no fixture
   dirs or processes to check (neither changed file spawns any).

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (constraints
forbid touching `extension/src/`, so the scope stays outside those
tools' reach even though a test file was touched). Independently
re-verified invariant 2's non-vacuity claim on a break point the
architect had not already exercised, confirming the fix genuinely
depends on the active-membership join and not merely on the role-held
join alone. Invariant 1 and the required wiring both independently
reconfirmed.

Forwarding to documenter.

By hardener.
