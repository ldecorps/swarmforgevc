'use strict';

// BL-1296 architect D1: the seat's TOPIC BINDING, which the first build left
// unwritten — so `bubbleSeatTopicId` was declared, consulted in the dispatch
// guard, and never populated anywhere in production. The guard was therefore
// unconditionally false in the live bridge and the whole seat path was dead
// code, exactly as the sibling BL-1235 seat was NOT (it sets
// `qwenLocalTopicId: readQwenLocalTopicId(env.repoRoot)` at its own
// construction site).
//
// Two things are asserted here, because the defect had two halves: the reader
// answers correctly from a REAL topic map on disk, and the live construction
// site actually calls it. A reader nobody calls is what shipped last time.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { bubbleMirrorTopicForPath } = require('../out/bridge/bubbleMirrorTopic');

const BUBBLE_TOPIC = 11810;
const CURSOR_TOPIC = 8435;
const SRC = path.join(__dirname, '..', 'src', 'tools');

function withTopicMap(map, state) {
  const root = mkTmpDir('bl1296-live-');
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  if (map !== undefined) {
    fs.writeFileSync(path.join(opDir, 'cursor-bridge-topic-map.json'), JSON.stringify(map));
  }
  if (state !== undefined) {
    fs.writeFileSync(path.join(opDir, 'cursor-bridge-state.json'), JSON.stringify(state));
  }
  return root;
}

test('the Bubble seat topic is read from the same map the mirror already reads', () => {
  const root = withTopicMap({ [CURSOR_TOPIC]: 'CURSOR_REMOTE', [BUBBLE_TOPIC]: 'BUBBLE' });
  assert.equal(bubbleMirrorTopicForPath(root), BUBBLE_TOPIC);
});

test('no bound Bubble topic is a working state, not an error - the seat simply owns none', () => {
  assert.equal(bubbleMirrorTopicForPath(withTopicMap(undefined)), undefined);
  assert.equal(bubbleMirrorTopicForPath(withTopicMap({ [CURSOR_TOPIC]: 'CURSOR_REMOTE' })), undefined);
});

// Invariant 2, upheld by the DATA and not only by the seat's own gate: a map
// that binds Bubble to cursor's own topic hands the seat nothing at all,
// rather than handing it cursor's surface.
test('a binding that puts Bubble on cursor\'s own topic gives the seat no topic', () => {
  const root = withTopicMap(
    { [CURSOR_TOPIC]: 'CURSOR_REMOTE' },
    { cursorTopicId: CURSOR_TOPIC, bubbleTopicId: CURSOR_TOPIC }
  );
  assert.equal(bubbleMirrorTopicForPath(root), undefined);
});

// The half that actually failed review: the reader is CALLED at the live
// bridge construction site. Asserted against the source because that is where
// the defect lived — the module's own unit tests were all green while the
// production path was dead.
test('the live bridge populates bubbleSeatTopicId from that reader', () => {
  const live = fs.readFileSync(path.join(SRC, 'telegramCursorBridgeLive.ts'), 'utf8');
  assert.match(
    live,
    /bubbleSeatTopicId:\s*bubbleMirrorTopicForPath\(env\.repoRoot\)/,
    'the Bubble seat is never given a topic at the live construction site, so its dispatch guard is always false'
  );
  // The sibling seat's own wiring is the reference shape; if that line ever
  // goes, this comparison is vacuous and should fail loudly rather than pass.
  assert.match(live, /qwenLocalTopicId:\s*readQwenLocalTopicId\(env\.repoRoot\)/);
});
