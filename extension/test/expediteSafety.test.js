const assert = require('node:assert/strict');
const { extractScopePaths, findFileCollision, unsafeDispatchToastText } = require('../out/concierge/expediteSafety');

// BL-490: the Expedite verb's file-level safety posture (pure core) - an
// in-flight same-file build is never preempted by a forced dispatch.

test('extractScopePaths: pulls path-like tokens out of free-text description/notes', () => {
  const text = 'Scope: touches extension/src/tools/telegramFrontDeskBotCore.ts and extension/src/panel/backlogWriter.ts.';
  assert.deepEqual(extractScopePaths(text), ['extension/src/tools/telegramFrontDeskBotCore.ts', 'extension/src/panel/backlogWriter.ts']);
});

test('extractScopePaths: dedupes a path mentioned more than once', () => {
  const text = 'edits extension/src/panel/backlogWriter.ts again, extension/src/panel/backlogWriter.ts.';
  assert.deepEqual(extractScopePaths(text), ['extension/src/panel/backlogWriter.ts']);
});

test('extractScopePaths: returns an empty array for text with no path-like tokens', () => {
  assert.deepEqual(extractScopePaths('a plain description with no file paths at all'), []);
});

test('extractScopePaths: returns an empty array for undefined text', () => {
  assert.deepEqual(extractScopePaths(undefined), []);
});

test('findFileCollision: returns the colliding in-flight ticket id when a path overlaps', () => {
  const inFlight = [{ id: 'BL-100', paths: ['extension/src/panel/backlogWriter.ts'] }];
  const collision = findFileCollision(['extension/src/panel/backlogWriter.ts', 'extension/src/concierge/topicRouter.ts'], inFlight);
  assert.equal(collision, 'BL-100');
});

test('findFileCollision: returns undefined when no in-flight ticket shares a path', () => {
  const inFlight = [{ id: 'BL-100', paths: ['extension/src/other/file.ts'] }];
  assert.equal(findFileCollision(['extension/src/panel/backlogWriter.ts'], inFlight), undefined);
});

test('findFileCollision: returns undefined when there is no in-flight ticket at all', () => {
  assert.equal(findFileCollision(['extension/src/panel/backlogWriter.ts'], []), undefined);
});

test('findFileCollision: one shared path is enough, not a majority/fuzzy match', () => {
  const inFlight = [{ id: 'BL-100', paths: ['a.ts', 'b.ts', 'shared.ts'] }];
  assert.equal(findFileCollision(['x.ts', 'y.ts', 'shared.ts'], inFlight), 'BL-100');
});

test('findFileCollision: with 2+ in-flight candidates, a non-colliding first candidate does not short-circuit the search for a colliding second one', () => {
  const inFlight = [
    { id: 'BL-100', paths: ['a.ts', 'b.ts'] },
    { id: 'BL-200', paths: ['extension/src/panel/backlogWriter.ts'] },
  ];
  const collision = findFileCollision(['extension/src/panel/backlogWriter.ts'], inFlight);
  assert.equal(collision, 'BL-200');
});

test('unsafeDispatchToastText: names the colliding in-flight ticket id', () => {
  assert.match(unsafeDispatchToastText('BL-100'), /BL-100/);
  assert.match(unsafeDispatchToastText('BL-100'), /unsafe/i);
});
