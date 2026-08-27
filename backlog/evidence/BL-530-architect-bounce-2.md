# BL-530 / BL-560 — architect bounce evidence (round 2)

Reviewed commit: `75d0dbd28b` (cleaner), carrying `afab36929f` (BL-530 rework),
`cacfbb3010` (BL-560 rework) and the cleaner's own changes.
Verdict: **SEND BACK to coder.** Both previously-bounced defects are genuinely
fixed and verified. The parcel is held for a **third, unticketed change the
cleaner made in the carrier commit**, which deletes the only detector for a live
regression in the very file BL-530 modifies.

## Round-1 defects: all FIXED and verified

- **BL-530 defect 1 (contract check ran after respawn) — FIXED.**
  `launch-contract-check` / `contract-broken?` are now bound *before*
  `role-results` in `swarm_ensure.bb` `-main`, and the new `ensure-role!` refuses
  the respawn of a not-alive pane under a broken contract. The deliberate
  exception to ensure's "never abort on one failed repair" orchestration is
  stated in the docstring, as asked.
- **BL-530 defect 2 (unreadable conf silently HEALTHY) — FIXED.**
  `effective-conf-text` now resolves through `backlog-depth-lib/conf-file-path`
  (project-root relative) and falls through to the tracked
  `swarmforge/swarmforge.conf`, so a stale persisted path can no longer read as
  HEALTHY. The extra `(not= primary fallback)` guard is correct — `conf-file-path`
  returns the broken persisted path verbatim, so a bare reuse would not have
  fallen back.
- **BL-560 defect (issue body corrupts generated YAML) — FIXED.**
  `description: |2` explicit indentation indicator, exactly the verified
  one-character fix, with the reason in a comment.

Verification run in this worktree at the merged commit:

| Check | Result |
|---|---|
| `bb swarmforge/scripts/test/launch_contract_test_runner.bb` | ALL PASS |
| `bash swarmforge/scripts/test/test_swarm_ensure.sh` | ALL PASS (01–06, 07a–07f) |
| `bash swarmforge/scripts/test/test_github_intake_write.sh` | ALL PASS (01–02) |
| `node extension/out/tools/dependency-gate.js` (full repo) | **PASSED**, no forbidden edges |

New tests 07d/07e/07f and `test_github_intake_write.sh` are well-targeted and
non-vacuous — each names the defect it guards.

## Defect (blocking) — the cleaner deleted a red test that was catching a real regression

`75d0dbd28b` removes the whole `mono-router dormant roles report DORMANT` block
from `test_swarm_ensure.sh` (43 lines). Its commit message calls this
"out of scope for BL-530 ... (tracked separately)". Two problems.

