# BL-994 hardener bounce — 2026-08-20

Reviewed commit: 0e5ebd1f2 (hardener's own try/finally fix on top of
architect's merge 423bb7f9ec, after merging main to pick up the specifier's
same-day amendment `fabecba4c` — "BL-994 spec amendment: retarget BL-929
scenario 03's ticket assertion to the fullscreen Expand").

## Review pass (Article 4.4 complete inventory)

- Fixture-leak check (my standing hardener check): `bl994LiveScreenGridSteps.js`
  creates no filesystem fixture roots (jsdom-only, in-memory), so the
  temp-dir class of leak does not apply. It DID have a resource-leak gap of
  the sibling kind — `renderAndExtract` closed its jsdom window with a bare
  call at the end of the function, unreached on any earlier throw, and this
  file's own header comment already documents that an open window with live
  `setInterval` polls hung the acceptance run indefinitely once before.
  Fixed in this pass (D0, harness-only, no bounce): wrapped the function
  body in try/finally. `bl994LiveScreenGrid.property.test.js` uses no jsdom;
  `bl994TranscriptExclusivity.property.test.js` already had the correct
  try/finally. `bl994LiveScreenGrid.test.js` (plain unit test) does not close
  its jsdom windows either, but that mirrors the pre-existing, unmodified
  convention in the sibling `residentSpyUiHtml.test.js` this ticket's own
  commit message cites as the pattern it copied — not a regression this
  parcel introduced, and vitest workers exit after the run, so left alone.
- Mutation (BL-113 gherkin, this feature has a Scenario Outline at
  role-tiles-square-ish-grid-01): NOT RUN this pass — blocked, see D1 below.
  Running mutation against a step-registry state that is already known to
  throw on an unrelated feature's unhandled step is not a meaningful
  mutation signal, and the fix for D1 will itself change files under
  `specs/pipeline/steps/`, which would invalidate any mutation result taken
  now. Deferred to the pass after D1 lands, not skipped.
- CRAP/DRY: N/A for this parcel's own changed files — `resolveGridColumns.js`
  and the step/test files are outside `extension/src/**`
  (crapReport.js scope) and outside Stryker's `out/**/*.js` mutate scope.
  `extension/src/bridge/residentSpyUiHtml.ts` itself is the landed human
  patch (locked decisions per constraints; not this parcel's to redesign).

## D1 — required_wiring violation: BL-929's amended scenario 03 has no step handler (class: acceptance, blamed: coder)

BL-994's own `required_wiring` (added by the specifier's same-day amendment)
states in full:

> `specs/pipeline/steps/bl929LiveScreenPackLayoutSteps.js::shows that ticket
> in its Expand view::AMENDED 2026-08-20 - this patch moves a held ticket
> off the grid tile head, which retires BL-929 scenario 03's old assertion.
> Its replacement step must be handled in BL-929's own step file, in THIS
> parcel, or the acceptance runner throws on an unhandled step and BL-929
> goes red"

Confirmed live, not taken on the ticket's word: the amended
`specs/features/BL-929-live-screen-follows-the-running-pack-not-the-resident-marker.feature`
(merged from `main`, commit `fabecba4c`) now reads at lines 41 and 43:

```
And the documenter tile is expanded
And the documenter tile shows that ticket in its Expand view
```

`grep -n "the documenter tile is expanded\|the documenter tile shows that
ticket" specs/pipeline/steps/*.js` finds no match for either string anywhere
in the tree. The only related handler present is the OLD, now-stale
`^the documenter tile shows that ticket on its own tile$` in
`bl929LiveScreenPackLayoutSteps.js:261` — the pre-amendment wording BL-929
scenario 03 no longer uses. Per `specs/pipeline/runtime.js`'s documented
behavior (BL-233, cited in this ticket's own `required_wiring`), an
unhandled step throws and fails every scenario in the feature that reaches
it — so `BL-929-...feature` scenario 03 is red on this parcel as it stands,
and per BL-994's own `qa_e2e_procedure` step 6b, all four BL-929 scenarios
including 03 are required to pass before this ticket is done.

Not mine to fix: writing the two new step handlers means implementing new
test/product-facing behavior verification (dispatch a bubbling click on
`.pane-col`, flush, read `#fs-head`, assert `BL-929` appears) for a
DIFFERENT ticket's acceptance contract — squarely "introduce new product
behavior" territory my role does not own. The specifier's own amendment
note names the owner directly: "Amendment commit is named in the note sent
to the architect (parcel holder...) and to the coder (who rebuilds the
step-handler half)." Routing to coder per that explicit assignment, not
reflexively.

## D2 — stale/misleading test comment + missing positive assertion (class: unit, blamed: coder)

`extension/test/residentSpyUiHtml.test.js:70-71` reads:

```js
  // bl994LiveScreenGrid.test.js's own "Expand still opens the full
  // metadata and transcript" test for where BL-640 is now asserted.
  assert.doesNotMatch(documenterHead.innerHTML, /BL-640/);
```

Checked the test it points to
(`extension/test/bl994LiveScreenGrid.test.js:102`, "BL-994: Expand still
opens the full metadata and transcript"): its `panesOf(n)` fixture helper
builds panes via `pane({ roleLabel: role })` with no `ticketId` field
anywhere in the file, so `buildFullscreenHeadHtml` takes its non-ticket
branch and the ticket block is never rendered in that test. The test's own
assertions (`fs-head` matches `/Coordinator/`, `fs-pre` equals the
transcript text) check the role label and transcript only. The positive
half of the D1 contract — a held ticket surfaces in the fullscreen Expand
head — is asserted NOWHERE in the current tree, confirmed by grep (no
`ticketId` in `bl994LiveScreenGrid.test.js`, and the acceptance step handler
that would supply it does not exist per D1).

This is the exact coverage hole BL-994's own AMENDED description names and
requires closing ("either restore a positive assertion in the unit test
too, or leave the comment pointing at BL-929 scenario 03 instead of at a
test that does not cover it") — recorded here as its own item because D1's
fix does not automatically correct this stale comment, and the ticket
offers either fix as acceptable. Routed to coder alongside D1 since both
stem from the same design relocation and the ticket's own notes assign the
rebuild to coder.

## Blocked

None — both D1 and D2 could be fully confirmed by direct code inspection
(grep + read) without needing a live acceptance/mutation run, so nothing in
this checklist is BLOCKED BY a tooling gap. The deferred mutation pass above
is a scheduling choice (would be invalidated by D1's fix), not a blocked
check.
