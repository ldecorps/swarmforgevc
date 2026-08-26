const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { suggestConfChange } = require('../out/recruiter/recommend');

// BL-233 slice 4 (recommend-not-adopt-06): suggestConfChange is a PURE
// function (no fs/child_process capability at all - see the source-
// inspection guard below) so "never modifies swarmforge.conf or bounces
// the swarm" holds structurally, not by convention (the same lesson the
// architect's secretStore bounce taught in slice 2 - see
// [[bl233-recruiter-secretstore-path-unenforced]]).

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_CONF = path.join(REPO_ROOT, 'swarmforge', 'swarmforge.conf');
const RECOMMEND_SOURCE = path.join(__dirname, '..', 'src', 'recruiter', 'recommend.ts');

function leaderboardWithPick(model) {
  return {
    role: 'coder',
    reference: { model: 'incumbent-model' },
    ranked: [{ model, capability: 3, planCost: { amountUsd: 0, unit: 'free' } }],
    recommended: model,
  };
}

test('suggests a swarmforge.conf --model line naming the recommended candidate', () => {
  const suggestion = suggestConfChange(leaderboardWithPick('winner'));

  assert.equal(suggestion.role, 'coder');
  assert.equal(suggestion.suggestedModel, 'winner');
  assert.match(suggestion.swarmforgeConfLine, /--model winner/);
});

test('returns null when nothing was recommended (no compliant candidates)', () => {
  const emptyLeaderboard = { role: 'coder', reference: { model: 'incumbent-model' }, ranked: [], recommended: null };

  assert.equal(suggestConfChange(emptyLeaderboard), null);
});

test('never modifies the real swarmforge.conf', () => {
  const before = fs.readFileSync(SWARMFORGE_CONF, 'utf8');

  suggestConfChange(leaderboardWithPick('winner'));

  const after = fs.readFileSync(SWARMFORGE_CONF, 'utf8');
  assert.equal(after, before, 'swarmforge.conf must be byte-for-byte unchanged');
});

// Regression guard, same posture as pwaServiceWorker.test.js's
// "never a hardcoded CACHE_NAME literal" test: proves by source inspection
// that recommend.ts has no filesystem or process-spawning capability at
// all, so it structurally cannot write swarmforge.conf or bounce the swarm
// - not merely "doesn't today, by convention."
test('recommend.ts imports no filesystem/process-spawning module - it cannot touch the filesystem or spawn a process', () => {
  // Matches only real import/require STATEMENTS, not this file's own (or
  // recommend.ts's own doc comment's) prose mentioning the module names.
  const source = fs.readFileSync(RECOMMEND_SOURCE, 'utf8');
  const importLines = source
    .split('\n')
    .filter((line) => /^\s*import\b|require\(/.test(line));
  const forbidden = importLines.filter((line) => /['"](fs|child_process)['"]/.test(line));
  assert.deepEqual(forbidden, []);
});
