# BL-537 — architect review: PASS to hardener (round 2)

- Ticket: BL-537 "Mono-router: missing rotate-target session must heal, not report healthy-dormant"
- Reviewed commit: `9314557456` (from cleaner)
- Reviewed at: 2026-07-23
- Prior bounce history: my own round-1 SEND BACK (`b5c620341`,
  `backlog/evidence/BL-537-architect-bounce.md`). Per BL-340 I also checked the
  `main` ref — `git log main -- 'backlog/evidence/BL-537*'` is empty, so no QA
  bounce has ever landed for this ticket. Round 1 was the only prior bounce.

## Verdict

**PASS — forward to hardener.** Both round-1 findings are fixed exactly as
specified, and I re-verified the fixes rather than trusting the commit message.

## Round-1 findings — both resolved

### Finding 1 — resident-identity duplicated at the IO edge → FIXED

`swarm_ensure.bb:550` now reads:

```clojure
resident-session (some #(when (= :resident (mono-router-lib/classify-role ordered (:role %)))
                          (:session %))
                       rows)
```

`resident-role-name` is gone. I verified the substitution is **semantically
identical**, not merely plausible, by reading `mono_router_lib.bb:37-47`:
`classify-role`'s resident rule is `(first (remove #(= "coordinator" %) roles))`
— verbatim the expression that was deleted. Edge cases also agree:

- `role = "coordinator"`: `classify-role` returns `:coordinator` (cond order),
  so coordinator can never classify `:resident`. The old code excluded
  coordinator from `resident-role-name`, so it never matched either. Same.
- a row whose role is absent from `ordered`: `classify-role` → `:dormant`;
  old code → no match. Neither selects it. Same.

The topology rule now has exactly one owner, so the BL-571 move to
`config rotation_home` changes one place instead of silently diverging.

### Finding 2 — policy decision at the IO edge → FIXED

`mono_router_lib.bb:66-81` now hosts pure `rotate-viable?`; `swarm_ensure.bb`'s
`dormant-rotate-viable?` keeps only the two probes (`pane-alive?`, `fs/exists?`)
and delegates the decision. `rotate-target-launch-script` correctly stayed at the
edge as path IO.

Both preservation requirements I named in round 1 hold:

1. **Reason precedence stayed resident-first** — and it is now *asserted*, not
   just present (`"rotate-viable: resident-first precedence when both broken"`).
2. **Eager probe evaluation was kept** — both probes are evaluated in the map
   literal; laziness was not reintroduced.

`rotate-viable?` also **fails closed**: a missing/nil key destructures to falsy
and reports not-viable, never a false `:viable? true`.

## Non-vacuity check on the new precedence assertion

The precedence guarantee is the one thing I explicitly required be preserved, so
I proved its test actually holds it. I swapped the `cond` order in
`rotate-viable?` (launch-script checked first) and re-ran the runner:

```
FAIL: rotate-viable: resident-first precedence when both broken
  expected: {:viable? false, :reason "no live resident session to rotate from"}
  actual:   {:viable? false, :reason "missing launch script for role"}
```

Runner exit code in the broken state: **1** — so this is a real gate, not a
printed message. File restored; `git diff 9314557456 HEAD -- swarmforge/scripts/mono_router_lib.bb`
is empty and the runner is green again.

## Gates run

