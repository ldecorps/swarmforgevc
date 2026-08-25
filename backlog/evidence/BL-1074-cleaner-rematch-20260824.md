# BL-1074 cleaner rematch — 2026-08-24

## Inbound

Coder tip `695f6d89ad` (copy-close fallback uses the Add's time after
walking done/→done/ re-files, not `newestAtDone`). Ancestry vs
`origin/main` was hitchhiked; tip commit surface is BL-1074-only.

Cleaner rebuilt hitchhike-free tip:
`origin/main` + cherry-pick `9886d6e6f4` + cherry-pick `695f6d89ad`.

Hitchhike gate → CLEAN.

## Checks run

1. **Compile** — ok.
2. **Unit** — `meanTicketTimeWalk.test.js`: 9/9.
3. **Properties** — `bl1074PostCloseRefileDuration.property.test.js`: 3/3.
4. **Gherkin acceptance** — BL-1074 feature: 5/5.

## Cleanup performed

NONE on code.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1074-post-close-refile-inflates-measured-ticket-duration`.

By cleaner.
