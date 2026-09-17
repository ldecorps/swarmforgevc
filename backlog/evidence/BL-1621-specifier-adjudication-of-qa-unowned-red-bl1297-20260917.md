# BL-1621 - specifier adjudication of QA's unowned-red note (bl1297, invariant 3), 2026-09-17

Inbound: note `00_20260917T084126Z_002854_from_QA_to_specifier`, priority 00,
08:41:26Z: "BL-1605 unowned-red bl1297MergeOwnPathsInvariants inv3 timeout,
evd 574d99483c". QA evidence: `backlog/evidence/BL-1605-qa-unowned-red-bl1297-20260917.md`
(QA branch, commit 574d99483c). QA completed its BL-1605 parcel (001340,
commit 9583f2177c) at 08:41:37Z so the seat could rotate and waits on the
register row (BL-1566 shape).

## Classification: a standing red of the BL-1606 bl1304 class - not BL-1564 reopened, not BL-1605's own defect, not BL-1596's census

- **Not BL-1605's own defect** (the BL-1605 rule of 2026-09-17 06:30Z): the
  file is touched by no commit on the parcel branch and passes alone against
  the same tree (QA: 15.24 s). The BL-1605 rule covers a test green on main
  but red on trees carrying an unlanded handler; this file is red only under
  the full lane's contention, on any tree.
- **Not BL-1564 reopened**: BL-1564 (done, row left 2026-09-15) batched the
  file's 98 bb processes into one per invariant. The batches are intact -
  the three `BL-1564 reach map` lines print with 21, 18 and 18 cases and one
  `bb -e` per invariant answers them. What remains is the fixture cost.
- **Not BL-1596's**: BL-1596 (paused) migrates BARE numeric third arguments
  (81 sites, 38 files, census at bdb76c3c8a). This file's three `test(`
  calls pass no third argument at all (`grep -n "^test(" ` lines 291, 362,
  445; none closes with a numeric literal), so it is outside that census.
- **BL-1606's bl1304 shape, exactly**: "no per-test budget, the lane's raw
  20 s". BL-1606 fixed bl1304 by passing `propertyLaneTimeoutMs(20000)` to
  each test; its census was the two files red on 2026-09-16. This file was
  green that day and is the third of the class.

## Measurement (specifier, main 738952fbc0, 08:53Z, ONE run)

```
uptime: load average 2.67, 2.89, 3.60 (20 cores); extension/out compiled
npx vitest run --config vitest.properties.config.mjs test/bl1297MergeOwnPathsInvariants.property.test.js
BL-1564 reach map (invariant 1): {"cases":21,"seed":4212122177}
BL-1564 reach map (invariant 2): {"cases":18,"seed":2324796462}
BL-1564 reach map (invariant 3): {"cases":18,"seed":3026840167}
 ✓ test/bl1297MergeOwnPathsInvariants.property.test.js (3 tests) 14682ms
   ✓ property (invariant 1) ... 3586ms
   ✓ property (invariant 2) ... 2785ms
   ✓ property (invariant 3) ... 8309ms
 Test Files  1 passed (1)   Tests  3 passed (3)   Duration  15.13s
```

QA's numbers on the parcel tree: 15.24 s total, invariant 3 9.36 s. The
`20000ms` in the failure is `vitest.properties.config.mjs`'s flat suite-wide
`testTimeout` (the config's own comment, lines 53-60, fixes it at the literal
and puts the load-relative budget PER TEST on fixture-spawning files). An
8-9 s test with no per-test budget misses that ceiling at a 2.5x slowdown,
which a 404-file lane over the pool's forks supplies routinely (BL-1579's
own measurement: a single concurrent `npm test` pushes 1-minute load to
7-10).

Why 8.3 s when BL-1564's qa_e2e expected "about 2 s on a quiet host":
BL-1564 removed the per-case bb processes; the per-case fixture
construction stayed - invariant 3 builds 18 real repositories, each
through a dozen or more `git` processes, before the one batch answer.
That cost is a property-lane census question (BL-791 slice E after
BL-1619's recorder), not this ticket's to cut, and raising no base keeps
the human's "no carpet" directive: the file keeps exactly today's budget
alone and grows only with measured contention.

## Disposition

- **Minted BL-1621** (`type: defect`, `severity: high` per the standing-red
  rule; `epic: code-quality-gates` like BL-1564/BL-1606), paused,
  `human_approval: pending` (a new feature file), no ruling posed. Three
  scenarios, no invariant (BL-1606's landed invariant 1 is the property).
- **Register**: `backlog/standing-reds.tsv` gains one `property` row naming
  BL-1621, first_seen 2026-09-17 (BL-1564's row for the same file left on
  2026-09-15, so this is a second sighting, not a stale row);
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` gains the
  mirror row (BL-1428's join). Both in the mint commit; both leave in
  BL-1621's land.
- **QA resume note** (priority 00) sent the same pass, BL-1566 shape:
  merge main first so the land keeps the rows (BL-1604's hazard), then
  land 9583f2177c.
- **Coordinator** told the item is ready in `backlog/paused/`; it is
  expedited (Article 3.2.4) and orthogonal to the six active tickets (none
  touches the file, the helper or the register except by row removal at
  land).

## Gates run at mint

Recorded in the mint commit's message and below this line by the same pass:
gherkin lint, IR-DRY, backlog hygiene gate, `read-required-wiring` (two
items, one physical line each), `standing_red_register_cli.bb` (the new
row reads owned).

By specifier.
