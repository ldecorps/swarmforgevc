# BL-1870: why lands still leave the merge path (census, 2026-10-03)

Specifier, 2026-10-03 07:30-07:45 BST. Read-only measurement; nothing on
`main` or in any worktree was changed to take it.

## Why this census

BL-1870's deletion slice (the land step's rebuild machinery) is minted
"once 20 consecutive land records name BL-1901's merge path". BL-1901
landed at 02:09 BST. This counts what happened since, and why each land
that left the merge path left it.

## The 14 lander runs since BL-1901 landed

Source: `.swarmforge/lander/<task>-<sha>.log` and `.exit`, every file
written after 2026-10-03 02:00 BST.

| land | time | path | reason the merge path gave |
|---|---|---|---|
| BL-1901 cd74fb9ca0 | 02:09 | land step, ESCALATED (exit 3) | (runs before the merge path was live); replay commit `bounded-wait timeout after 60000ms` |
| BL-1886 e92fdad5ca | 03:25 | land step | (no LAND_PATH line; handoffd not yet restarted onto BL-1901) |
| BL-1904 b383903982 | 04:50 | merge (fast-forward) | - |
| BL-1897 dac7a1f5f6 | 04:58 | merge | - |
| BL-1891 d3bb22043c | 05:15 | land step | "merging origin/main into the line conflicts" |
| BL-1893 90b1c556a8 | 05:35 | land step | "merging origin/main into the line conflicts" |
| BL-1893 593e79cc91 | 05:41 | land step, ESCALATED (exit 3) | "conflicts"; then replay commit `bounded-wait timeout after 60000ms` |
| BL-1906 ec82c2560a | 05:57 | land step | "merging origin/main into the line conflicts" |
| BL-1894 ed1f6704af | 06:02 | merge | - |
| BL-1905 8e4124e455 | 06:17 | merge | - |
| BL-1910 b752a4a955 | 06:49 | merge | - |
| BL-1907 c88b42f23d | 07:05 | land step | "the land step's registry pass would change backlog/standing-reds.tsv (retire 3, restore 0)" |
| BL-1860 1d3309eb61 | 07:17 | merge | - |
| BL-1888 cae0768e6c | 07:28 | land step | subject "BL-1888: review of hotfix 364dabfd66; BL-633's BL-590 lookup ..." names BL-633 and BL-590 too |

Merge path: 6 of the 12 runs after the merge path went live. The longest
consecutive merge-path run is 3. Two land-step runs escalated to QA.

## Cause 1: the "conflicts" declines were not conflicts

`land_merge_path.bb` `build!` reports ANY non-zero exit of `git merge` as
"merging origin/main into the line conflicts" and discards git's stderr.

Reproduced in a `git clone --shared` scratch copy
(`git rev-parse --git-common-dir` = `.git`, the clone's own), hooks path
set to `swarmforge/git-hooks`, `git checkout --detach d3bb22043c`, then
`git merge --no-ff -m "Land BL-1891: merge origin/main ce40995d90"
ce40995d90`, the lander's exact command and message:

- `git merge-tree --write-tree ce40995d90 d3bb22043c` reports NO conflict.
- The merge is refused by the commit-msg hook's `check_merge_deletion.sh`:
  `Error: merge deletes 'tmp/BL-1867-tmpdir/.../project.prompt' (BL-1834,
  introduced at 7faaee00db on this branch), not named in the commit
  message.` (29 such lines.)

The 29 `tmp/BL-1867-tmpdir/` files are the BL-1897 fixture leak. They
reached origin/main in BL-1834's replay 7faaee00db, and origin/main
deleted them in 0cd819a49f (BL-1897). Every line cut before 0cd819a49f
still carries them (90b1c556a8, ec82c2560a and 593e79cc91 each carry 29),
so merging origin/main into such a line deletes them. The guard reads
that deletion as the merge dropping "this branch's" work.

That deletion is origin/main's, already landed. The guard's
`collect_deletions HEAD "this branch"` direction flags every path the
receiving side has that the merge result lacks. When origin/main is the
INCOMING side, that is every non-ticket-YAML deletion main made since the
line's base. The leak was one instance. A retirement is the general one:
since 2026-10-02 00:00 main also deleted `compose_banked_briefing_cli.bb`,
its test, `bl1641EnsureBriefingInvariants.property.test.js`, its step file
and `test_bl1641_ceremony_deadline_produces_a_briefing.sh`. Every line
older than such a deletion is refused the merge path, and so is a role's
own `git merge origin/main` (roles have been working round it by naming
the introducing ticket in the merge message).

(Run today, the same repro also fails `check_closed_ticket_subject.sh`
because BL-1891 has since closed. At land time it was open; that line is
an artifact of re-running it later.)

Owners: BL-1913 (the guard reads a deletion already on origin/main as
landed) and BL-1914 (the merge path's decline names git's own reason).

## Cause 2: the replay commit's 60 s bound

The land step's tip-pure replay commits with `git!`, which runs every git
command under `daemon-cycle-guard-lib/sh!` and its generic 60 s
`SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS` default. `git commit` runs the
pre-commit and commit-msg hook chains. Measured here: the replay commit of
BL-1893's two evidence files (`git checkout --detach b986112927`, both
files from 593e79cc91, the land step's own subject) took 69 s at load
average 14.3, with the property guard skipping. The hook chain alone can
outlast the bound on a busy host, whatever the commit carries.

A timed-out commit is reported as `land-step replay: commit refused for
<id> - daemon-cycle-guard: bounded-wait timeout ...` and classified as
"entangled tip ... specifier adjudication needed", LAND_ESCALATE, exit 3.
Nothing about the tip is entangled; there is nothing to adjudicate. BL-1901
escalated at 02:09 and was on main at 03:19.

Owner: BL-1912.

## Cause 3: the registry pass

BL-1907 owned 3 standing-red rows. The merge path declines whenever the
land step's registry pass would change a register (QA spec-gap 003735 on
BL-1901), and BL-1631 retires the landing ticket's own rows. So every
ticket that owns a register row (each standing-red owner, each pole or
allowlist owner) leaves the merge path. That is the move BL-1870's
remaining slice names as its prerequisite.

Owner: BL-1915.

## Cause 4: a subject that mentions another ticket

BL-1901 invariant 1 (QA D2): a merge-path land publishes no commit naming
a ticket besides the landing one. BL-1888's stamp-off commit LEADS with
BL-1888 and mentions BL-633 and BL-590 in its description. The rule is
deliberate and conservative, and it cost one land-step run. It is not
ticketed here. If it keeps recurring in the census (stamp-off reviews
quote the hotfix's tickets), the question for a later ruling is whether
the leading id, the attribution convention every other guard uses,
should be what the merge path reads.

## After the owners land

Cause 1 stops (and the leak itself has already gone from every line cut
after 0cd819a49f). Cause 2's two escalations stop. Cause 3 stops after
BL-1915. Cause 4 and any real conflict remain. The 20-consecutive trigger
is then reachable.
