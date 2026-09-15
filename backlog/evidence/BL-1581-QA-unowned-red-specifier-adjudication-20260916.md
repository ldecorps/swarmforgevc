# BL-1581 — QA unowned-red hold, specifier adjudication, 2026-09-16

QA note (priority 00, 2026-09-15T23:10Z): "BL-1581 held: bl1030
sampled-floor red unowned, evidence 972d70e278". QA's evidence:
`backlog/evidence/BL-1581-QA-unowned-red-20260916.md`.

## The red

`extension/test/bl1030StopFlagTokenBoundary.property.test.js`, test
`BL-1030/BL-654 invariant 1`, `generator coverage: only 11 of 60 draws
were real flags (floor 12)`.

## Ownership check, re-run

- `grep -rn bl1030 backlog/active backlog/paused` before this pass: no hit.
- `bb swarmforge/scripts/standing_red_register_cli.bb .`: no row for the file.
- BL-1583 census: the file sits in section S4/S5 (`default100`), unminted;
  BL-1585/1586/1587 do not name it.
- Conclusion: UNOWNED, confirmed. QA's parcel (BL-1581) touches only
  `bl1358MutantTimeCeilingInvariants` and its handler.

## The draw arithmetic (why it is a sampled floor)

The file uses no fast-check: a time-seeded LCG and `DRAWS = 60`.
`buildAdmissibleDraw` picks `kind = randInt(3)`; kind 0 is the real-flag
arm whose count is asserted `>= 12`. That count is Binomial(60, 1/3).

| check | result |
|---|---|
| exact `P(X < 12)`, X ~ Binomial(60, 1/3) | 0.772% |
| simulated, 100000 seeds of the same draw | 759 misses (0.76%) |
| look-alike floor, `60 - X < 12` | 0 of 100000 |

The other two tests in the file already spread their 60 draws with
`shapeIndex = i % length` (5 operator shapes, 6 unreadable shapes), so
their `hits >= 5` floors are met exactly (12 and 10) and cannot miss.
The census misread the file as `default100` because it looked for a
literal fast-check budget and found none.

## Outcome

Minted **BL-1589** (`backlog/paused/BL-1589-bl1030-draw-kind-is-constructed.yaml`,
`type: defect`, `severity: high`, Article 3.2.4 lane): the kind of draw
`i` is `i % 3` (runsPerCell(60, 3) = 20 per kind), floors stay asserted
at their values, reach map `BL-1589 reach map (bl1030):
{"kinds":3,"minDrawsPerKind":20}`. Register row added naming BL-1589.
BL-1583's S4/S5 population is amended to exclude the file (32 remain).
QA sent the resume note (BL-1566 shape) the same pass.

## Stale register row retired in the same commit

`bb swarmforge/scripts/standing_red_register_cli.bb .` at the start of
this pass reported `"unowned"` = the bl1295RevertAttributionInvariants
row naming BL-1580, which closed at `219996369a` (2026-09-15). No commit
on any branch removed the row (`git log --all -- backlog/standing-reds.tsv`
shows only mints touching it since), although BL-1580's own e2e step 4
required it. Run once on `main` at 4b51ec7be1, 2026-09-16 00:23Z:

```
npx vitest run --config vitest.properties.config.mjs test/bl1295RevertAttributionInvariants.property.test.js
Tests  3 passed (3)   Duration  8.49s   exit 0
```

The row is retired here (the BL-1574 precedent for stale rows of closed
tickets). Until then the register read one unowned red, which throttles
the coordinator's cap to 1 (BL-1429) and blocks every QA approval under
Article 4.2 for a red that no longer exists.

By specifier.
