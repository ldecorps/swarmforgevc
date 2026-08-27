# Run `/deprecate` soft verbs (BL-1174)

*How-to. Task-oriented: rank stale orphan conf flags, dry-run or retire one,
or wrap the BL-1173 freshness check.*

Soft-tier operator verbs on the shared BL-698 Telegram / Cursor surface.
Judgment requires a **hard-tier multi-document reasoner** — easy/weak seats
refuse. Sibling of the promote freshness gate ([BL-1173](BL-1173-deprecator-freshness-gate-cli.md)).

## Verbs

| Verb | Mode | Effect |
| --- | --- | --- |
| `/deprecate dry` | read | Rank orphan `config` flags; print list; no mutation |
| `/deprecate` (confirm) | soft | Adjudicate top item; retire **one** or refuse / ask human |
| `/deprecate check BL-xxx` | read | Same JSON as BL-1173 `deprecate-check.js` |

CLI (after `cd extension && npm run compile`):

```bash
node extension/out/tools/deprecate.js <project-root> dry
node extension/out/tools/deprecate.js <project-root> confirm --seat-tier hard
node extension/out/tools/deprecate.js <project-root> check BL-1234
```

`--seat-tier hard|easy|weak` is required for dry/confirm judgment. Missing or
non-hard tiers refuse with `needs hard-tier multi-document reasoner`.

## What gets ranked

Today’s scan finds **orphan conf flags**: `config NAME` lines in
`swarmforge/swarmforge.conf` whose name appears nowhere else in the tree.
Rank order: recurrence desc, blast radius desc, then subject asc.

## Confirm outcomes

| Outcome | Behaviour |
| --- | --- |
| `retired` | Remove the conf line; write `docs/deprecated/<flag>.md`; append a link under `## Deprecated` in `docs/index.md` |
| `human-ask` | Surface ambiguity; delete nothing |
| `defect` | Route to specifier adjudication; **never** auto-close a ticket |
| `refused` | Oversized vs one-item envelope (≤3 files / ≤80 lines) or seat refuse |

Living how-to/reference must not keep describing withdrawn behaviour after a
retirement — the deprecated stub is the durable record.

## Modules

| Piece | Location |
| --- | --- |
| Barrel + CLI entry | `extension/src/tools/deprecate.ts` |
| Policy / scan / retire | `extension/src/tools/deprecate/` |
| Telegram control parse | `telegramControlCore.ts` (`/deprecate…`) |
| Shared operator exec | `telegramCursorOperatorExec.ts` (`executeDeprecate`) |
| Freshness wrap | `deprecate-check` (BL-1173) via `check` mode |

## Verify

```bash
cd extension && npm test -- deprecate
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1174-deprecate-operator-verbs-scan-docs.feature
```

Acceptance: `specs/features/BL-1174-deprecate-operator-verbs-scan-docs.feature`

Related: epic BL-1172; promote gate [BL-1173](BL-1173-deprecator-freshness-gate-cli.md).
