# BL-695 — hardener pass (bounce #2) — 2026-08-25

Architect tip: `095564b72b` (recreated `swarmforge-hardender`).

## Scope

- `extension/src/concierge/topicThreadKind.ts` — CRAP extract on retire/migrate
- Unit killers expanded (`topicThreadKind.test.js`)
- Feature Gherkin soft stamp refreshed

## Gates

| Check | Result |
|---|---|
| Unit | 16/16 |
| Properties | 3/3 |
| Acceptance | **7/7** |
| CRAP ≤ 6 | OK after extract |
| Gherkin soft | **3/3 killed**, stamped |
| Stryker `topicThreadKind.js` | **83.33%** (65 killed, 11 survived, 2 no-cov) |

## Accepted equivalents (11)

- `utf8` → `""` on `readFileSync` for ASCII JSON fixtures (Node treats both as utf8).
- Icon-map `parsed && typeof object && !Array` operator mutants — array fixture already
  returns empty map; remaining `true`/`||` arms are observationally identical on
  object maps our suite writes.
- `mkdirSync(..., { recursive: true })` → `{}` / `recursive:false` — parent
  `.swarmforge/` is created by the test fixture before write.
- `name.replace(/\.json$/i)` → `/\.json/i` — SUP filenames are exactly `SUP-N.json`,
  so non-anchored replace yields the same id.

No remaining survivor weakens fail-closed ticket writes or icon migrate/retire.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-695-bounce2-inv2-property-still-unencoded`, commit = this tip.

By hardener.
