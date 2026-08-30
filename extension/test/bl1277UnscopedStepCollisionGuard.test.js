'use strict';

// BL-1277: specs/pipeline/stepRegistry.js resolves an UNSCOPED registration by
// first-match across every handler file, so two step files registering the
// same pattern make the earlier-loading one answer that step text for BOTH
// features - the loser's scenarios run the winner's handler against the
// winner's fixture, and the acceptance run reports an ordinary pass or fail.
// This guard refuses the next such duplicate. It is discovered by vitest's
// `extension/test/*.test.js` glob, so `npm test` runs it with no call site.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkSharedTmpDir } = require('./helpers/tmpDir');
const {
  findUnscopedCollisions,
  formatRefusal,
  collisionVerdict,
  shippedCollisionVerdict,
} = require('./helpers/stepCollisionGuard');

// A synthetic step file, written to a temp dir and loaded through the real
// module system - the guard is given exactly what it is given in production
// (a path that exports registerSteps), never a hand-built registration list.
function writeStepFile(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `'use strict';\nmodule.exports = { registerSteps(registry) {\n${body}\n} };\n`);
  return file;
}

function unscoped(text) {
  return `  registry.define(/^${text}$/, () => {});`;
}

function scopedTo(text, feature) {
  return `  registry.defineScoped(/^${text}$/, () => {}, ${JSON.stringify(feature)});`;
}

describe('BL-1277 unscoped step-pattern collision guard', () => {
  const roots = [];

  function tmpRoot() {
    const root = mkSharedTmpDir('bl1277-collision-');
    roots.push(root);
    return root;
  }

  afterEach(() => {
    while (roots.length) {
      fs.rmSync(roots.pop(), { recursive: true, force: true });
    }
  });

  it('refuses when two step files register the same step text unscoped', () => {
    const root = tmpRoot();
    const first = writeStepFile(root, 'firstSteps.js', unscoped('the widget is ready'));
    const second = writeStepFile(root, 'secondSteps.js', unscoped('the widget is ready'));

    const verdict = collisionVerdict([first, second]);

    assert.equal(verdict.ok, false);
    assert.equal(verdict.collisions.length, 1);
    assert.equal(verdict.collisions[0].pattern, '^the widget is ready$');
    assert.deepEqual(verdict.collisions[0].files, [first, second]);
  });

  it('passes when the second registration is scoped to its own feature', () => {
    const root = tmpRoot();
    const first = writeStepFile(root, 'firstSteps.js', unscoped('the widget is ready'));
    const second = writeStepFile(root, 'secondSteps.js', scopedTo('the widget is ready', 'BL-9999 second feature'));

    assert.equal(collisionVerdict([first, second]).ok, true);
  });

  it('passes when the two files register different step text', () => {
    const root = tmpRoot();
    const first = writeStepFile(root, 'firstSteps.js', unscoped('the widget is ready'));
    const second = writeStepFile(root, 'secondSteps.js', unscoped('the widget is idle'));

    assert.equal(collisionVerdict([first, second]).ok, true);
  });

  it('does not call one file registering the same text twice a collision', () => {
    const root = tmpRoot();
    const only = writeStepFile(
      root,
      'onlySteps.js',
      [unscoped('the widget is ready'), unscoped('the widget is ready')].join('\n')
    );

    assert.equal(collisionVerdict([only]).ok, true);
  });

  it('names the step text and every file that registers it', () => {
    const root = tmpRoot();
    const files = ['aSteps.js', 'bSteps.js', 'cSteps.js'].map((name) =>
      writeStepFile(root, name, unscoped('the widget is ready'))
    );

    const message = formatRefusal(findUnscopedCollisions(files));

    assert.ok(message.includes('^the widget is ready$'), message);
    for (const file of files) {
      assert.ok(message.includes(file), message);
    }
  });

  it('the shipped step files register no colliding unscoped pattern', () => {
    const verdict = shippedCollisionVerdict();

    assert.equal(verdict.message, '');
    assert.equal(verdict.ok, true);
  });
});
