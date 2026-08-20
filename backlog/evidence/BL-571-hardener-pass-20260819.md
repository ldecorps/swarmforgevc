# BL-571 — hardener pass (2026-08-19/20)

Task: `BL-571-sequential-rotation-dormant-parity`
Received from: architect `71f250cb26` (review pass 2, D1 closed, PASS)
Worktree: `.worktrees/hardender`, branch `swarmforge-hardender`

## Verdict

**PASS — forwarded to documenter.** Two real defects found and fixed in this
pass (one surviving mutant, one side-effecting test fixture). No bounce.

## Host conditions

Load average ran **69–340 on 4 cores** (17x–85x) for the whole pass, from
concurrent agent worktrees. Per the role's load rules this **rules out
Stryker/full-suite mutation entirely** — see "Gates not run" below. It is also
why the shell suite was run detached (the 120s tool ceiling) and why one run
was killed mid-flight.

## Gates run

| Gate | Result |
|---|---|
| `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` (qa_e2e step 2) | **ok** — incl. the D1 bash↔Babashka parity gate |
| `bb .../bl571_single_resident_rotation_property_runner.bb` (step 3) | **ok** — 500 runs (246 positive, 120 sequential, 254 negative) |
| `bash swarmforge/scripts/test/test_swarm_ensure.sh` (step 1) | **40 PASS / 0 FAIL** at furthest reach, incl. all four BL-571-relevant cases; **tail BLOCKED BY host load** — see below |
| `run_acceptance.sh` on the ticket's feature | **4/4 pass**, exit 0 |
| Standing whole-tree guards (`extension/test/*Guard*.test.js`, 7 files) | **51/51 pass** |
| qa_e2e step 6 — ROTATE_HOME pin | **unchanged vs `main`**; both `ready_for_next_*.bb` still consume the router-only `conf-rotation-router?` |

The four BL-571-relevant shell cases all PASS:
`BL-571: rotation sequential dormant roles report DORMANT without respawn`,
the pre-existing `mono-router dormant` case, the `BL-537` no-launch-script
case, and the classic-pack regression guard.

### Two notes on the shell suite

1. **05g flaked once, then passed.** Run 1 failed
   `05g: cursor-bridge repair not reported as FIXED` with an **empty** `$OUT`
   (no stdout, no stderr, nonzero exit — a killed process). Attributed as NOT
   BL-571: `make_fixture` writes no `swarm-identity`, so this parcel's
   predicate change is inert for that scenario. Re-run under lower load:
   **05g PASSED**. Load-induced, not a defect.
2. **The suite is first-failure-stop** (`fail() { ...; exit 1; }`), so run 1
   never reached the BL-571 case at all. Run 2 did, and passed it.
3. **No run completed the tail, and none failed.** Run 2 reached **40 PASS /
   0 FAIL** and run 3 (post-H2 fix) reached **31 PASS / 0 FAIL** — both past
   every BL-571 case — before being killed under load (267 on 4 cores),
   leaving no `EXIT=` line. The tail from `RC-9` onward is recorded
   **BLOCKED BY host saturation**, never as passing. Nothing in any run
   failed except the 05g flake resolved above.
4. **A second leaked `babysitterd` orphan** (`.../tmp.H7GbYuKz`, PPID 1) came
   out of run 3 — from one of the **pre-existing** blocks, since BL-571's own
   block was fenced off by then. That is independent confirmation of the
   surfaced pre-existing defect below. Reaped with a bounded confirmed
   TERM→KILL; re-verified gone.

## Defects found and FIXED in this pass

### H1 — a surviving mutant: the line anchor was untested (mutation gap)

`rotation-declared-in-conf?`'s docstring claims *"a commented mention or a
longer word (`sequentially`) never matches"*. The longer-word half was pinned;
**the anchor half was not**. Verified by construction: a mutant dropping `^`
from the pattern **agrees with the original on every fixture in the file** —
the entire existing suite is blind to it.

Fixed by pinning the anchor with the only shapes that discriminate it (a
commented line, a mid-line mention) for **both** value-sets, plus a
later-line fixture pinning the `(?m)` flag.

**Non-vacuity proven by actually applying each mutant and restoring:**
- `^` removed → 3 new assertions FAIL (previously: whole suite green).
- `(?m)` removed → the later-line assertion FAILS.

### H2 — the acceptance fixture ran REAL commands and leaked a daemon

The step handler set `SWARMFORGE_ENSURE_EXTENSION_CHECK` / `_BOUNCE` /
`SWARMFORGE_ENSURE_SUPERVISOR`. `swarm_ensure.bb` reads **none of those** — the
names it actually reads are `SWARM_ENSURE_EXTENSION_CHECK_CMD`,
`SWARM_ENSURE_EXTENSION_BOUNCE_CMD`, `SWARM_ENSURE_SUPERVISOR_CMD`. Under the
wrong spelling the stubs were **inert**, so ensure invoked the **real**
extension-host bounce and the **real** daemon start against a `$TMPDIR`
fixture root.

