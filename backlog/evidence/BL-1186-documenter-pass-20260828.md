# BL-1186 documenter pass — 2026-08-28

Merged hardener's `82124791de` (hand-mutation sweep, Stryker blocked by
pre-existing unrelated host env gap; 5/5 probes killed, no gaps).

## Documentation

New how-to: `docs/how-to/BL-1186-deprecator-identify-unused-notify.md`
(CLI usage, output shape, threshold table, notification queue location,
seat-tier requirement), modeled on the sibling BL-1174 `/deprecate` doc.
Linked from `docs/index.md`. Added a `Specification.MD` changelog entry
at the top (newest-first ordering) with the `Last Updated` date bumped
to 2026-08-28 in the same commit as the content change.

No production code changed beyond docs.

Forwarded to QA, task `BL-1186-deprecator-identify-unused-notify`, tip
`3eb3de6f91`.

By documenter.
