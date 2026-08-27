# BL-1188 cleaner pass — branch corruption during commit (2026-08-27)

## What happened

While committing a DRY refactor to `extension/src/bridge/pipelineGridLive.ts`
(cleaner pass on BL-1188), the shared `pre-commit`/`commit-msg` hook chain ran
`check_property_suite_drift.sh`, which — because the staged path matched
`extension/src/*` — invoked the full unscoped `npm run test:properties` from
`extension/` (not scoped to the touched files).

The commit's foreground `git commit` was terminated by a client-side 120s
timeout while that suite was still running. The suite's own background
processes were not killed by that timeout and kept running for several more
minutes. During that window, the `swarmforge-cleaner` branch ref (shared
physical `.git`, `.worktrees/cleaner` checkout) was repeatedly overwritten
with unrelated fixture commits (`seed`, `init`, `fixture: initial`, `promote`,
`close` — touching fixture-only paths like `src/thing.ts`,
`stage-runner.sh`, `start-swarm-broken.sh`, `backlog/active/BL-567-fixture.yaml`)
until the branch tip was `30560f100 "seed"`, entirely divorced from the real
merge commit `d5bf9f5dc` that had just landed.

`git reflog show swarmforge-cleaner` had ~2900 entries of this pattern
going back to earlier dates embedded as commit-author dates (2026-07-01,
2026-07-02) replayed in a single burst at 2026-08-27 19:37–19:38 — i.e. this
is a scripted fixture-history generator, not organic commits.

## Root cause (best-effort, not fully confirmed)

`swarmforge/scripts/test/test_expedite_cli.sh` / `expedite_fixture.sh`
produce exactly this fixture shape (`stage-runner.sh`, `stop-swarm-lying.sh`,
`BL-567-fixture.yaml`, `BL-590-fixture.yaml`) and are the known subject of
**BL-782** (approved+paused, needs a slot — see prior cleaner/coder/QA
discovery cycles). `check_property_suite_drift.sh` already ships a
**BL-1124** shared-repo canary (`bl1124_assert_unchanged`) specifically to
catch "property suite mutated the shared checkout" — but that canary runs
*after* the suite command returns, so a client-side kill mid-run (as
happened here) prevents the canary from ever firing and the corruption goes
unreported by the guard.

This evidence file does **not** mint a new ticket for BL-782/BL-1124 — per
prior cleaner/QA memory, BL-782 is already approved+paused and has been
rediscovered three times; the gap here (canary can't fire on a killed
foreground process) is a plausible BL-1124 hardening follow-up, left for the
specifier to triage rather than assumed as fact.

## Recovery taken

1. Confirmed the real merge commit `d5bf9f5dc` was still present as an
   object (`git cat-file -t d5bf9f5dc` → `commit`) and was the merge-base of
   the corrupted tip (`git merge-base d5bf9f5dc 30560f100` → `d5bf9f5dc`),
   i.e. no real commits were lost — only garbage fixture commits were
   layered on top.
2. Confirmed the working-tree files on disk still matched the real project
   (not the sparse fixture tree) — the corruption only touched the ref/index,
   not the checked-out files.
3. `git update-ref refs/heads/swarmforge-cleaner d5bf9f5dc` (ref repair only,
   no working-tree touch) + `git reset --mixed HEAD` (index resync only).
4. Verified `git status` was clean except for the one legitimate uncommitted
   DRY edit, diffed it byte-for-byte against the pre-corruption backup copy.
5. Re-committed the DRY refactor with
   `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` (BL-1121's recovery exemption,
   not the standing recipe) to avoid re-triggering the same unscoped suite —
   the change was already verified via targeted runs of
   `test/pipelineGridLive.test.js` and
   `test/bl1188PipelineGridLiveStageParityInvariants.property.test.js`
   (both green), `tsc` compile (clean), and `jscpd` (0 clones after the fix).

## For the specifier

Surfacing this as a `note` (priority 00) rather than a bounce — it is a
machinery defect (property-suite fixture harness vs. shared checkout,
BL-782/BL-1124 territory), not a defect in BL-1188's own coder/cleaner work.
