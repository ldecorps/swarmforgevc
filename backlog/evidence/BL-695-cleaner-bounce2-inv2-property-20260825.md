# BL-695 cleaner bounce2 (inv2 property) — 2026-08-25

## Inbound

Coder tip `40225d920a` (1-file tip surface; hitchhiked ancestry). Cherry-picked
onto hitchhike-free cleaner tip as `dfd9351777`.

Hitchhike gate vs origin/main: CLEAN for stacked ticket surfaces (no
INTAKE/done/M8/acpHostClient).

## Checks run

1. **Compile** — OK.
2. **Property (scoped)** — `topicThreadKind.property.test.js`: 3/3.
3. **Unit** — `topicThreadKind.test.js`: 7/7.

## Cleanup performed

NONE — property encodings are already small and share classify helpers;
no further DRY without inventing property-test structure.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-695-bounce2-inv2-property-still-unencoded`.

By cleaner.