The scenario still passed throughout — it only asserts `DORMANT` and the
respawn log — so nothing in the suite could see it. Measured evidence:

- A live `start-extension` process was observed spawning during the run.
- A **PPID-1 `babysitterd.sh` orphan rooted at `/private/var/folders/.../tmp.1fgmyswD`**
  survived the run (alive 11 min). Reaped with a bounded, confirmed
  TERM→KILL; re-verified gone.
- Acceptance duration **270s → 59s** after the fix — at *higher* load
  (260 vs 200), i.e. a 4.6x speedup attributable to no longer starting real
  processes.
- Post-fix re-run: **4/4 pass, zero orphans, clean `git status`.**

Also fenced off `SWARMFORGE_SKIP_CURSOR_BRIDGE` / `SWARMFORGE_SKIP_BABYSITTERD`
(the demonstrated leak vector), and corrected BL-571's own block in
`test_swarm_ensure.sh`, which carried the same wrong names *and* pointed
`SWARMFORGE_ENSURE_SUPERVISOR` at `fake_supervisor.bb` — **a file
`make_fixture` never creates**.

**Concurrent-writer note (surfaced, not hidden):** part of the H2 fix in
`bl571SequentialRotationDormantParitySteps.js` (the three `*_CMD` renames and
the `fake_daemon_start.sh` stub) appeared in this worktree **authored by
another session** while this pass was in progress — the working tree changed
under me between two greps. I had independently diagnosed the identical defect
and verified its effects, and the change is correct, so it is adopted and
completed here rather than reverted. Flagging it because an unannounced
concurrent write into a role worktree is itself worth knowing about.

## The pre-existing siblings — swept by a concurrent session, NOT by me

The `SWARMFORGE_ENSURE_*` misspelling is **pre-existing on `main`**: BL-571
copied it from the BL-530 block. There were **8 such blocks** in
`test_swarm_ensure.sh`, every one pointing `SWARMFORGE_ENSURE_SUPERVISOR` at
the nonexistent `fake_supervisor.bb`, so every one ran the real extension
bounce and real daemon start against a temp root. This plausibly explains why
this suite takes 8+ minutes and leaks daemons.

I deliberately scoped this OUT and fixed only BL-571's own block. **While this
pass was running, a concurrent session swept the other 7 blocks in my
worktree** — the same unannounced writer as the H2 note above. So the parcel
now carries the full sweep, which was **not my scope decision**.

I did not revert it: the change is correct in direction, it is the defect I
had already diagnosed and measured, and deleting another session's work is not
mine to do. But I will not overstate its verification:

- **Statically verified (by me, passing):** every `SWARM_ENSURE_*` name used
  in the file is one `swarm_ensure.bb` actually reads (set-compared, no
  leftovers), the wrong spelling survives only inside a comment, and every
  referenced stub (`fake_daemon_start.sh`) is one `make_fixture` really
  creates. `fake_supervisor.bb` is no longer referenced by any code path.
- **NOT verified by a completed suite run.** The swept file's run reached
  **7 PASS / 0 FAIL** before the host killed it. Runs 2 and 3 (40 and 31
  PASS, 0 FAIL) predate the sweep.

**QA: please run qa_e2e step 1 to completion on a quiet host.** No run in this
pass completed the tail, so the suite's `RC-9`-onward cases are unverified
against the swept fixtures — by anyone.

## Gates NOT run (BLOCKED — never recorded as passing)

- **Stryker language mutation** — BLOCKED BY host load (17x–85x cores). The
  role's load rules forbid even a concurrency=1 differential run in this
  condition. This parcel's production change is Babashka + bash, which per
  engineering.prompt Startup Tools has **no mutation/CRAP/DRY wired at all**;
  the degraded fallback (its own unit suites) is what ran, and is recorded as
  such rather than implied to be a mutation pass.
- **CRAP / DRY** — not applicable: no TypeScript changed for BL-571. (The TS
  in this branch belongs to BL-935, already hardened and forwarded.)
- **BL-113 Gherkin acceptance mutation** — BLOCKED BY host load. The feature
  does carry a `Scenario Outline`, so the gate is applicable and is NOT
  claimed as passed.
  Mitigating static evidence: the `<rotation>` handler is **key-driven, not
  shape-driven** (BL-908) — it asserts the captured value against an explicit
  `KNOWN_VALUES` set and writes it into `swarm-identity`, so a mutated cell
  throws rather than silently re-running the same test. First deferral for
  this ticket; per the role's escalation rule a second stall with the
  flat-CPU signature would be a tool defect to ticket, not a third deferral.

## Cleanliness

`pgrep` for `node --test|stryker|mutationWorker|gherkin-mutator` clean;
no fixture-rooted processes from this worktree; no leaked
`*.property.test.js`; `git status` clean apart from this pass's own commit.
