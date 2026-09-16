# BL-1598 QA hold - specifier adjudication (2026-09-16 15:10Z)

Inbound: QA note, priority 00, 14:55Z (00_20260916T145518Z_002806):
"BL-1598 held: suite-poles.tsv stale/new-pole at land, see 93b31c8209".
QA evidence `backlog/evidence/BL-1598-QA-drift-20260916.md`.

## What QA found

Three consecutive `npm test` runs on the parcel commit at about 15:50Z
(1-minute load 6.4 to 9.0, another seat's property lane live) gave the
same verdict each time, exit 1: six registered poles reported; one
unregistered file over budget (`emitLifecycleSnapshotCli.test.js` about
9.0 s, new-pole refusal); three register rows stale (`epicReorderBridge`
5.0 s against its 10600 ms row, `pilotAcceptanceGateCli` 2.7 s against
8500, `recordBounceCli` 2.3 s against 7300). The mechanism is correct and
every deterministic check is green; the DATA drifted between the
specifier's 13:16Z measurement (load 10.8) and land time with no code
change. QA held rather than bounced because nothing in the parcel is
wrong, and asked the specifier to choose between refreshing the register
in-parcel and a follow-up.

## Ruling: the design is the defect, and it is the specifier's

A register that REFUSES on drift is a snapshot gate: it is red the first
time the host is less or more loaded than at measurement. Three of nine
rows flipped in 2.5 hours; one file swung from 7.3 s to 2.3 s. Refreshing
the numbers in-parcel (QA's option 1) moves the snapshot and fails the
same way at the next land. BL-445 documented exactly this for wall clock
("the recorded duration jitters under swarm load ... a hard fail at a
boundary would flake"); marginal per-file durations jitter the same way,
and the ticket's stale rule (80 percent) and new-pole rule (any breach)
both sit inside that jitter band.

Amendment (ticket updated on main this commit; feature changes INSIDE the
parcel on QA's bounce, since the feature carries the hardener's mutation
stamp - BL-1385):

- A stale row is REPORTED, never refused. The drain rule ("the row leaves
  in the same land that cuts the pole") is enforced by the slice D land
  and by the register CLI's stale list, not by refusing an unrelated
  parcel. A registered file that runs fast hurts nothing.
- An unregistered file refuses as new-pole only from
  `PER_FILE_DURATION_BUDGET_MS * NEW_POLE_REFUSAL_FRACTION` (1.5, so
  10500 ms); between the budget and that line it is reported as `watch`,
  named with its milliseconds, exit code untouched. A real regression (a
  10 s file becoming 20 s) still refuses; a 9 s marginal file is surfaced
  on every run and inventoried, never silently admitted (invariant 1
  re-worded to say exactly that).
- Verdict kinds: ok | watch | stale-row | unowned-row | new-pole; only
  new-pole and unowned-row fail the exit code. Recorder row gains
  `watch_files`.
- The nine register rows stay as measured (scenario 03 unchanged). No row
  for emitLifecycleSnapshotCli: it is a watch file; BL-791's slice D
  inventory gains it.

Routing: QA bounces the parcel to the coder with this amendment (Article
4.3: the guard is the coder's domain). The spec defect is the
specifier's; the coder built the spec as written and is not charged - if
QA's bounce record names the coder, BL-990's correction applies.

## Recorded, not ticketed

- Per-file wall durations on this host vary 2 to 3 times between runs
  hours apart with no code change, at 1-minute loads of 6 to 11 on 20
  cores; BL-1007's contention factor (load over cores) reads under 1 for
  all of them and would normalise nothing. The property lane's helper uses
  a 4-core quiet ceiling for the same reason (BL-1579). A per-file budget
  that means to be precise needs a contention denominator measured for
  this lane, or CPU time instead of wall - slice D's pole tickets should
  record both per file so that decision can be made on data.
