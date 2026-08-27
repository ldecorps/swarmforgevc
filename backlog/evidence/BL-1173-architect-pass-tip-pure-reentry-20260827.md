# BL-1173 — architect pass (tip-pure re-entry after QA bounce) — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner `11cd5c794f` tip-pure re-entry after QA bounce D1 (entangled
documenter tip `f8a722e71c` — BL-599/BL-980 hitchhikers, BL-506).

Cherry-picked evidence only (`f35fd0517`, `11cd5c794f`, QA bounce note).
Implementation already on architect tip from prior pass (`ddf038e5f`).

## Scope vs main

Six BL-1173 paths only: `deprecate-check.ts`, unit + property tests, steps,
index require, `promote_and_route_next.sh`. No sibling hitchhikers.

## Architecture / invariants

Unchanged from prior architect pass — pure CLI tool + fail-closed promote
consult; P1–P3 property encodings intact.

## Gates

| Gate | Result |
|---|---|
| Dep-gate | **PASSED** |
| Unit | **7/7** |
| Properties | **5/5** |
| Acceptance | **5/5** |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
