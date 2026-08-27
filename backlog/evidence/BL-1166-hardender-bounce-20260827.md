# BL-1166 — hardender bounce — 20260827

## Inventory

| Id | Class | Blamed | Remediation |
|----|-------|--------|-------------|
| D1 | behavior | coder | Wire `operatorDocsCore` read routes (`/operator-docs-index`, `/operator-docs-page`) into `bridgeServer.ts` dispatch — acceptance returns 404 on all three failing scenarios |

## Evidence

After merge `58fc8ca7cc`, acceptance `BL-1166-bubble-authored-docs-index-and-first-pages.feature`:
4/7 pass; 3 fail with **404 !== 200** on `/operator-docs-index` and `/operator-docs-page`.
`bridgeServer.ts` registers `createAgentNotesRoutes` but has no operator-docs route
factory — modules exist (`operatorDocsCore.ts`, `operatorDocsHtml.ts`) but are not
dispatched (ticket `required_wiring` gap).

## Blocked

None — bounce is complete after revert of review-merge `471994372`.

By hardender.
