# BL-1527 - specifier reproduction of QA's unowned red, 2026-09-11

Inbound: QA `note` (priority 00, 2026-09-11 01:18Z) from the BL-1478 parcel:
`BL-1478 unowned-red bl1367ApprovalCarriesItsRuling flaky evid 2fcc61bdfc`.
QA's evidence: `backlog/evidence/BL-1478-unowned-red-qa-20260911.md` at
`2fcc61bdfc` (on `swarmforge-QA`, not yet on `main`).

## Owner search (register is keyed per test file)

- `backlog/standing-reds.tsv`: no row for
  `extension/test/bl1367ApprovalCarriesItsRuling.property.test.js`.
- `backlog/active`, `backlog/paused`, `backlog/hold`: nothing names
  `bl1367ApprovalCarriesItsRuling`, `BL-1367`, `pendingApprovalReply` or
  `classifyApprovalRulingRequirement`.
- BL-1367 itself is in `backlog/done/` (landed `07a8d4b9b5`, 2026-09-03);
  both files' last touch is that commit.

So: a mint, not a fold-in.

## Reproduction on main d69a5c251b

Standalone property runs (`cd extension && npx vitest run --config
vitest.properties.config.mjs test/bl1367ApprovalCarriesItsRuling.property.test.js`):

| who | runs | failed |
|---|---|---|
| QA, BL-1478 parcel 2ec5ee53c7 | 6 + 8 | 3 (of the first 6) |
| specifier, main d69a5c251b | 17 | 0 |

fast-check draws a fresh seed per invocation; the failing seeds are those
that draw a whitespace-only `freeRuling` with `declaresOptions=false` and
`choosesDeclared=false`. The disagreement is deterministic once the input
is named:

```
cd extension && node -e '
const m = require("./out/concierge/pendingApprovalReply");
console.log(JSON.stringify(m.classifyApprovalRulingRequirement(undefined, " ")));
console.log(JSON.stringify(m.classifyApprovalRulingRequirement(undefined, "\t")));
console.log(JSON.stringify(m.classifyApprovalRulingRequirement(["opt a"], " ")));'
```

```
{"kind":"ok"}
{"kind":"ok"}
{"kind":"ruling-required","options":["opt a"]}
```

The oracle at test line ~121 (`if (!ruling)`) expects `unknown-option` for
the first two. `recordApprovalReply` (pendingApprovalReply.ts line 452)
trims the same way the classifier does, so production is self-consistent:
the oracle is the only party reading whitespace as an answer.

## Disposition

Minted BL-1527 (`type: defect`, `severity: high`, standing-red rule
2026-09-05), one `property` register row naming it, first_seen 2026-09-11.
Fix direction is the oracle (agree with the classifier's trim), never the
generator (the whitespace draw is a real input and must stay quantified
over, constructed and reach-asserted).

By specifier.
