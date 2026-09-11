# BL-1478 QA pass — unowned red found in test:properties, 2026-09-11

While running the required `npm run test:properties` gate on the BL-1478
parcel (merged documenter commit `2ec5ee53c7`), a pre-existing, genuinely
flaky property test fired:

```
FAIL test/bl1367ApprovalCarriesItsRuling.property.test.js > BL-1367 P1/P2/P3: an approval either carries its ruling or is not recorded
AssertionError [ERR_ASSERTION]

Expected: "unknown-option"
Received: "ok"

 > test/bl1367ApprovalCarriesItsRuling.property.test.js:131:22
 > Property.predicate node_modules/fast-check/lib/cjs/fast-check.js:1368:99
```

## Reproduced, not a one-off

Ran `npx vitest run --config vitest.properties.config.mjs
test/bl1367ApprovalCarriesItsRuling.property.test.js` standalone (no suite
concurrency) 6+ times: failed on 3 of the first 6 runs, then passed 8 in a
row on a later batch — genuinely flaky (fast-check draws a new random seed
each invocation and only some draws hit the counterexample), not a single
observation. Calling it "deterministic" would be wrong; it is not a rare
one-time fluke either.

## Root cause read from the source (diagnosis only, not a fix — not QA's to fix)

`extension/src/concierge/pendingApprovalReply.ts`'s
`classifyApprovalRulingRequirement` (lines 414-432) treats a
whitespace-only `ruling` string as blank after `.trim()` and returns `ok`
when no options are declared. The property test's oracle at line ~121-127
branches on the UNTRIMMED JS truthiness of `ruling` (`if (!ruling) …
'ok' else … 'unknown-option'`). `fc.string({minLength:1,maxLength:12})`
can and does draw whitespace-only strings (e.g. `" "`), which are truthy
before trim but blank after — so the oracle and the implementation disagree
on that one input. Whether the fix belongs in the generator (exclude
all-whitespace strings) or the oracle (trim before checking) is a call for
whoever picks this up, not decided here.

## Why this is not BL-1478's

BL-1478's own diff touches only `swarmforge/scripts/daemon_cycle_guard_lib.bb`,
the four sweep call sites in `swarmforge/scripts/handoffd.bb`, two how-to
docs, and its own feature/step/evidence files (confirmed via
`git diff main..HEAD --stat -- extension/test/bl1367ApprovalCarriesItsRuling.property.test.js extension/src/concierge/pendingApprovalReply.ts`
— empty). `git log` on both files shows the last touch was BL-1367 itself
(commit `07a8d4b9b5`), already landed and closed
(`backlog/done/BL-1367-an-approval-from-any-surface-carries-its-ruling.yaml`).

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `bl1367`, `ApprovalCarriesItsRuling`,
`pendingApprovalReply`, `classifyApprovalRulingRequirement` — no row.
Grepped `backlog/active/`, `backlog/paused/`, `backlog/hold/` for the same
terms — nothing open owns this. (The two OTHER property failures seen in an
earlier full-suite run this session — `bl1089FrontDeskLivenessFixture` and
`bl1313BatchGuardVisibilityInvariants` — are already registered as
BL-1502/BL-1503; this one is not.)

## Disposition

Filing as an `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05, Article 4.2). BL-1478's
own gates (unit runner, acceptance 5/5, required_wiring) are all green —
only this shared-lane red is outstanding. Per Article 4.2, QA withholds
approval of BL-1478 until this red carries an owning ticket; this is not a
bounce (BL-1478 did not cause it) and the parcel WAITS in place.

By QA.
