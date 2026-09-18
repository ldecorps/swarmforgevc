# Shift-end consolidation sweep - tickets minted 2026-09-17 (run 2026-09-18)

Operator hotfix 2026-09-17 (specifier.prompt "Consolidation Authority",
shift-end sweep): at every closing-ceremony lean pass, read the shift's
mints as one batch and merge those sharing a root cause or a fix shape.
No ceremony packet for the 2026-09-17 day shift reached the specifier -
the last recorded pass is `.swarmforge/lean/ceremony/2026-09-17.json`
(outcome process_ticket BL-1617, recorded 07:29Z on 09-17, before the
day's mints) and no 2026-09-18 packet exists at 09:30 local on 09-18
(the loud log's last entry is 2026-09-17T07:45Z). The human asked on
2026-09-18 morning whether the sweep had been done; it had not, and it
was run by hand on that ask. When the packet arrives, its outcome is this
sweep (`process_ticket`, ref BL-1625).

## The batch

`grep -l "Minted 2026-09-17" backlog/{paused,active,done,done/*}/*.yaml`
at 7c69a92ee7 - 17 tickets:

| id | where | type/sev | epic | root cause / fix shape |
|---|---|---|---|---|
| BL-1615 | active | defect/high | multi-seat-stages | seat mail is a dead letter (dispatcher reads the stage queue) |
| BL-1616 | active | defect/high | multi-seat-stages | Work-note builds not counted as worked by the seat |
| BL-1617 | paused | defect/medium | swarm-reliability | commit-msg guard: closed-ticket subject refused on role branches |
| BL-1618 | done/M8 | feature | unit-suite-speed | which roles run which lanes (ruling A) |
| BL-1619 | paused | feature | unit-suite-speed | property lane recorder (node, wraps vitest JSON reporter) |
| BL-1620 | active | chore | unit-suite-speed | two unit-lane poles under the per-file budget |
| BL-1621 | active | defect/high | code-quality-gates | red owner: bl1297 no per-test budget (timeout shape) |
| BL-1622 | paused | defect/medium | code-quality-gates | hotfix stamp: withoutEmbeddedSource scanner (review-only) |
| BL-1623 | done | defect/high | code-quality-gates | red owner: blind os.tmpdir() prefix sweep (7 property files) |
| BL-1624 | paused | defect/high | code-quality-gates | red owner: shell test asserts a parcel-time diff vs main; missing-build message; census guard |
| BL-1625 | paused | feature | unit-suite-speed | shell manifest: no lane runs it -> recorded sequential runner |
| BL-1626 | paused | defect/high | code-quality-gates | red owner: three promotion features hand-list a bb closure; freshness gate CLI path |
| BL-1627 | paused | defect/high | code-quality-gates | red owner: mapfile in two scripts (bash 3.2); host-premise scenarios retired |
| BL-1628 | paused | feature | unit-suite-speed | landed features: no lane runs them -> recorded sequential runner |
| BL-1629 | paused | feature | unit-suite-speed | pole register gains an accepted disposition; bl968 first accepted row |
| BL-1630 | paused | defect/medium | unit-suite-speed | twelve handlers do work at module load; registry load 19.5 s |
| BL-1631 | paused | defect/high | code-quality-gates | land step retires the landing ticket's own register rows |

Plus BL-1632 (minted 2026-09-18, red owner: bl1071 host-wide process
probe), read alongside because it shares the red-owner class.

Eligible for consolidation: the eleven paused. Active tickets are never
consolidated (BL-317/BL-325 worktree staleness); done tickets are closed.

## Groups and decisions

**1. Same fix shape, two populations - MERGED: BL-1628 into BL-1625.**
Both minted a sequential bash runner over a population, one JSON duration
row per completion, a verdict, the suite's exit status, `--dry-run`,
`set -uo pipefail` (BL-1242), `date +%s%3N`, a mkdtemp fixture test with
two passing and one failing item, and the same "recorder half, changing
no lane set until the census" framing. Differences reconciled: rows per
ITEM for both (BL-1628's FIRM, strictly more informative than BL-1625's
per-run row - a kill leaves a partial census); two durations files (one
per lane); two thin front-ends that only build the list. Result: one
runner, two front-ends, one feature (five scenarios, two invariants), one
ticket - BL-1625 amended, BL-1628 retired `closed_as:
superseded-by-BL-1625`, its unbuilt feature file removed (no handler
existed), BL-1626/BL-1627's live pointers repointed. Article 5.3: the two
human sentences quoted in both sources ("we should not sweep failing
tests under the carpet", 2026-09-05; "tests run for hours", 2026-09-17)
survive verbatim in the merged source.

The merge also surfaced a sizing error in both tickets as minted: each put
its population's full census INSIDE the parcel. Every run_acceptance.sh
call loads the whole step registry (19.5 s wall, BL-1630), so BL-1628's
1294-feature census is about seven hours of registry load before any
scenario runs (about two hours at BL-1630's target); the shell manifest's
518 rows include bb runners with 240 s budgets (BL-1541). That is the
"tests run for hours" the 2026-09-17 intake refused (BL-1618). The merged
ticket runs bounded samples (`--limit`) of each real population in the
parcel and makes each population's first full run a nightly-slot run
after landing - the census the lane-set rows are minted from.

**2. BL-1619 (property recorder) - NOT merged.** Same recorder shape but a
different substrate: a node wrapper over vitest's JSON reporter, the twin
of recordTestDuration.js (BL-078/BL-378), one process for the whole lane
(per-run rows are the natural grain there). Merging would put node and
bash runners in one parcel for no shared code. Row names are already
mirrored across the three by direction.

**3. BL-1624 and BL-1627 - NOT merged.** Same class (a standing assertion
true only at parcel time or on one host: BL-1006's shape) but different
lanes (shell test vs feature file), different files, and each carries a
second, unrelated half (a missing-build message plus a census guard; two
real mapfile fixes). A merge would be a grab-bag (INVEST Valuable fails).

**4. BL-1621, BL-1623, BL-1624, BL-1626, BL-1627, BL-1632 (red owners) -
NOT merged.** Six different files, six different root causes; the
register is keyed per file and each row leaves in its own land. The
CLASS is worth one line: three of them (BL-1621 timeout, BL-1623 tmpdir
sweep, BL-1632 process probe) are "verdict turns on what else is alive on
the host"; a whole-tree finder for host-global reads in tests is BL-1632's
named out-of-scope, to mint if a second process-probe file appears.

**5. BL-1629 and BL-1631 - NOT merged; no depends_on added.** BL-1631
reads BL-1629's `disposition` column "when present" and both say so;
different files (check-suite-file-budget.ts + suite-poles.tsv vs
land_step_lib.bb), orthogonal under Article 3.2.3.

**6. BL-1629 and BL-1630 - NOT merged.** Explicit mutual out-of-scope
(accepting bl968's pole vs cutting the load); bl968 stays an accepted pole
even at BL-1630's target (two loads x <5 s > 7000 ms).

**7. BL-1617 and BL-1622 - NOT merged.** A commit-msg guard and a
review-only hotfix stamp; nothing in common but the epic family.

**8. BL-1615/BL-1616 (active), BL-1620/BL-1621 (active), BL-1618/BL-1623
(done)** - outside the authority; read for overlap with the paused set
only (none).

## Outcome

`process_ticket`, ref BL-1625 (the merge is the ticket-shaped outcome).
One merge, seven reasoned non-merges, one sizing correction. Recorded in
the ceremony store when the 2026-09-18 packet exists; if the recorder
refuses a shift with no packet, this file is the record until then.

By specifier.
