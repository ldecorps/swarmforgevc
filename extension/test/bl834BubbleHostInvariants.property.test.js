'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  bubbleHostShellExposesSteering,
  bubbleHostShellHasPerpetualLoading,
  bubbleHostShellReferencesHostMutationEndpoint,
  bubbleHostShellReferencesLivePush,
  deriveHostPageViewState,
  formatHostUnreachableMessage,
  hostPageRenderedLinesAreSubsetOfFeed,
  hostUnreachableMessageIsBareStatusCode,
  simulateHostPageRender,
} = require('../out/bridge/bubbleHostCore');
const { getBubbleHostUiHtml } = require('../out/bridge/bubbleHostUiHtml');

const shellHtml = getBubbleHostUiHtml();

const feedArb = fc.oneof(
  fc.constant({ status: 'quiet' }),
  fc
    .array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 0, maxLength: 20 })
    .map((lines) => ({ status: 'active', sessionId: 'sess-prop', lines }))
);

const reasonArb = fc.oneof(
  fc.constant('bridge authentication failed — reopen from the paired Bubble pager'),
  fc.constant('the bridge feed is unavailable right now'),
  fc.constant('network error while reading the feed'),
  fc.integer({ min: 400, max: 599 }).map((code) => `HTTP ${code}`)
);

test('BL-834 invariant 1: the Host shell is a window — no steering affordances or host-session mutation endpoints', () => {
  assert.equal(bubbleHostShellExposesSteering(shellHtml), false);
  assert.equal(bubbleHostShellReferencesHostMutationEndpoint(shellHtml), false);
  assert.equal(bubbleHostShellReferencesLivePush(shellHtml), true);
});

test('BL-834 invariant 2: quiet, working and unreachable never share the same rendered state marker', () => {
  fc.assert(
    fc.property(feedArb, fc.option(reasonArb, { nil: undefined }), (feed, reason) => {
      const quietRender = simulateHostPageRender({ status: 'quiet' });
      const workingRender = simulateHostPageRender(
        feed.status === 'active' ? feed : { status: 'active', sessionId: 's', lines: ['x'] }
      );
      const unreachableRender = simulateHostPageRender(feed, reason ?? 'bridge unreachable');
      const states = new Set([
        quietRender.viewState,
        workingRender.viewState,
        unreachableRender.viewState,
      ]);
      assert.equal(states.size, 3);
      assert.equal(deriveHostPageViewState({ status: 'quiet' }), 'quiet');
      assert.equal(deriveHostPageViewState({ status: 'active', sessionId: 's', lines: [] }), 'working');
      assert.equal(deriveHostPageViewState({ status: 'quiet' }, 'any reason'), 'unreachable');
      assert.equal(bubbleHostShellHasPerpetualLoading(shellHtml), false);
      return true;
    }),
    { numRuns: 200 }
  );
});

test('BL-834 invariant 3: rendered lines are always a subset of the feed buffer', () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 0, maxLength: 30 }),
      (lines) => {
        const feed = { status: 'active', sessionId: 'sess-lines', lines };
        const render = simulateHostPageRender(feed);
        assert.deepEqual(render.lines, lines);
        assert.ok(hostPageRenderedLinesAreSubsetOfFeed(render.lines, feed.lines));
        return true;
      }
    ),
    { numRuns: 300 }
  );
});

test('BL-834 unreachable copy never reduces to a bare status code alone', () => {
  fc.assert(
    fc.property(reasonArb, (reason) => {
      const message = formatHostUnreachableMessage(reason);
      assert.match(message, /could not read the host activity feed/i);
      if (/^HTTP\s+\d{3}$/i.test(String(reason).trim()) || /^\d{3}$/.test(String(reason).trim())) {
        assert.equal(hostUnreachableMessageIsBareStatusCode(message), false);
      }
      return true;
    }),
    { numRuns: 100 }
  );
});
