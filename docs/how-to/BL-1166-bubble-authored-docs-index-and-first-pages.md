# Bubble Operator docs on phone (BL-1166)

*How-to. Task-oriented: browse the documenter corpus from the expanded Bubble
pager on a phone — Divio sections from `docs/index.md`, readable HTML pages,
read-only.*

First slice of epic BL-1165. Separate from BL-908's on-device cached panels
and from the Gherkin spec explorer.

## What you get

1. Expand Bubble → open **Operator docs** (manifest page `operator-docs`,
   order 6 beside other BL-829 remote pages).
2. See four Divio sections parsed from `docs/index.md`: tutorials, how-to,
   reference, explanation.
3. Drill into a section list, open a how-to or reference page — rendered
   HTML, not raw markdown, legible at phone viewport width.

## Constraints

| Rule | Detail |
| --- | --- |
| Read-only | No writes to git, backlog, or operator stores |
| Auth | Valid bridge token required (401/403 without) |
| Taxonomy | Follows `docs/index.md` — browser does not invent sections |
| Offline | Bridge unreachable → honest unavailable state naming reachability |

## Where it lives

| Piece | Location |
| --- | --- |
| Pager entry | `letsTalkRoutes.ts` → `operatorDocs` |
| Index source | `docs/index.md` via `operatorDocsCore.ts` |
| HTML shell | `operatorDocsHtml.ts` |
| Routes | `/operator-docs`, `/operator-docs-index`, `/operator-docs-page` |

## Verify

```bash
cd extension && npm test -- operatorDocsCore
cd extension && npm test -- operatorDocsReadOnly
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature
```

Manual once on device: expanded Bubble → Operator docs → section → page
readable on phone viewport.

Related: [Bubble remote page pager](BL-829-bubble-remote-page-pager.md),
[Bubble knowledge screen](BL-908-bubble-knowledge-screen-backlog-docs-panels.md).
