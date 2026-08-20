# BL-958 — architect review pass 2 (re-fix): complete inventory

- **Ticket**: BL-958 full-forge tmux control-plane crash root cause (`type: defect`, `severity: high`)
- **Commit reviewed**: `1463a8b5c7` (cleaner re-fix) — merged as `06fed2297`
- **Reviewer**: architect, 2026-08-19
- **Prior bounce**: pass 1, `ec033029e2`, class `behavior` —
  `backlog/evidence/BL-958-full-forge-tmux-control-plane-crash-root-cause-bounce-20260819.md`
- **Verdict**: **PASS — D1 closed, defects found: NONE.**

## D1 is closed, and I re-ran my own reproduction rather than trusting the fix

Pass 1's D1: `recovery-decision` computed `{:action :halt}` but `swarm_ensure.bb`
never branched on it — only the `:reason` string was consumed. The repair loop ran
anyway, `create-session!` restarted a bare tmux server, and `control-plane-report!`
then reported **FIXED** and **resolved** the open incident while every role was dead.

The re-fix (`6998d9c9c5`, tidied by `1463a8b5c7`) introduces `halt-decision?` as ONE
definition read by both the repair-loop gate in `-main` and the control-plane row, so
the two sites cannot disagree about which case they are in. Under `:halt`:

- the per-role loop is skipped entirely (`roles-all-failed` reports each role FAILED
  with the reason, instead of attempting recreation);
- `control-plane-report!` returns FAILED carrying the escalation policy's own
  `:next-action`, and never re-probes;
- `resolve-open-incidents!` is not called, so the incident survives.

**Verified by re-running my pass-1 reproduction** (the parcel's fixture minus the
launch script), which previously produced the self-contradictory FIXED:

```
agent:coder: FAILED (control plane missing and no persisted launch scripts exist;
             recreation skipped, see the control-plane row)
control-plane: FAILED (control-plane-missing: no persisted launch scripts to respawn
             roles from; relaunch the swarm (./start-swarm.sh) and inspect
             .swarmforge/incidents/control-plane.json for the evidence)

no server restart - loop correctly skipped
incident status: "open"
```

All four symptoms I filed are gone: no churn (the tmux server is never restarted),
no false `agent:coder: FIXED`, no self-contradictory control-plane verdict, and the
evidence is preserved. Invariant 2's second arm now holds.

## My pass-1 S1 spec gap was actioned

Pass 1 left an S1 `note` (priority `00`, specifier + coordinator): verification step 3
and `qa_e2e` step 5 both described the no-recovery-possible branch but no scenario
gated it — which is how D1 reached review unpinned. The specifier added
**control-plane-loss-04**, which pins exactly the four properties D1 named:

```gherkin
Then the control-plane outcome is reported as failed, naming that no launch scripts exist...
And no per-role recreation is attempted
And the recorded incident remains open
And no role is reported as repaired
```

All six of its step phrases are bound in `bl958ControlPlaneLossSteps.js` — the
scenario is executable, not decorative. Closed.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`1463a8b5c7` ancestor of HEAD) | PASS |
| 2 | **Re-fix not silently suppressed by my own bounce revert (BL-954 trap)** | PASS — `control_plane_lib.bb` restored, and `swarm_ensure.bb` (auto-merged, the file my revert touched) carries the new `:action` branch |
| 3 | Still-bounced BL-960 content kept out | PASS — its handler absent, registry resolved to `bl571` + `bl958` only, `safe-wrapper-command` 0 refs |
| 4 | Operator hook disable still intact after merge | PASS |
| 5 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable to this parcel** — see the attribution note below |
| 6 | D1 remediation present AND effective | PASS — verified by re-running my own pass-1 repro (above), not by reading the diff |
| 7 | Single definition for the halt decision (no second site to drift) | PASS — `halt-decision?` read by both the loop gate and the report |
| 8 | Invariant 1 — explicit control-plane failure | PASS |
| 9 | Invariant 2 — no indefinite half-alive state | **PASS — was the pass-1 failure; now gated at three levels** (pure property, shell fixture case, acceptance scenario 04) |
| 10 | Invariant 3 — health from live truth, not stale metadata | PASS |
| 11 | Invariant 4 — exactly one deterministic owner | PASS — `response-policy` reached in production via the chase hook; its `:next-action` now also surfaces through ensure's FAILED row, which pass 1 noted was unreachable from ensure |
| 12 | Property tests for all 4 declared invariants, non-vacuous | PASS — `bl958_control_plane_property_runner.bb`: 400 runs, reachability 400 loss / 400 bursts / 193 resolved-then-new / 201 no-scripts |
| 13 | `control_plane_lib_test_runner.bb` | PASS |
| 14 | `swarm_status_lib_test_runner.bb` | PASS |
| 15 | Acceptance scenario 04 exists and every step is bound | PASS |
| 16 | `test_swarm_ensure.sh` incl. both BL-958 cases | PASS — 47/47 `ALL PASS`, 0 FAIL, incl. `BL-958: control-plane loss is classified, recovered, reported, and its incident resolved` and `BL-958 D1: :halt is honored - no recreation churn, FAILED with escalation, incident preserved` |
| 17 | Two-layer boundary / secrets / host owns I/O | PASS — swarm machinery only |
| 18 | Policy independent of IO/UI/filesystem | PASS — pure decisions above, IO edge below; and now the adapter OBEYS the policy it computes, which was precisely pass 1's complaint |
| 19 | Architect property-coverage pass | No new property required — the four declared invariants carry a property runner with asserted reachability, and D1's own remediation is gated by the shell case plus scenario 04 (ensure's `-main` is not a pure module and is correctly covered by fixture, not property) |
| 20 | Co-change coupling (`co-change-report.js`) | Informational, no gap — the parcel changed the coupled set TOGETHER |
| 21 | Cleanup commit `1463a8b5c7` is genuinely behavior-preserving | PASS — reasoned below, not assumed from the commit message |

