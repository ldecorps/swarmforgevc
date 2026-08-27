# BL-530 / BL-560 — architect review (round 4): PASS

Reviewed commit: `7524bd3ada` (cleaner), carrying `e0a35c581` (BL-530 round-3
remediation) and the cleaner's verification.
Verdict: **PASS — forward to hardender.** All three round-3 remediation items
were carried out, and each is verified *non-vacuously* (shown to fail when the
thing it guards is removed). One finding is recorded below as a **separate
ticket**, not a send-back: it is pre-existing at `main` and at the pre-clobber
original, and is not caused by this parcel.

## Round-3 remediation: all three items DONE and verified

**Item 1 — live-shape fallback dropped. DONE.**
`router?` is now `(rotation-router-mode?)` alone; `mono-router-standing-shape?`
is deleted outright rather than left as re-wirable dead code, and
`grep -rn mono-router-standing-shape` across the repo returns nothing. The
comment states the reason (the shape is equally a half-launched classic pack).
`session-exists?` remains live via three other call sites — no dead code left
behind.

**Item 2 — dormant fixture declares the pack. DONE, and load-bearing.**
The fixture writes `rotation\trouter` into `.swarmforge/swarm-identity`.
Proven non-vacuous: with that one line removed (fixed ensure otherwise intact),
the test **fails** — `expected specifier DORMANT, got ... agent:specifier:
HEALTHY`. The assertion now rides the declared signal, not the heuristic.

**Item 3 — classic-pack regression test added. DONE, and non-vacuous.**
Run against the round-3 rejected `c7a7491f30` ensure script, the new test
**fails** reproducing the exact bounced symptom:

```
FAIL: classic pack must not classify any role as DORMANT, got:
agent:cleaner: FAILED (could not tear down illicit standing session)
agent:architect: DORMANT (mono-router rotate target; no standing session)
agent:QA: FAILED (could not tear down illicit standing session)
```

At the fixed script it passes with an empty kill log. This is the detector the
defect needed.

## Verification run in this worktree at the merged commit

| Check | Result |
|---|---|
| `bash swarmforge/scripts/test/test_swarm_ensure.sh` | ALL PASS (01–06, 07a–07f, dormant, classic half-launch, 08) |
| `bb swarmforge/scripts/test/launch_contract_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` | ok |
| `bash swarmforge/scripts/test/test_github_intake_write.sh` | ALL PASS (01–02) |
| `node extension/out/tools/dependency-gate.js` (full repo, fresh `npm run compile`) | **PASSED**, no forbidden edges |
| co-change report (`swarm_ensure.bb`, `test_swarm_ensure.sh`) | informational; top pair `swarmforge.sh` (13) unchanged from round 1 |
| parcel scope vs merge-base `4353ec1344` | in-ticket (BL-530: contract lib + ensure + tests; BL-560: intake scan/write + workflow + steps). Only non-ticket path is `extension/docs/briefings/2026-07-23.json`, the automated daily cost/health sidecar artifact, which lands on `main` independently (`7fad5ae0f`) — routine automation, not coder work |
| GH Actions guardrail (BL-560 files) | every `${{ }}` sits in an `env:` block; no interpolation in any `run:` body |

Architecture: unchanged and sound. `launch_contract_lib.bb` / `mono_router_lib.bb`
stay pure (text and data in, decisions out); all IO — identity/conf reads, tmux
`has-session` / `list-panes` / `respawn-pane` / `kill-session` — stays in
`swarm_ensure.bb` at the edge. `ensure-mono-router-role!`'s `case` over
`topology-action` is exhaustive against the four keywords that function can
return. The launch-contract refusal still gates only the two respawning branches.

Live-signal check (read-only, this swarm): `.swarmforge/swarm-identity` declares
`rotation router` and `mono-router.conf` declares `config rotation router`;
both `rotation-router-from-identity?` and `conf-rotation-router?` return true, so
removing the fallback does not regress dormant handling on the running swarm.

