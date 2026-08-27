'use strict';

// BL-970: step handlers for "wake busy-gate classifies from live turn
// state, not whole-pane word matching". The outline drives the REAL
// classifier (chase_sweep_lib.bb's actively-processing?, loaded via bb)
// over the shipped fixture snapshots - the canonical contract, including
// the empty-capture (unreadable pane never blocks a wake) row.
//
// Trap-resistance (the ticket's own firm line): no verbatim busy-marker
// strings appear in this file - fixture CONTENT stays in the fixture
// files; this file names them only by filename.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-970 wake busy-gate classifies from live turn state, not whole-pane word matching';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const FIXTURES_REL = path.join('specs', 'features', 'fixtures', 'BL-970');

// KNOWN_VALUES: the outline's <fixture> and <busy> tokens.
const KNOWN_FIXTURES = new Set([
  'idle-bg-shell-running-chrome.txt',
  'idle-quoted-busy-marker.txt',
  'idle-real-qa-4-shells.txt',
  'midturn-esc-footer.txt',
  'midturn-unlisted-verb-real-capture.txt',
  'midturn-unlisted-verb-no-counter.txt',
  'empty-capture.txt',
]);
const KNOWN_BUSY = new Set(['true', 'false']);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the pane snapshot fixtures directory "([^"]+)"$/, (ctx, dirRel) => {
    assert.equal(dirRel, 'specs/features/fixtures/BL-970', `unexpected fixtures dir token: ${dirRel}`);
    ctx.fixturesDir = path.join(REPO_ROOT, FIXTURES_REL);
    assert.ok(fs.existsSync(ctx.fixturesDir), `fixtures dir missing: ${ctx.fixturesDir}`);
  });

  scoped(/^the pane snapshot fixture "([^"]+)"$/, (ctx, token) => {
    if (!KNOWN_FIXTURES.has(token)) {
      throw new Error(`unknown <fixture> token: ${token}`);
    }
    ctx.fixturePath = path.join(ctx.fixturesDir, token);
    assert.ok(fs.existsSync(ctx.fixturePath), `fixture missing: ${ctx.fixturePath}`);
  });

  scoped(/^the busy gate classifies the snapshot$/, (ctx) => {
    // The REAL classifier, loaded from the real lib; the fixture text is
    // read by bb itself so this JS never holds marker text in a string.
    const res = spawnSync(
      'bb',
      ['-e', `(load-file ${JSON.stringify(CHASE_LIB)}) (print (chase-sweep-lib/actively-processing? (slurp ${JSON.stringify(ctx.fixturePath)})))`],
      { encoding: 'utf8', timeout: 60000 }
    );
    assert.equal(res.status, 0, `classifier run failed: ${res.stderr}`);
    ctx.verdict = res.stdout.trim();
    assert.ok(ctx.verdict === 'true' || ctx.verdict === 'false', `non-boolean verdict: ${res.stdout}`);
  });

  scoped(/^the busy classification is (\S+)$/, (ctx, token) => {
    if (!KNOWN_BUSY.has(token)) {
      throw new Error(`unknown <busy> token: ${token}`);
    }
    assert.equal(ctx.verdict, token, `fixture ${path.basename(ctx.fixturePath)} classified ${ctx.verdict}, expected ${token}`);
  });
}

module.exports = { registerSteps };
