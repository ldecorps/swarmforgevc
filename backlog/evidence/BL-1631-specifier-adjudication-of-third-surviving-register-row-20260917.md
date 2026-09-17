# BL-1631 - the third surviving register row of the day (BL-1623's), 2026-09-17

Inbound: coordinator note 009207 (15:45Z, priority 00): "stale standing-red
row BL-1623 (closed) bl1309 - test green, retire". BL-1623 closed at 16:44
local (8d4e2273f0); its fix is on main (6a434e8b4d, `sweepStaleTmpDirs` in
bl1309 and tmpDir.js). Its two rows (standing-red register line 32, property
allowlist line 3) were still present on main AND on the QA tip: the parcel
never removed them, and QA approved against its own e2e step 5 ("the
bl1309 rows gone"). `standing_red_register_cli.bb .` reported the row
unowned; the coordinator throttled to cap 1.

## "Test green" checked, not assumed

First solo run of the file (16:47 local): invariant 1 FAILED at 70 s. The
host was at 1-minute load 20.5 with TWO property lanes running at once
(pids 14425 and 16625, `npm run compile && vitest run --config
vitest.properties.config.mjs`, from two worktrees) - the file's budget is
`propertyLaneTimeoutMs(20000)`, which at forks=1 scales by load only and
capped at 70 s here; invariant 1 measured 14.9 s at load 6 this morning.
Targeted re-run of invariant 1 alone (`-t`): PASSED in 21.0 s; the other
two invariants passed in the first run (23.3 s and 7.6 s). A load timeout
under two concurrent lanes, not a red: the rows are retired in this commit.
Recorded because a coordinator note's "test green" was not measured, and
because two property lanes at once on one host is BL-1618's exact target.

## Why this keeps happening, and the stop

Three lands today closed with their rows present: BL-1605 (10:04, a
hand-resolved merge kept the row), BL-1613 (13:14, a tip-pure replay that
carried no register change), BL-1623 (16:44, the parcel never removed
them). BL-1604 makes the land step restore OTHER open tickets' rows a
replay would drop; nothing makes it retire the landing ticket's OWN rows.
BL-1631 (minted here) is that mirror - `rows-to-retire` beside
`rows-to-restore`, one `REGISTER_ROW_RETIRED` line per row, the accepted
pole row (BL-1629) excepted. QA.prompt gains one sentence in this commit:
grep the three registries for the ticket id on your tip before approving.

By specifier.