- **Dependency-rule gate (REQUIRED HARD GATE):** full-repo scan
  `node extension/out/tools/dependency-gate.js` → **PASSED: no forbidden edges.**
  Per-file invocation is not applicable — no parcel file is extension TS/JS and
  the gate resolves paths relative to `extension/`.
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` → **ok** (includes
  all four `rotate-viable?` input combinations).
- `env -u SWARMFORGE_CONFIG bash swarmforge/scripts/test/test_swarm_ensure.sh` →
  **ALL PASS**, 27 cases, including both BL-537 cases and the BL-530 round-3
  classic-pack regression guard.
- `npm run test:properties` → **9 files / 27 tests passed.**

## Property-testing assessment (architect-owned) — no new property warranted

Stated explicitly rather than manufacturing a vacuous one:

- The only pure module this parcel touched is `mono_router_lib.bb`, which is
  **Babashka**. The project's pinned property framework is fast-check (JS,
  `*.property.test.js`); it cannot exercise a `.bb` module, and per
  engineering.prompt Babashka mutation/CRAP/DRY/property tooling is not wired
  (tracked, deferred, as BL-472).
- Independently of that language barrier, `rotate-viable?` is a **total function
  over a two-boolean domain — four possible inputs — and all four are already
  asserted exhaustively** in `mono_router_lib_test_runner.bb`. Exhaustive
  enumeration strictly dominates generative property testing on a four-point
  domain; a property here would add nothing.
- The JS property suite was run as a regression check and is green.

## Correctness review (per the BL-333 rule)

I looked for a concrete defect to send back, not only architectural shape, and
found none. Specifically re-confirmed on the reworked code:

- Resident-before-dormant ordering is still structurally guaranteed:
  `resident-session` is only the session *name*; the liveness probe runs inside
  `dormant-rotate-viable?` when the dormant row is processed. `mapv` is eager and
  in-order, so a resident repaired earlier in the same sweep is already alive
  when a later dormant role probes it. The comment at `swarm_ensure.bb:544-548`
  is accurate.
- Failure-mode parity with `handoff_lib.bb/rotate-resident-to!` is unchanged
  from round 1 (verified there); moving the decision into the pure module gives
  the two edges one testable definition instead of a prose promise.

## Co-change evidence (informational, BL-255 — did not drive this verdict)

`node extension/out/tools/co-change-report.js swarmforge/scripts/mono_router_lib.bb swarmforge/scripts/swarm_ensure.bb`

```
swarmforge/scripts/swarmforge.sh:                 13 (SUSPECTED COUPLING)
swarmforge/scripts/test/test_swarm_ensure.sh:      9 (SUSPECTED COUPLING)
swarmforge/scripts/test/mono_router_lib_test_runner.bb: 7 (SUSPECTED COUPLING)
start-swarm.sh:                                    6 (SUSPECTED COUPLING)
swarmforge/scripts/handoff_lib.bb:                 5 (SUSPECTED COUPLING)
swarmforge/scripts/mono_router_lib.bb ↔ swarm_ensure.bb: 3 (SUSPECTED COUPLING)
```

`mono_router_lib.bb ↔ mono_router_lib_test_runner.bb` (7) and
`mono_router_lib.bb ↔ swarm_ensure.bb` (3) are healthy module/test and
module/caller coupling. `handoff_lib.bb` at 5 remains the pair worth watching —
this parcel deliberately mirrors its `rotate-resident-to!` failure modes and
history says the two drift together. Finding 2's remediation improves this: the
mirror is now one unit-tested definition rather than a docstring promise.

## Scope check (BL-506)

True parcel diff vs merge-base `ac5601fcb1` is **six files**, all BL-537:
`mono_router_lib.bb`, `swarm_ensure.bb`, `mono_router_lib_test_runner.bb`,
`test_swarm_ensure.sh`, `specs/pipeline/steps/index.js`, plus my own review
evidence. **Clean — no ticket-less functional files.**

Two notes for downstream:

1. `git diff main HEAD` additionally shows `BL-576…yaml` and
   `BL-577…yaml` as deletions. This is **branch staleness, not a parcel
   deletion** — both were added to `main` after this branch's merge-base
   (`8c19e9a03`). Confirmed against the merge-base diff above. No action needed.
2. **Unstaged, deliberately not committed:** an untracked
   `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh` is
   present in this worktree. It is ticket-less, referenced by nothing in the
   repo, and covers a *different* concern (auto-respawn of the resident pane on
   `git_handoff`). Per BL-506 I left it unstaged rather than folding it into this
   parcel. Flagging it so it is ticketed or removed rather than silently
   swept into a later `git add -A`.

## Branch hygiene (BL-490/BL-495)

Round 1's revert of my review merge was itself reverted (`df8f07704`) **before**
merging `9314557456`, exactly as round-1 evidence required — otherwise git would
have treated the original hunks as already-handled and silently dropped them. I
verified this did not happen: `git diff 9314557456 HEAD` over all parcel paths is
**empty** (exact content parity with the cleaner's tip), and
`git merge-base --is-ancestor 9314557456 HEAD` holds.
