# Stamp-off: Pipeline Board numeric &#160; (BL-1117)

BL-848 stamp-off for tip `646ffe85d`. Green tests never write `certified` /
`waived` into the hotfix ledger — only a recorded human decision does.

## What landed

`extension/src/concierge/pipelineBoard.ts` `escapeHtml` maps U+00A0 to the
numeric HTML entity `&#160;`, not the named entity `&nbsp;`.

Telegram `parse_mode=HTML` allows only the named entities `&lt;` `&gt;`
`&amp;` `&quot;`. Named `&nbsp;` rendered as the literal string
`&nbsp;` on some clients; numeric `&#160;` keeps the DC…QA stage header on
one phone line.

Provenance: follow-on to certified tips under BL-1113 (named-entity era).
This stamp confirms tip `646ffe85d` — it does not reimplement a parallel fix.

## Operator check

After a Pipeline Board post, the stage header between DC and QA should show
a normal space (not the characters `&nbsp;`). Acceptance:
`specs/features/BL-1117-swarm-stamp-pipeline-board-numeric-nbsp.feature`.

## Stamp-off posture

- Review confirms or refutes landed commit `646ffe85d` only.
- Ledger row for `646ffe85d` stays `pending` until Approvals / human ledger
  decision ([BL-848](BL-848-certify-an-operator-hotfix.md)).
- Related: BL-1113 stamp bundle; Pipeline Board links
  ([BL-513](BL-513-pipeline-board-current-folder-links.md)).
