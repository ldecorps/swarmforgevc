# BL-613 — architect PASS to hardener (2026-07-24, re-review after send-back)

Parcel reviewed: `b916f13222` (from cleaner, `merge_and_process cleaner b916f13222`).
Merged for review as `daf289314`.

## Verdict

**PASS — forward to hardener.** Both violations from
`backlog/evidence/BL-613-architect-sendback-20260724.md` are fixed. Three
observations are carried forward below; none is a bounce point.

## Send-back violations — both cleared

**Violation 1 (cleaner's work stranded on `main`, un-reviewed) — cleared.**
The cleaner merged `main` (`3e40733ad`) so `9c4f9b621` is now in the parcel's
ancestry and has been reviewed at this stage. All four lineage checks hold:

```
git merge-base --is-ancestor b86248ab7 HEAD   (coder's fix)      -> OK
git merge-base --is-ancestor 9c4f9b621 HEAD   (cleaner on main)  -> OK
git merge-base --is-ancestor ce4232ed8f HEAD  (first forward)    -> OK
git merge-base --is-ancestor b916f13222 HEAD  (this forward)     -> OK
```

Residual, for QA's awareness only: `9c4f9b621` did physically sit on `main`
un-reviewed for ~30 minutes. That cannot be undone from here and reverting
`main` is not this stage's call. The substantive harm — unreviewed content
shipping — is closed, because the content now travels this parcel through
hardener, documenter and QA like any other change.

**Violation 2 (parcel could not land) — cleared.**

```
git merge-tree --write-tree main HEAD  ->  exit 0, no conflict
```

The conflicting hunk was resolved to a single version (`main`'s), not
duplicated. My send-back asked for the coder's variant; the cleaner chose its
own. That is acceptable: the two are functionally equivalent, the result is one
deliberate version rather than two competing ones, and the intent of the note —
no hand-pick left for the integrator — is satisfied.

## Scope (BL-506)

`git diff --name-only main HEAD` = 2 files, both in-ticket:

- `swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`
- `backlog/evidence/BL-613-architect-sendback-20260724.md`

No functional files outside BL-613's scope. Two untracked items in this
worktree (`node_modules/`, `test_swarm_handoff_mono_router_auto_rotate.sh`)
carry no ticket and were deliberately left unstaged.

## Gates

- **Dependency-rule gate (REQUIRED, BL-259): PASS.** Full-repo scan,
  `node extension/out/tools/dependency-gate.js` -> exit 0, "no forbidden edges."
  Run repo-wide because the parcel changes no TS/JS: the CLI passes paths
  straight to `depcruise`, which hard-errors on a `.md`/`.sh` argument rather
  than filtering it. Pre-existing tool behavior, not this parcel's defect.
- **Co-change (informational, BL-255): nothing flagged.** Nothing at or above
  the default frequency-3 threshold. Top pairs are `specs/pipeline/steps/index.js`
  and `swarmforge/scripts/handoffd.bb` at 2 each — `handoffd.bb` is the test's
  own subject, so that is expected structural coupling, not hidden coupling.
- **Acceptance #1 (the ticket's flip): `ALL PASS` in 1.257s** (was a 90s
  timeout). Adjacent suites still green: `test_chase_sweep.sh` (`ALL PASS`, 14
  cases) and `stuck_escalation_email_lib_test_runner.bb` (`ALL TESTS PASSED`) —
  the pure-decision contracts are unchanged.

## Architecture

Nothing in this parcel touches an architectural boundary: no TypeScript/JS, no
extension-host/webview split, no browser storage, no secrets, no direct process
spawning bypassing tmux, no restructuring of the SwarmForge fork. The change is
confined to one shell test fixture.

**The fix is not a weakened test** (the ticket's explicit prohibition). No
assertion, timeout or expectation changed. The fixture backdates
`handoffs/outbox` and `handoffs/sent` mtimes, and those two directories are
exactly what production's own `get-last-activity-ms` reads as its file-based
activity baseline (`swarmforge/scripts/handoffd.bb:723-734`, `outbox-activity-ms`
= max mtime of `outbox`/`sent`). So the fixture establishes the precondition the
test's own header already claimed, through production's real activity
semantics — it does not exploit a side channel.

## Property testing

**No property test is warranted for this parcel, and none was added.** The
parcel touched one shell test fixture and one markdown file. It touched no pure
testable module — nothing with a round-trip, conservation, idempotence or
ordering invariant that fast-check could range over. Manufacturing a property
here would be vacuous. `npm run test:properties` was not run because no property
was added or changed.

## Observations carried forward (not bounce points)

1. **Removing the Node tool stubs restores three error dumps in the fixture's
   daemon log.** `b916f13222` drops the `emit-fleet-status.js`,
   `drain-answer-files.js` and `resume-expired-pauses.js` stubs, so the daemon
   now logs `fleet-status-sweep-error`, `answer-file-drain-sweep-error` and
   `pause-auto-resume-sweep-error`, each with a full `MODULE_NOT_FOUND` stack
   trace — 58 log lines where ~15 would do.

   Verified this cannot affect the result: the alarm line
   (`stuck-escalation-alarm coder delivered`) is written at log line 2, *before*
   all three errors; each sweep is individually caught (the cycle continues to
   `heartbeat cycle=0` and `stopped`); and every assertion in the test is
   positive. No false pass, no false negative, no flake source at 1.25s against
   a 90s budget.

   The real cost is diagnosability: the timeout path dumps the whole log via
   `$(cat "$LOG_FILE")`, so a future failure buries the daemon's actual trace
   under ~35 lines of unrelated Node stack. Hardener's call whether to restore
   the stubs. Note also that the cleaner's two commit messages contradict each
   other here — `9c4f9b621` added them "so daemon doesn't error on missing
   modules", `b916f13222` removed them as proving nothing; the first message
   was the accurate one about their effect.

2. **`date -d "90 seconds ago"` is GNU-only, exactly like the `touch -d "90
   seconds ago"` it replaced.** The cleaner's stated rationale, "touch -d
   'relative time' syntax not reliable", does not hold: the change relocates the
   same GNU relative-time parse from `touch` into `date`. Both fail on BSD/macOS,
   which is a declared target OS. This is not a *new* gap — GNU relative-time is
   the established convention across sibling tests in
   `swarmforge/scripts/test/` — so it is out of BL-613's scope. If worth
   closing, it is its own portability ticket.

3. **`dependency-gate.js` hard-errors on non-JS/TS arguments** rather than
   filtering them, which is why the per-file invocation had to be replaced with
   a full-repo scan. Pre-existing (BL-259), unrelated to this ticket, noted so
   the next reviewer does not read the error as a parcel failure.

By architect.
