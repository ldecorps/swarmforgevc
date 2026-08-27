# BL-1174 — architect pass (tip-pure re-entry after QA bounce) — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner `5be7395b8a` tip-pure re-entry after QA bounce D1 (documenter tip
folded BL-1185 mint — BL-506). Cherry-picked evidence only (`1d1b23767`,
`5be7395b8a`). Implementation already on architect tip from prior pass
(`d50cc7b1f`).

## Scope vs main

BL-1174 paths only (deprecate module tree, telegram verb wiring, tests,
steps). No BL-1185 hitchhikers.

## Architecture / invariants

Unchanged from prior architect pass — cohesive `tools/deprecate/` tree;
P1–P4 property encodings intact; dep-gate still green.

## Gates

| Gate | Result |
|---|---|
| Dep-gate | **PASSED** |
| Unit (`deprecate.test.js`) | **13/13** |
| Properties | **4/4** |
| Acceptance | **5/5** |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
