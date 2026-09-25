# BL-1739 — architect bounce 2 fixed, 2026-09-25

## D1 — fixed

`isLiveCodePath`'s root-level branch (`!rel.includes('/')`) treated EVERY
root-level tracked file as live code, including plain docs
(`README.md`/`CONTRACT.md`/`HANDOFF.md`/`USE-CASES.md`) and config/data
(`bb.edn`/`swarmforge.lock.json`/`upstream-watch.json`/`vercel.json`/
`.gitignore`) - not only launch scripts. Fixed to a structural,
extension-shaped check rather than a curated name list (matching the
ruling's own anti-curation intent, applied one level down): a root-level
file is live code only if it ends in `.sh` or has no extension at all
(`swarm`, `swarm-kill`, `finish-shift`) and does not start with `.`.
Verified against the FULL current root file list (`git ls-files | grep
-v /`): every real launch script (`attach-swarm.sh`, `finish-shift`,
`start-swarm*.sh` x9, `stop-swarm.sh`, `swarm`, `swarm-kill`) still
classifies as live code; every doc/config/data file
(`.gitignore`/`CONTRACT.md`/`HANDOFF.md`/`README.md`/`USE-CASES.md`/
`bb.edn`/`swarmforge.lock.json`/`upstream-watch.json`/`vercel.json`) does
not.

Non-vacuity: re-ran both the architect's own repro (a retired-name mention
appended to `README.md`, reverted immediately after) - now passes (was the
bounce's own failing case) - and the standing regression check (a
retired-name mention planted in a scratch file under
`swarmforge/scripts/`, removed immediately after) - still correctly
fails, proving the fix narrows the false-positive surface without losing
real detection.

## Verification run before forwarding

- Architect's repro (README.md mention): now green.
- Regression check (swarmforge/scripts/ scratch file mention): still
  correctly red, confirmed, then removed.
- `node specs/pipeline/cli.js specs/features/BL-611-...feature`: 27 of 27.
- `node specs/pipeline/cli.js specs/features/BL-1129-...feature`: 2 of 2.
- `npm test` (extension/, compile + unit lane): 637 files / 10868 tests
  pass; exit 1 was purely the suite's own duration-budget guard under
  continued heavy host load this session, not a correctness regression (no
  "Failed Tests" section).

## Scope

Touched: `specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`
(`isLiveCodePath` only), this evidence file. `backlog/standing-reds.tsv`
NOT touched. No BL-611 scenario/Examples/narrative edited. Nothing else in
this worktree staged.

By coder.
