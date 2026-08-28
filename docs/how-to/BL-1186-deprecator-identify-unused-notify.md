# Run the deprecator identify-unused scan (BL-1186)

*How-to. Task-oriented: get a ranked inventory of unused/seldom-used
surfaces to consider for retirement.*

Read-only. Identify + notify only — never closes a ticket, deletes code,
or mutates any config file (BL-311 three-bucket). Sibling of
[`/deprecate`](BL-1174-deprecate-operator-verbs-scan-docs.md), which
handles one adjudicated retirement at a time; this scan gives the
periodic inventory that feeds it.

## What it ranks

Every entry in the trailing-90-day usage ledger
(`.swarmforge/deprecator/usage-ledger.json`), classified by hit count.
Thresholds are locked by human directive, not configurable:

| Class | Rule |
| --- | --- |
| `unused` | 0 hits in the trailing 90 days |
| `seldom` | 1 or 2 hits in the trailing 90 days |

A surface with 3+ hits is omitted from the report entirely. The two
classes are disjoint by construction — a 0-hit surface is always
`unused`, never double-counted as `seldom`.

No usage-ledger ingestion pipeline exists yet in this repo; this scan only
**consumes** a ledger that some other pack mechanism populates. If the
ledger file is missing, unreadable, or not a JSON array, the scan fails
open with an honest empty report (`ledgerAvailable: false`, zero
candidates) rather than erroring.

## CLI

```bash
cd extension && npm run compile
node extension/out/tools/deprecate-identify-unused.js <project-root>
```

Prints the JSON report to stdout:

```json
{
  "generatedAtIso": "2026-08-28T02:20:00.000Z",
  "ledgerAvailable": true,
  "candidates": [
    { "surface": "swarmforge.conf:SOME_OLD_FLAG", "class": "unused", "hits": 0 },
    { "surface": "operatorVerb:legacyNudge", "class": "seldom", "hits": 2 }
  ]
}
```

Ranked ascending by hit count, then surface name.

## Notification

When there is at least one candidate, the report is also queued as a
plain JSON file under `.swarmforge/deprecator/pending-notifications/`
(named `identify-unused-<timestamp>.json`) — the same durable-file queuing
convention this repo's other "surface it to the human, do not act on it"
gates use. Nothing is written when the report is empty. Where that
notification surfaces to the human (daily briefing vs. a dedicated
operator topic) is left to whichever channel already reaches the human on
the running pack — this scan only writes the file.

## Seat requirement

Judgment across many surfaces at once requires a hard-tier multi-document
reasoner (Article 3.6) — `mutation_cost: high` on the ticket keeps this
off easy/weak seats. The classification and report-building logic itself
is pure and deterministic; the seat-tier requirement governs who is
allowed to *run and act on* this scan's output, not the arithmetic.

## Modules

| Piece | Location |
| --- | --- |
| Scan + CLI entry | `extension/src/tools/deprecate-identify-unused.ts` |
| Acceptance steps | `specs/pipeline/steps/bl1186DeprecatorIdentifyUnusedNotifySteps.js` |

## Verify

```bash
cd extension && npx vitest run test/deprecateIdentifyUnused.test.js
cd extension && npx vitest run --config vitest.properties.config.mjs test/deprecateIdentifyUnused.property.test.js
node specs/pipeline/cli.js specs/features/BL-1186-deprecator-identify-unused-notify.feature
```

Acceptance: `specs/features/BL-1186-deprecator-identify-unused-notify.feature`

Related: epic BL-1172; `/deprecate` retirement verb [BL-1174](BL-1174-deprecate-operator-verbs-scan-docs.md).
