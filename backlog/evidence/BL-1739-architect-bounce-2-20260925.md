# BL-1739 — architect bounce (2nd pass), 2026-09-25

## D1 — `isLiveCodePath`'s root-file catch-all admits root-level markdown docs, not only launch scripts (behavior, coder)

The rebuild (`specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`,
`isLiveCodePath`) treats any tracked file with no `/` in its path as
"live code" (a root-level launch script):

```js
if (!rel.includes('/')) return true; // the root launch scripts
```

The repository root also carries plain documentation files with no `/` in
their path — `README.md`, `CONTRACT.md`, `HANDOFF.md`, `USE-CASES.md` —
which this predicate cannot distinguish from `start-swarm.sh`/
`stop-swarm.sh`/`finish-shift`/`swarm-kill`. The specifier's ruling scopes
this check to "root-level launch scripts" specifically, not root-level
files in general.

**Failing command / repro**: from the repo root,
`echo "See history: launch_babysitter.sh was retired." >> README.md`,
then `node specs/pipeline/cli.js specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature`.

**First error excerpt**:
```
not ok 26 - the agent-based babysitter is gone and the daemon owns the name
Scenario "the agent-based babysitter is gone and the daemon owns the name" failed at step "Then no babysitter.prompt role, LLM launch path, or wake runtime remains": live code references a retired agent-babysitter name:
README.md
```
(Reverted with `git checkout -- README.md` immediately after confirming;
also independently confirmed the check DOES correctly catch a real
regression by planting `launch_babysitter.sh` prose in a scratch file
under `swarmforge/scripts/` — caught, cleaned up, both probes are mine,
neither is committed.)

**Failure class**: behavior.

**Expected vs observed**: expected only actual root-level LAUNCH SCRIPTS
(`start-swarm*.sh`, `stop-swarm.sh`, `swarm-kill`, `finish-shift`, `swarm`,
`attach-swarm.sh`, etc.) to be scanned as live code at the repository
root; observed every root-level file with no `/` in its path scanned,
including `README.md`/`CONTRACT.md`/`HANDOFF.md`/`USE-CASES.md` — plain
markdown documentation that may legitimately narrate the retirement's own
history (exactly the same "history/records" posture `docs/` and
`backlog/` already get, one directory over: the repo root's own top-level
docs). This recreates, in miniature, the exact fragility class the
specifier's ruling exists to eliminate — a check that goes red the moment
someone writes ordinary prose about the daemon's history, this time at the
repository root instead of via a per-file allowlist.

**Blamed role**: coder.

**Remediation pointer**: narrow the root-level branch of `isLiveCodePath`
to actual launch scripts — either an explicit allowlist of the known root
launch-script names (`swarm`, `start-swarm*.sh`, `stop-swarm.sh`,
`swarm-kill`, `finish-shift`, `attach-swarm.sh`), or exclude `.md` (and any
other doc extension) from the root catch-all. Re-run this scenario with a
retired-name mention added to `README.md` as a regression check before
forwarding again (the exact repro above) — it must stay green — alongside
the existing regression check (a retired name planted under
`swarmforge/scripts/`, which must still fail).

## Other items checked, no defect

- `node specs/pipeline/cli.js specs/features/BL-611-...feature`: 27/27,
  confirmed.
- `isAllowedBabysitterMatch`, the `offenders` scan, and the orphaned "the
  only matches are..." step definition are fully removed — matches my
  prior bounce's remediation pointer exactly.
- `RETIRED_FILE_PATHS`/`forbidden` (file-existence check) unchanged and
  still correct.
- `git diff main...HEAD --name-only` (this rebuild's own diff): exactly
  the one Scope file, no feature file touched by this parcel.

## record-bounce.js revert-check note

Flagged `59000e1508` (this worktree's "Merge cleaner 35d4abd1df into
architect", carrying the coder's rebuild + cleaner's pass) as
`"verdict": "violation"` with remedy `git revert --no-edit 59000e1508`.
NOT acted on: D1 is a narrow behavioral defect in ~90% correct work (dead
allowlist code correctly removed, the live-code check correctly built for
four of five named surfaces) — reverting the whole merge would discard the
good part along with the bad and regress to the FIRST bounce's problem
(the dead allowlist back in place). The fix is a small, targeted narrowing
of one predicate branch, which the pipeline's normal coder-fixes-and-
resubmits flow already handles; a blanket revert is not the right shape
for a single-branch behavioral bug inside otherwise-correct new code.

By architect.
