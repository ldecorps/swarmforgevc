# BL-1684 — hardener bounce, 2026-09-21

1 defect found. Full checklist run to completion before this bounce
(Article 4.4).

## D1

- **Failing command**: direct `composePipelineBoardHtml(data, 0, undefined, maxLength)`
  probe against the real compiled module (`extension/out/concierge/pipelineBoard.js`),
  reproduced below.
- **Commit hash**: `ab1a4cc6e0` (architect's merge tip received by hardender)
- **First error excerpt**:
  ```
  data.links: [] (empty -> repoBaseUrl unset or no linkable entries, a REAL production shape)
  full.length with no repoBaseUrl: 1644
  composePipelineBoardHtml result.html.length: 1644 vs maxLength: 1594
  VIOLATION: true
  ```
- **Failure class**: correctness (declared-invariant violation)
- **Expected vs observed**: the ticket's own FIRM claim (`approval_context`):
  "the message limit is a hard invariant - composePipelineBoardHtml never
  returns html longer than its maxLength, links or none" - and the
  declared invariant text itself: "composePipelineBoardHtml never returns
  html longer than its maxLength for any board, with or without a link
  list". Observed: `composePipelineBoardHtml`'s own early-return -

  ```js
  if (full.length <= maxLength || !repoBaseUrl || (data.links ?? []).length === 0) {
    return { html: full, omittedLinkCount: 0 };
  }
  ```

  short-circuits on EITHER of the last two clauses regardless of
  `full.length`, returning the unbudgeted `full` html whenever
  `repoBaseUrl` is falsy OR `data.links` is empty - bypassing every
  trimming step AND this parcel's own new last-resort `<pre>` fallback
  entirely. Both bypass conditions are real, named production shapes, not
  synthetic ones: `repoBaseUrl` is legitimately `undefined` "e.g. no git
  remote" (this file's own comment at `renderPipelineBoardLinks`, line
  ~1622), and `data.links` is legitimately `[]` whenever
  `extras.repoBaseUrl` is falsy in `computePipelineBoard` (line ~880:
  `const links = extras.repoBaseUrl ? buildLinks(...) : []`) - the EXACT
  shape the ticket's own incident describes ("a board of fifteen such
  rows composes to 4119-4396 chars **with no link list to drop**").
  The new last-resort fallback this parcel added is therefore dead code
  for both of these real shapes - not merely untested, architecturally
  unreachable through them, however small `maxLength` or large the body
  becomes.

  Today this is masked in practice only because the caption-cap fix
  (this same parcel's own D0 change) keeps `full.length` small enough
  that the first clause (`full.length <= maxLength`) is what actually
  saves every board this session's own property test and hunt script
  drew - the pinned seed-10 regression and the unpinned 150-run property
  both only ever reach `composePipelineBoardHtml` with a `repoBaseUrl` of
  `'https://github.com/x/y'` and never inspect `data.links`, so neither
  could have found this. The gap was found by construction: reproduce the
  fallback branch directly (it has zero test coverage - `grep -rn "too
  large to render" extension/test/ specs/pipeline/steps/bl1684*.js`
  returns nothing), which surfaced that it is not merely uncovered but
  unreachable via two of the three early-return clauses.

  **Reproduction** (from `extension/`, against the compiled module):
  ```js
  const { computePipelineBoard, composePipelineBoardHtml } = require('./out/concierge/pipelineBoard');
  const activeIds = Array.from({length:12}, (_,i) => 'BL-' + (100+i));
  const ticketMeta = {};
  activeIds.forEach((id,i) => { ticketMeta[id] = { title: 'a realistic title ' + i, epic: undefined, filename: id+'-x.yaml', location: 'active' }; });
  const data = computePipelineBoard({}, [], ticketMeta, { activeIds });
  // data.links is [] here because computePipelineBoard was called with no repoBaseUrl in extras
  const full = composePipelineBoardHtml(data, 0, undefined).html; // repoBaseUrl undefined, a real "no git remote" shape
  const result = composePipelineBoardHtml(data, 0, undefined, full.length - 50);
  // result.html.length === full.length, NOT <= maxLength (full.length - 50)
  ```
- **Blamed role**: coder (mechanically: the early-return's pre-existing
  `!repoBaseUrl`/`no-links` shortcuts predate this ticket, but the
  ticket's own FIRM claim is that the fix makes the bound unconditional
  - "links or none" - and the new last-resort fallback this parcel added
  was placed downstream of that early-return rather than ahead of or
  inside it, so the fix does not actually close the case the ticket's
  own incident describes).
- **Remediation pointer**: `extension/src/concierge/pipelineBoard.ts`,
  `composePipelineBoardHtml` (~line 1586). The early-return's last two
  clauses (`!repoBaseUrl`, `(data.links ?? []).length === 0`) must not
  bypass the maxLength check - either fold `full.length <= maxLength`
  back into being the ONLY early-exit condition (falling through to the
  existing `withoutLinks`/fallback logic on the other two shapes, which
  already handle `repoBaseUrl` being undefined via `buildPipelineBoardHtml(data,
  lastChangeMs, undefined, new Set())`), or add an explicit `full.length
  <= maxLength` guard inside each of those two clauses before returning
  `full` unbudgeted. Either way, the last-resort `<pre>` fallback this
  parcel added needs at least one test that actually reaches it (e.g. a
  board built with no `repoBaseUrl`/no links and a deliberately small
  `maxLength`, mirroring the reproduction above) - it currently has zero
  coverage of any kind.

By hardener.
