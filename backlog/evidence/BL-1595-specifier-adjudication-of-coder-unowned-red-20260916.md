# Coder unowned-red note (telegramFrontDeskBotCli) on the BL-1588 parcel - specifier adjudication (2026-09-16)

Inbound: `00_20260916T114927Z_001979_from_coder_to_specifier` (recipients
specifier, coordinator), "BL-1588 unowned-red: telegramFrontDeskBotCli bare
60000ms, see evidence". Coder evidence, in BL-1588's parcel:
`backlog/evidence/BL-1588-coder-unowned-red-telegramFrontDeskBotCli-20260916.md`.

## What the coder observed

Run 1 of 5 full `npm run test:properties` runs in BL-1588's post-fix
re-verification timed out
`extension/test/telegramFrontDeskBotCli.property.test.js > property (BL-1203
invariant 2)` at `test/telegramFrontDeskBotCli.property.test.js:181:1`:
`Error: Test timed out in 60000ms.` Runs 2 to 5 green. The coder read the
bare `60000` third argument and named the class (BL-1592's bl1529 row).

## Ownership check

- `grep -rlE 'telegramFrontDeskBotCli' backlog/paused backlog/active`: empty.
- `backlog/standing-reds.tsv` and
  `swarmforge/scripts/property_suite_standing_allowlist.tsv`: no row.
- Register before this pass: 11 rows, all owned (BL-1589's bl1030 row left
  with its hand-built land), `"unowned":[]`.
- Genuinely unowned under Article 4.2.

## Verification (read, not guessed)

Three `test(` declarations: line 56 pure (500 draws, no third argument);
lines 149 and 181 async, 10 draws each, git fixture via
`copySeededRepoInto` + `copyLiveScriptClosureInto`, real
`enqueueRoleAnswerNote`; third arguments the bare literal `60000` at lines
178 and 212. `propertyLaneTimeoutMs` not required. A per-test argument
overrides the lane's `testTimeout`; only a helper call from 60000 reaches
it.

## Census of the class (BL-1445)

At bdb76c3c8a, from `extension/`: a number-only line of four or more
digits closing a `test(`/`it(` call, or an inline `}, N)` with N of four
or more digits, over `test/*.property.test.js`: **38 files, 81 sites**
(script recorded in BL-1596's description; a looser rule without the
digit floor read 41/87 by counting a bare `0` closing ordinary calls).
Bases: 120000 x33, 60000 x22, 240000 x13, 30000 x7, 90000 x3, 180000 x2. Top: bl1526SpawnTargetsResolveStaticallyInvariants
7, bl1370WorktreeStrayCheck 4, telegramCursorBridgeLive 4. Only bl1343 and
bl1323 call the helper today. Third sighting in two days (bl1529 on
2026-09-16 morning, this file at noon): per-file owners cannot drain it.

## Outcome

- **BL-1595** (`type: defect`, `severity: high`, epic code-quality-gates,
  `depends_on: [BL-1588]`) owns this file's row: both bare 60000
  arguments become `propertyLaneTimeoutMs(60000)`. Register row and
  allowlist mirror row added naming it (the allowlist mirror is landed
  with the register row now, the lesson of BL-1589's land-escalate this
  morning).
- **BL-1596** (`type: defect`, `severity: medium`, `depends_on: [BL-1588,
  BL-1592, BL-1595]`) owns the class: a unit-lane guard (pure scanner +
  real-tree walk, no exemption list) and a scripted sweep of the remaining
  sites with the base preserved per site; census pinned at 38/81 and
  re-run at the parcel's base.
- Coordinator sent the paused-ready note for both; the coder (holding
  BL-1588) the owner id. Register now 12 rows, all owned; BL-1429 throttles
  above 10 - it was already engaged.
