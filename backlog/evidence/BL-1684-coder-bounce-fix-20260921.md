# BL-1684: hardener bounce D1 fix — coder

Fixes the defect in `backlog/evidence/BL-1684-hardener-bounce-20260921.md`
(hardener, D1, commit `ab1a4cc6e0`).

## What was wrong

`composePipelineBoardHtml`'s early return:

```js
if (full.length <= maxLength || !repoBaseUrl || (data.links ?? []).length === 0) {
  return { html: full, omittedLinkCount: 0 };
}
```

short-circuited on `!repoBaseUrl` or an empty `data.links` regardless of
`full.length`, returning the unbudgeted `full` html whenever either held —
bypassing every trimming step and this ticket's own last-resort `<pre>`
fallback entirely. Both are real production shapes (no git remote
resolved this tick; `computePipelineBoard` called with no `repoBaseUrl` in
`extras`, which is how `data.links` ends up `[]`), not synthetic ones.

## What changed

`extension/src/concierge/pipelineBoard.ts`, `composePipelineBoardHtml`:
the ONLY early-exit condition is now `full.length <= maxLength`. When
there's no `repoBaseUrl` or no links to drop, the function now falls
through to the `withoutLinks`/fallback logic (previously reached only via
the link-dropping loop) instead of returning `full` unconditionally. The
fallback `<pre>` string is factored into `pipelineBoardFallbackHtml` to
avoid duplicating it across the two paths that can now reach it.

## Verification

- Hardener's own reproduction (`extension/`, against the compiled
  module): `composePipelineBoardHtml(data, 0, undefined, full.length - 50)`
  with `data.links === []` (a real board built with no `repoBaseUrl`) —
  before: `result.html.length === full.length` (1644, over the 1594
  bound). After: `result.html.length === 93` (the fallback), within
  bound.
- New property test `BL-1684 invariant 1 (D1 regression): the message
  limit holds even when there is no link list to drop`
  (`extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js`):
  crosses both bypass shapes (`no-repo-base-url`, `no-links-in-data`) with
  a `maxLength` forced under the unbudgeted body, asserts the bound holds
  and `omittedLinkCount` is 0 (nothing was there to drop). 60 runs, green.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl956PipelineBoardCaptionCapInvariants.property.test.js`: 5/5 pass.
- `npx vitest run test/pipelineBoard*.test.js`: 214/214 pass, byte-
  identical to before this fix.
- `npx tsc -p .`: clean.

## Non-vacuity (BL-654)

Reverted the fix (restored the single combined short-circuit condition)
and re-ran the new property test: failed on the first generated
`no-repo-base-url` case — `composed 244 chars > maxLength 150` — the
exact D1 shape. Restored, recompiled, re-verified green (5/5).

By coder.
