'use strict';

// BL-1243: each Live Screen tile paints its own agent's activity. BL-1160 put
// the dot in the tile and taught the UI to prefer a per-pane activitySignal,
// then deliberately left the writer unbuilt rather than fake one from
// aggregate data. This is the writer, and these are its tests.
//
// The real BL-970 captures are the fixtures: the same seven pane texts the
// swarm side and the extension side are already held to agree on. A hand-typed
// "busy-looking" string proves nothing about a real terminal, and BL-1003
// records both directions of that mistake being made.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { derivePaneActivitySignal } = require('../out/bridge/residentPaneLive');
const { isPaneActivelyProcessing } = require('../out/panel/agentPaneState');

const UI_SOURCE = path.join(__dirname, '..', 'src', 'bridge', 'residentSpyUiHtml.ts');

// The browser's own resolver, lifted from the UI source rather than restated -
// a hand-written copy could drift from the rule that actually paints the dot.
function loadResolver() {
  const source = fs.readFileSync(UI_SOURCE, 'utf8');
  const fn = /function resolvePaneStatusKind\(pane, aggregateKind\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(fn, 'resolvePaneStatusKind has moved or been renamed');
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}\nreturn resolvePaneStatusKind;`)();
}

const FIXTURES = path.join(__dirname, '..', '..', 'specs', 'features', 'fixtures', 'BL-970');
const KINDS = new Set(['ok', 'stale', 'err']);

// BL-1291: pinned rather than enumerated - a live directory listing here
// previously walked this fixture folder on every run, a cost that grows
// with however many captures accumulate there over time. This is the exact
// "same seven pane texts" the header above already names; a new BL-970
// capture added later needs a line here too, the same discipline a pinned
// fixture list already asks elsewhere in this codebase.
const FIXTURE_FILES = [
  'empty-capture.txt',
  'idle-bg-shell-running-chrome.txt',
  'idle-quoted-busy-marker.txt',
  'idle-real-qa-4-shells.txt',
  'midturn-esc-footer.txt',
  'midturn-unlisted-verb-no-counter.txt',
  'midturn-unlisted-verb-real-capture.txt',
];

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('BL-1243 the per-pane activity signal', () => {
  it('paints a mid-turn pane ok, on every real mid-turn capture', () => {
    for (const name of FIXTURE_FILES.filter((f) => f.startsWith('midturn-'))) {
      assert.equal(derivePaneActivitySignal(fixture(name)), 'ok', name);
    }
  });

  it('paints an alive-but-idle pane stale, on every real idle capture', () => {
    for (const name of FIXTURE_FILES.filter((f) => f.startsWith('idle-'))) {
      assert.equal(derivePaneActivitySignal(fixture(name)), 'stale', name);
    }
  });

  it('never lets a blank capture inherit green from the aggregate', () => {
    // A pane we looked at and saw nothing on answers for itself - `stale`,
    // the honest floor. Returning nothing would hand the answer to the
    // whole-poll aggregate, which knows nothing about this pane.
    assert.equal(derivePaneActivitySignal(fixture('empty-capture.txt')), 'stale');
    assert.equal(derivePaneActivitySignal(''), 'stale');
    assert.equal(derivePaneActivitySignal('   \n  \n'), 'stale');
  });

  it('gives no signal at all when there was no capture to speak for', () => {
    // Distinct from a blank capture: no pane here, so the snapshot's
    // unavailable branch hides the dot exactly as it did before this ticket.
    assert.equal(derivePaneActivitySignal(undefined), undefined);
  });

  it('agrees with isPaneActivelyProcessing rather than re-deciding busy', () => {
    for (const name of FIXTURE_FILES) {
      const text = fixture(name);
      if (!text.trim()) {
        continue;
      }
      assert.equal(
        derivePaneActivitySignal(text) === 'ok',
        isPaneActivelyProcessing(text),
        `${name}: the signal and the shared busy predicate disagree`
      );
    }
  });

  it('emits nothing outside the palette that already existed', () => {
    for (const name of FIXTURE_FILES) {
      const signal = derivePaneActivitySignal(fixture(name));
      assert.ok(signal === undefined || KINDS.has(signal), `${name} produced ${signal}`);
    }
  });

  it('lets a failed poll outrank a pane own healthy signal', () => {
    // BL-1243 scenario 06: this view repaints the LAST snapshot's panes when a
    // poll fails, and the per-pane signal is read first - so a tile that was
    // busy when the bridge went down would stay green for the whole outage.
    const resolve = loadResolver();
    const busy = { available: true, activitySignal: derivePaneActivitySignal(fixture('midturn-esc-footer.txt')) };

    assert.equal(resolve(busy, 'err'), 'err', 'a failed poll was painted healthy by a stale per-pane signal');
    // ...and only a FAILED poll. A merely stale aggregate still yields.
    assert.equal(resolve(busy, 'stale'), 'ok');
    assert.equal(resolve(busy, 'ok'), 'ok');
  });

  it('lets two panes in the same poll differ', () => {
    const busy = derivePaneActivitySignal(fixture('midturn-esc-footer.txt'));
    const idle = derivePaneActivitySignal(fixture('idle-real-qa-4-shells.txt'));
    assert.notEqual(busy, idle, 'a busy and an idle pane must not paint the same dot');
  });
});
