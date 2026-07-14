const assert = require('node:assert/strict');
const { parseArgs } = require('../out/tools/run-role-benchmark');

test('parseArgs rejects missing arguments', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['fixtureDir']), null);
});

test('parseArgs rejects a non-numeric repetitions or threshold', () => {
  assert.equal(parseArgs(['f', 'm.json', 'nope', '0.8', '/target']), null);
  assert.equal(parseArgs(['f', 'm.json', '2', 'nope', '/target']), null);
});

test('parseArgs rejects fewer than one repetition', () => {
  assert.equal(parseArgs(['f', 'm.json', '0', '0.8', '/target']), null);
});

test('parseArgs accepts a valid full argument set', () => {
  const args = parseArgs(['fixtureDir', 'models.json', '3', '0.8', '/target']);
  assert.deepEqual(args, { fixtureDir: 'fixtureDir', modelsFile: 'models.json', repetitions: 3, qualityThreshold: 0.8, targetPath: '/target' });
});