## Check 5 — the hard gate is RED, and it is not this parcel's

`node extension/out/tools/dependency-gate.js` (full-repo scan) exits 1:

```
Dependency-rule gate FAILED:
  src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
  src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
  src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
```

**Correcting my own earlier record on this ticket:** a scoped invocation reported
"no forbidden edges", which is not the gate's verdict — passing repo-relative paths
makes `depcruise` resolve them against `extension/` and fail to open them, so a
scoped run on this parcel's files proves nothing. The no-argument full-repo scan is
the honest reading, and it is RED.

Attribution, before blaming anyone (the gate must never bounce a parcel for damage
it did not do):

- All three edges are in `extension/src/tools/telegram*`. This parcel's merge
  (`b2949f2d7..06fed2297`) touches **zero** telegram files.
- Last touch on each is unrelated prior work: `bdab5ce61` (BL-620, front desk
  captions), `2e65b769a` (BL-826), `e54d2129a` (Bubble overlay).
- The cycle is already ticketed and queued: **BL-759**
  (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).

So: pre-existing, owned, not attributable to BL-958, and nothing to surface as a new
spec gap. **Not a defect of this parcel, and not a bounce.** This parcel's own changed
set contains no file in the gate's scope (Babashka scripts plus one step-handler).

## Check 20 — co-change says the coupled set moved together

`co-change-report.js swarm_ensure.bb control_plane_lib.bb` ranks
`test_swarm_ensure.sh` (19), `swarmforge.sh` (13), `specs/pipeline/steps/index.js`
(10), `start-swarm.sh` (7), `handoffd.bb` (7), `swarm_status.bb` (6). The interesting
question is not which files are coupled but whether a coupled file that SHOULD have
moved stayed still. The parcel changed `test_swarm_ensure.sh`, `index.js`,
`handoffd.bb`, `swarm_status.bb` and both test runners. The partners it did not touch
(`swarmforge.sh`, `start-swarm.sh`, `handoff_lib.bb`, `mono_router_lib.bb`) are
launcher and routing surfaces the fix does not reach: the whole change lives inside
`./swarm ensure`'s decision path, and the escalation merely *names* `./start-swarm.sh`
as the human's next action rather than calling it. No missing co-change. Informational
only, as the tool is — no bounce.

## Check 21 — why the "cleanup only" claim actually holds

A cleanup commit that quietly changes behavior is the easy thing to wave through, so I
checked the one place it could have: `control-plane-report!` used to build the policy
from a hardcoded `:launch-scripts-present? false`, and now reads the real value (plus a
`:classification` key the old call never passed).

- `response-policy` destructures only `:incident` and `:launch-scripts-present?` — the
  added `:classification` key is inert.
- `recovery-decision` returns `:halt` **only** when `launch-scripts-present?` is false.
  So on every path that reaches the halt branch, the real read *is* `false`: identical
  `:escalate` policy, identical `:next-action` string. The old literal was correct only
  by coincidence, exactly as the cleaner argued — a second `:halt` cause would have made
  it describe the wrong one.
- `response-policy` is pure and now runs on every ensure invocation, including healthy
  ones. No side effect, nothing to throw; `:policy` is simply unread off the halt path.
- `halt-decision?` removes a real drift risk: `-main` previously asked
  `(get-in cp-state [:decision :action])` while the report asked `(:action decision)`.
  One predicate now, two callers.
- `roles-all-failed` reproduces both former row shapes exactly — `(merge {...} nil)` on
  the halt path leaves the agent row without a `:category`, as before; the no-socket path
  supplies it. Ordering (agent row then rc row, per role) is preserved by the `mapcat`.

Behavior-preserving, and it removes duplication that was one edit away from becoming a
bug. No defect.

## Verdict

**PASS.** Defects: **NONE** — D1 is closed and verified by re-running my own pass-1
reproduction, my pass-1 S1 spec gap was actioned by the specifier as scenario
control-plane-loss-04, and the sole hard-gate failure is BL-759's pre-existing telegram
cycle, which this parcel neither caused nor touches. No new property test is required
(check 19). Forwarding to the hardener under the same task name.
