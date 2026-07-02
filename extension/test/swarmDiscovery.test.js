const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hasPriorRunState } = require('../out/swarm/swarmDiscovery');

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-swarm-discovery-'));
}

test('hasPriorRunState is false for a target that has never launched a swarm', () => {
  const target = mkTarget();
  assert.equal(hasPriorRunState(target), false);
});

test('hasPriorRunState is true once sessions.tsv exists, even with nothing live now', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(target, '.swarmforge', 'sessions.tsv'), '0\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  assert.equal(hasPriorRunState(target), true);
});

test('hasPriorRunState is false when .swarmforge exists but sessions.tsv does not', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  assert.equal(hasPriorRunState(target), false);
});