Choice of `rotation-router-mode?` over `swarm-identity-lib/mono-router-project?`
(the round-3 "or better") is correct and better than what I suggested:
`mono-router-project?` is deliberately *sticky* — it also returns true on a
leftover `mono-router-active-role` marker or a previous pack conf — so a project
that once ran mono-router and is now launched classic would be misclassified,
which is the same defect in another guise. `rotation-router-mode?` reflects the
current launch only.

## Finding (separate ticket, NOT a send-back) — `rotation sequential` packs are invisible to the declared signal

`swarmforge.sh:is_sequential_dormant` treats **both** rotation values as the
same single-resident topology:

```bash
[[ "$ROTATION_MODE" == "sequential" || "$ROTATION_MODE" == "router" ]] || return 1
```

`swarm_ensure.bb`'s declared signal matches only the literal `router`
(`conf-rotation-router?` regex `rotation\s+router\b`;
`rotation-router-from-identity?` `(= "router" ...)`). `mono-rotate.conf` is the
one shipped pack declaring `config rotation sequential`, and it has exactly the
mono-router shape: resident `coder` + reserved coordinator stand, five middle
pipeline roles are worktree+roles.tsv only.

Reproduced (`tmp/repro_sequential_respawn.sh`, architect worktree): fixture with
`rotation\tsequential`, resident + coordinator standing, middle roles absent.

```
at 7524bd3ada (this parcel):   cleaner/architect/QA -> respawned  (3 respawn-pane calls)
at 4353ec1344 (main):          cleaner/architect/QA -> respawned  (3 respawn-pane calls)
at 7e2498634^ (pre-clobber):   rotation-router-mode? is identical, router-only
at c7a7491f30 (round-3 code):  DORMANT, 0 respawns — but only via the shape heuristic
```

So this parcel does **not** introduce or worsen it: `main` behaves the same, and
the pre-clobber original's `rotation-router-mode?` was already router-only. The
now-deleted heuristic covered `sequential` only incidentally, and it could not be
kept — it was tearing down healthy classic-pack sessions. That is why this is a
ticket and not a fourth bounce.

Impact when it does bite: `./swarm ensure` on a mono-rotate swarm starts five
extra agent processes — on the memory-constrained host mono-rotate exists to
serve (its own conf names FES's 15GB box, which OOM-crashed under a full swarm).
No effect on this swarm, which declares `rotation router`.

Suggested shape for the ticket (specifier's call):
1. Add a pure `single-resident-rotation?` to `mono_router_lib.bb` matching
   `router|sequential`, and use it in `swarm_ensure.bb/rotation-router-mode?`.
   Do **not** widen `conf-rotation-router?` in place — `ready_for_next_task.bb`
   and `ready_for_next_batch.bb` consume it for the `ROTATE_HOME` backstop, and
   changing those is a behavior change needing its own spec and tests.
2. Regression test: mono-rotate fixture → middle roles DORMANT, empty respawn
   log. `tmp/repro_sequential_respawn.sh` is a working starting point.
3. Note while there: the same `identity-or-conf` predicate pair is duplicated in
   four places — `swarm_ensure.bb:119`, `swarm_status.bb:122`, `handoffd.bb:1124`,
   plus direct `conf-rotation-router?` use in both `ready_for_next_*.bb`. That
   duplication is what makes this gap systemic rather than local; one shared
   predicate would fix status, chase, and rotate-home together.
   `backlog/paused/BL-537-mono-router-missing-session-heal.yaml` is the nearest
   existing owner of the dormant-vs-dead question.

## Property testing

Not applicable to this parcel, and no vacuous property manufactured. The pure
modules it touches are Babashka (`launch_contract_lib.bb`, `mono_router_lib.bb`);
the project's property framework is fast-check over JS `*.property.test.js`, and
engineering.prompt records that Babashka property/mutation tooling is deliberately
not wired (BL-472). No JS pure module was touched in any round of this parcel.

## Note on the shared commit

`7524bd3ada` carries **both** BL-530 and BL-560 (Article 2.6). BL-560's content is
unchanged since round 2 and re-verified green here; both forward together and both
ticket ids must reach the coordinator's bookkeeping.

By architect.
