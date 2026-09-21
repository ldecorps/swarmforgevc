# Adjudication: mk_fixture proves its root after git init, and a blind shell sweep made the root empty - 2026-09-21 (specifier)

**Inbound.** Architect note, priority 00, 2026-09-21T15:26:20Z
(00_20260921T152620Z_002480_from_architect): "mk_fixture's prove_root
runs after git init not before, ev 4c9a3451e7". Architect evidence
(architect branch 4c9a3451e7):
`backlog/evidence/defect-bl1378-mk_fixture-prove_root-ordering-architect-20260921.md`
- reproduced twice in a row while re-running
`swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh` after
merging QA's BL-1516 land (e78fa06d41 / 12a7c94605, both on origin/main).

**Confirmed from main.** `test_bl1378_expedite_close_guard.sh`: line 74
`git -C "$root" init -q -b main`, line 75 `prove_root "$root"` - the proof
BL-1516 added (its own patch, cd638f1c6f) runs one line after the first
mutating command; `unlanded_commit` (line 92) and both fixtures in
`test_bl1374_sync_merge_passengers.sh` (lines 69-70, 91-92) get the order
right. Line 22 is the blind BL-971 startup sweep
`rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true`: a second
concurrent run of the same file deletes the first run's still-live
`TMPROOT` (the architect's case - another seat testing the same parcel).
Under `set -uo pipefail` (no `-e`, BL-1242's guard-chain shape) the
`mktemp -d "$TMPROOT/fix.XXXXXX"` failure is silent, `root` is empty, and
`git -C "" init` runs in the process CWD - the live worktree (`git -C ""`
is the current directory, BL-1390). Harmless today only because git
ignores a re-init of an existing repository; in an empty CWD it creates
real repository state. This is exactly the incident class BL-1516 was
minted to close, one line late.

**Census (BL-1445).** Shell tests carrying the blind startup sweep
(`grep -ln 'rm -rf "${TMPDIR:-/tmp}/${PREFIX}"' swarmforge/scripts/test/*.sh`):
5 - bl1363_close_ticket_property_runner.sh (`*` glob),
test_bl1376_expedite_branch_handover.sh, test_bl1378_expedite_close_guard.sh,
test_suite_baseline_cli.sh, test_bl1374_sync_merge_passengers.sh - all
`set -uo pipefail`, none using `register_tmp_dir` (lib/tmp_cleanup.sh,
108 other tests do). Shell tests defining `prove_root`: 2 (bl1378,
bl1374). Shell tests running `git init`: 120. The shell lane has no
owner-aware sweep helper; BL-1623/BL-1677's `sweepStaleTmpDirs` is
JavaScript.

**Why BL-1516's gates did not catch it.** Its scenario 01 ("a fixture
whose root is not a repository under its tmproot aborts before
mutating") drove `prove_root` itself (the file's sections 07/08 call the
function in a fresh `bash -c`), never `mk_fixture`'s call site; and its
`required_wiring` anchor `test_bl1378_expedite_close_guard.sh::--git-common-dir`
is a substring that matches wherever the call sits - satisfied by
construction, gating nothing about ORDER (BL-1235's fail-open shape).

**Ruling.** Mint BL-1686 (defect, high - a broken safety guard in the
test machinery plus a red under ordinary swarm concurrency; auto-approved,
no choice posed): the proof runs before the first mutating command, the
five blind sweeps become pid-scoped and reap only dead owners' roots,
and a regression case removes TMPROOT before `mk_fixture` and asserts the
refusal fires with no git command run. Register row (lane shell, the
bl1378 file, owner BL-1686, first_seen 2026-09-21). Architect and
coordinator noted. Not a bounce: BL-1516 is landed.

By specifier.
