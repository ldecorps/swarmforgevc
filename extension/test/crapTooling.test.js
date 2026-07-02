const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// BL-049: CRAP report tooling for the hardener. Pins the wiring contract —
// dedicated scripts, separate from `npm test`, no new devDependency (reuses
// the c8 coverage and typescript compiler already present for BL-048).

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

test('crap tooling adds no new devDependency (reuses c8 + typescript already present)', () => {
  assert.ok(pkg.devDependencies['c8'], 'c8 must remain a devDependency');
  assert.ok(pkg.devDependencies['typescript'], 'typescript must remain a devDependency');
});

test('coverage and crap run via their own scripts, not npm test', () => {
  assert.ok(pkg.scripts.coverage, 'must define a coverage script');
  assert.match(pkg.scripts.coverage, /c8/, 'coverage script must invoke c8');
  assert.ok(pkg.scripts.crap, 'must define a crap script');
  assert.match(pkg.scripts.crap, /crapReport\.js/, 'crap script must invoke the CRAP report');
  assert.ok(
    !/c8|crapReport/.test(pkg.scripts.test),
    'npm test must stay separate from coverage/CRAP tooling'
  );
});

test('crapReport.js and crapLib.js are committed alongside the other hardener scripts', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/crapReport.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/crapLib.js')));
});
