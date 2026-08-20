'use strict';

// BL-994 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "No pane count and no viewport width produces a
// tile too narrow to render its role name as unbroken text. The scenarios
// enumerate five combinations; the property holds for all of them." Sweeps
// EVERY pane count the Live Screen supports (1-8) and a wide range of
// viewport widths through the real resolveGridColumns (real generated CSS,
// real cascade resolution - see resolveGridColumns.js's own header for why
// jsdom's getComputedStyle cannot be trusted for the media-gated rules).
//
// "Too narrow to render unbroken text" has no real layout engine to measure
// against (jsdom does not do layout) - the STRUCTURAL guarantee this patch
// gives is that the resolved column count is always bounded by
// min(paneCount, 4): never more grid columns than there are panes to fill
// them (which would only narrow tiles for no reason), and never more than
// the 4-column ceiling the design's widest breakpoint uses. Both are
// asserted here, generatively, across the full pane-count range the page
// actually supports and a representative viewport span (300px, narrower
// than any real phone, through 1400px, a wide desktop).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { getResidentSpyUiHtml } = require('../out/bridge/residentSpyUiHtml');
const { resolveGridColumns } = require('./helpers/resolveGridColumns');

test('BL-994/BL-654 invariant 2: resolved columns never exceed the pane count or the 4-column ceiling', () => {
  const html = getResidentSpyUiHtml();
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 300, max: 1400 }),
      (paneCount, viewportWidth) => {
        const columns = resolveGridColumns(html, paneCount, viewportWidth);
        assert.ok(columns >= 1, `columns must be at least 1, got ${columns}`);
        assert.ok(
          columns <= Math.min(paneCount, 4),
          `pane count ${paneCount} at ${viewportWidth}px resolved to ${columns} columns - `
          + `expected at most min(${paneCount}, 4)`
        );
      }
    ),
    { numRuns: 100 }
  );
});

// Non-vacuity (staged-first restore, run 2026-08-20, recorded in the parcel
// commit): break - the .pane-count-7/8 media rule's column count bumped
// from repeat(4,...) to repeat(6,...) (6 > min(7,4)=4) - RED on the first
// draw landing on paneCount in {7,8} at a >=700px width (the generator's
// own reach floor over 100 runs made this fast and reliable). Restored,
// ALL PROPERTIES HOLD.
