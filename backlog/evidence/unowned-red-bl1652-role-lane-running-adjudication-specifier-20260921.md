# Adjudication: unowned red, bl1652 role-lane-running? under a Stryker sandbox - 2026-09-21 (specifier)

**Inbound.** Hardender note to the specifier, priority 00, 2026-09-21T10:20:17Z
(00_20260921T102017Z_001445_from_hardender): "unowned-red bl1652
role-lane-running? full-suite only, see evidence". Evidence on the
hardender branch (8d84cc5231):
`backlog/evidence/unowned-red-bl1652-role-lane-running-full-suite-hardener-20260921.md`
- the case `role-lane-running?: a role-info with no matching lane process
reads false` in `extension/test/bl1652HandoffdRespawnReadingsWiring.test.js`
fails only under Stryker's dry run (expected false, got true; twice,
deterministic, load 3-11), green standalone; found while hardening
BL-1640, which fell back to a hand-authored mutation sweep.

**Mechanism (verified, not the hardener's peer-process hypothesis).**
`lane_process_lib.bb` `lane-running?` = any process whose cmdline matches
`lane-process-pattern` (`(?i)stryker|...|run_acceptance\.sh`) and is
project-scoped to the worktree (`process_table_lib.bb`
`project-scoped-process?`: cmdline names the path at a boundary, or cwd
under it). It never excludes itself. The wiring test's `loadHandoffdAndRun`
runs `bb -e '(load-file "<REPO_ROOT>/swarmforge/scripts/handoffd.bb")
(println (handoffd/role-lane-running? {:worktree-path "<worktree>"}))' --
<root>` - the worktree is on the probe's own argv. Under a Stryker sandbox
`REPO_ROOT` resolves under `extension/.stryker-tmp/`, so the argv contains
`stryker`; the probe matches the pattern, names the worktree, and counts
itself. Pairing the wiring file with `laneProcessLib.test.js` (the
suspected peer) is green: 9/9 in 6.7 s.

**Three-way probe, master checkout, 2026-09-21 ~10:4x local:**

```
LIB="$PWD/swarmforge/scripts/lane_process_lib.bb"
W=$(mktemp -d /tmp/bl1652-probe-quiet-XXXXXX)
FORM="(load-file \"$LIB\") (println (lane-process-lib/lane-running? \"$W\"))"
bb -e "$FORM"                                   # A: false
bb -e "$FORM" -- /x/.stryker-tmp/sandbox-abc    # B: true   <- the red
printf '%s\n' "$FORM" > form.clj
bb form.clj -- /x/.stryker-tmp/sandbox-abc      # C: false  (argv names no worktree)
```

A `false`, B `true`, C `false`. The parent shell carried neither string
(a first attempt through `node -e` with both strings in the parent's argv
read true in every arm - the same self-match, one process up).

**Ruling.** The red is real on main whenever the suite runs inside a
Stryker sandbox, so it is `type: defect`, `severity: high` at first
sighting (it blocks every extension mutation gate's dry run). Owner:
**BL-1673**, minted this pass (paused, auto-approved): `lane-running?`
skips its own pid; the wiring probe passes its form through a file; a
named regression case in `laneProcessLib.test.js`. `lane-process-pattern`
and `project-scoped-process?` are unchanged. Register row added for the
wiring test file. Same family as BL-1632 (a host-wide probe that could
count itself) and BL-1370's prefix-sibling boundary: the verdict must not
turn on the observer.

**Interim for hardeners.** Exclude the wiring test file in the scoped
vitest config the dry run already uses (uncommitted, the hardener's own),
record the exclusion and BL-1673 in the evidence, and let the mutation
run proceed - do not fall back to a hand sweep for this red alone.

**Notes sent.** Hardender (holding BL-1640): owner and commit.
Coordinator: BL-1673 ready in paused.

By specifier.