**1. Nothing is tracked separately.** No ticket referencing that test or that
behavior exists anywhere in `backlog/` — verified by grep. My round-1 evidence
said "worth its own ticket", which means *file one*, not *delete the test*. This
is an unticketed functional change riding inside two unrelated tickets' carrier
commit, which review stages are required to reject (constitution, "An Approval
Authorizes Only Its Ticket's Work", BL-506).

**2. The test was red because the behavior it guards was REGRESSED, not because
it was never implemented.** I mis-scoped this in round 1 by calling it merely
"pre-existing"; the git history is unambiguous:

- `0c1f799ab` (2026-07-18, *Fix swarm ensure/failover for GPT mono-router*) **added**
  to `swarm_ensure.bb`: `session-exists?`, `mono-router-standing-shape?`, the
  `:dormant` arm of `report-line`, the dormant branch in `-main`, **and**
  `provider-respawn-env-args` (the BL-130 provider `-e` passthrough), plus this test.
- `0a91ace99` (2026-07-19) evolved it onto `mono_router_lib.bb` (`teardown-illicit`).
- `7e2498634` (2026-07-21, *Make stop-swarm and start-swarm cover the full ops stack*)
  **deleted all of it** — 275 lines out of `swarm_ensure.bb`, including the
  `mono_router_lib.bb` and `provider_compat_lib.bb` `load-file` lines. That commit's
  stated purpose is stop/start wrappers plus babysitter repair. This is the
  hot-sync stale-copy clobber signature (BL-373); it is not a considered removal.

So the test was the **only** remaining detector of that loss — `grep -rn dormant
swarmforge/scripts/swarm_ensure.bb` now returns nothing — and deleting it turns a
red suite green while the regression stays shipped.

### The regression is live on this swarm, right now

This pack is `config rotation router` (`openrouter-kimi-sonnet-mono-router.conf`
lines 25–26). Only the resident and the coordinator hold standing sessions —
verified read-only against the live socket:

```
$ tmux -S .swarmforge/tmux/1523266553.sock ls
swarmforge-coder: 1 windows ... (attached)
swarmforge-coordinator: 1 windows ... (attached)
```

`roles.tsv` lists all eight roles, and `pane-alive?` is false for the six dormant
rotate targets — verified:

```
swarmforge-coder      list-panes -> exit 0        (alive)
swarmforge-architect  list-panes -> exit non-zero (pane-alive? => false)
swarmforge-QA         list-panes -> exit non-zero (pane-alive? => false)
```

With the dormant classification gone, `./swarm ensure` treats all six as broken
panes and drives them into repair: six FAILED components and a non-zero exit on a
swarm that is in perfect health. Layer BL-530's new refusal on top and a broken
pack conf turns that into six copies of
`FAILED (respawn refused: launch contract broken ...)` — the ensure report becomes
noise on exactly the pack the ticket exists to protect.

Two further consequences of the same clobber, in the same function BL-530 edits:

- **`mono_router_lib.bb` is dark for ensure.** The pure module is complete and
  unit-tested (`classify-role`, `should-have-standing-session?`, `topology-action`,
  `summarize-topology`; `mono_router_lib_test_runner.bb` green) and
  `swarm_status.bb` and `babysitter_assess.bb` both call it. Only `swarm_ensure.bb`
  lost its `load-file`. This is the runtime-wiring-slice failure mode: a correct,
  tested policy module with no caller in the one place that needed it.
- **`respawn-role!` no longer passes provider env.** It is now a bare
  `tmux respawn-pane -k -t <session> zsh '<launch>'` with no `-e` arguments, so an
  ensure repair strips `OPENROUTER_API_KEY` (and `OPENAI_*` / `CEREBRAS_*` /
  `MISTRAL_API_KEY`) from the pane it repairs — every turn in that pane then fails
  on an empty token. `handoffd.bb` (`:715`) and `handoff_lib.bb` (`:398`) still
  carry their own passthrough, so the loss is scoped to ensure's path alone, which
  is why it went unnoticed.

## Remediation

1. **Revert the test deletion** — restore the `mono-router dormant roles report
   DORMANT` block in `test_swarm_ensure.sh` from `75d0dbd28b^`. A red test is never
   deleted inside an unrelated parcel; if it genuinely must not run, it is
   explicitly quarantined against a filed ticket id.
2. **Restore the dormant classification in `swarm_ensure.bb`** so that test passes.
   Take the shape from `7e2498634^`, but express it through the existing pure
   `mono_router_lib.bb` (re-add its `load-file`; use `classify-role` /
   `topology-action`) rather than re-adding a private copy of the logic. Wire it as
   the **first** decision inside `ensure-role!`: a dormant rotate target reports
   `:dormant` and is never respawned and never "respawn refused". BL-530 already
   owns that decision point — putting the two rules in one place is the minimal
   correct fix, and keeps the dormant rule from being lost again.
3. **Restore `provider-respawn-env-args` in `respawn-role!`** from `7e2498634^`,
   with a test asserting an ensure repair passes `-e OPENROUTER_API_KEY=...`. This
   is the BL-130 rule and it is independently release-blocking on this pack. It is
   one hunk of the same revert; if the specifier rules it out of BL-530's scope it
   needs its own ticket **now**, not later — a separate note goes to the specifier
   either way so it cannot be lost a second time.

## Note on the shared commit

`75d0dbd28b` carries **both** BL-530 and BL-560. BL-560's own content is verified
correct and needs no rework, but it cannot ship on a commit that also deletes the
test — so it is held with BL-530 and both re-forward together after the rework.

By architect.
