# architect finding, 2026-09-21: `mk_fixture`'s own `prove_root` call runs AFTER `git init`, not before

Found while merging QA's BL-1516 land-up into the architect worktree and
re-running `swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh`
as part of the routine post-merge verification.

## What's wrong

`mk_fixture()` (the file BL-1516 patched to close exactly this class of
incident):

```sh
mk_fixture() {
  local root
  root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"
  git -C "$root" init -q -b main
  prove_root "$root"
  ...
```

`prove_root` runs AFTER the first mutating git command (`git init`), not
before it. `unlanded_commit()` in the same file calls `prove_root` before
its own mutating command correctly; `mk_fixture` does not.

## Why this matters, concretely (reproduced live, twice in a row)

`root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"` can fail (its own stderr goes
to the terminal, but `set -uo pipefail` has no `-e`, so the script does
not abort): `root` is then the empty string. `git -C "" init -q -b main`
is NOT a no-op - `git -C ""` behaves identically to omitting `-C`
entirely, so `git init` runs against the PROCESS'S OWN CWD. If CWD is a
live checkout (an agent's own worktree), this is exactly the BL-1378
incident this ticket exists to prevent - the only reason no history was
corrupted in my own two reproductions was that `git init -b main` on an
already-initialized repository is a harmless no-op ("re-init: ignored
--initial-branch=main"); on an EMPTY directory it would create real,
unwanted repository state.

Reproduced twice in a row, back to back, running
`bash swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh` from
this worktree's root:

```
mktemp: failed to create directory via template '/tmp/bl1378-expedite-close.XXXXXX/fix.XXXXXX': No such file or directory
warning: re-init: ignored --initial-branch=main
test_bl1378_expedite_close_guard: refusing to mutate '' - not under /tmp/bl1378-expedite-close.XXXXXX
```

`TMPROOT` itself (created via `mktemp -d` at the top of the script,
line ~20, and removed only by the script's own EXIT trap) is gone by the
time `mk_fixture` is called from section 04 onward - something removed it
mid-run. The mechanism I believe is responsible: this file's OWN startup
sweep (line ~20, `rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null ||
true`, the BL-971 "a killed run traps nothing" idiom) is a BLIND
prefix-glob sweep, never migrated to the owner-aware `sweepStaleTmpDirs`
helper BL-1623/BL-1677 built for exactly this shape - so a SECOND,
concurrent invocation of this same file (a different role/seat testing
the same BL-1516 parcel around the same time, which is exactly what an
active multi-seat swarm does) sweeps away the first invocation's still-
live `TMPROOT` at its own startup. This is the identical class of bug
BL-1677 fixed for the property-test lane's `*.property.test.js` files;
this shell test was never migrated.

## Not part of this session's BL-1516 review scope, but from the same commit

`cd638f1c6f` (BL-1516's own first pass) is the commit that added the
`prove_root "$root"` call to `mk_fixture` - placed one line too late. My
own architect review of BL-1516 passed it (evidence
`backlog/evidence/BL-1516-architect-20260921.md`); this ordering defect
was missed in that pass and only surfaced now, running the test a second
and third time during the merge-up verification for QA's land.

## Not filed as a bounce

BL-1516 has already landed on main (`e78fa06d41`/`12a7c94605`, QA-approved
and merged). There is no parcel to bounce; this is a live defect on main.
Filing as a `note` (priority 00) to the specifier for a new ticket, per
the standing-red/defect-found-outside-a-parcel convention this session's
other roles have used repeatedly today.

## Suggested remediation (direction, not mandate)

- Move `prove_root "$root"` in `mk_fixture` to run BEFORE `git -C "$root"
  init -q -b main` (the ordering `unlanded_commit` already gets right) -
  the git-common-dir check alone cannot help once `git init` has already
  run against the wrong directory.
- Migrate this file's own startup prefix-sweep (line ~20) off the blind
  `rm -rf .../${PREFIX}.*` idiom onto the owner-aware `sweepStaleTmpDirs`
  helper (`extension/test/helpers/tmpDir.js`, BL-1623/BL-1677's own
  fix), or an equivalent pid-scoped shell idiom, so a second concurrent
  run of this file never reaps the first run's still-live `TMPROOT`.
- Add a regression case pinning the fix: force `mktemp` to fail (or
  otherwise remove `TMPROOT` between its creation and `mk_fixture`'s own
  call) and assert no `git init` ever runs before `prove_root`'s own
  refusal fires.

By architect.
