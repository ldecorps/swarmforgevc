'use strict';

const assert = require('node:assert/strict');
const {
  main,
  readTree,
  checkFeatureHandlerRegistration,
} = require('../out/tools/check-feature-handler-registration');

// BL-1303: the CLI is a thin wrapper over the pure assessor (engineering.prompt,
// "CLI main() is a thin wrapper over exported, testable helpers, called
// in-process with stubbed IO"). These cases drive it in-process through an
// injected CheckIo - no process.chdir, no *_FORCE_RESULT bypass.

const STEPS = 'specs/pipeline/steps';

function io(files) {
  const paths = Object.keys(files);
  const written = [];
  const listDir = (dir) =>
    paths
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map((p) => p.slice(dir.length + 1));
  // BL-1400: the recursive listing readTree needs to see a handler placed in
  // a subdirectory - the placement the discovery predicate has always
  // rejected but the flat tree never showed it.
  const listTree = (dir) => paths.filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
  return {
    written,
    listDir,
    listTree,
    readFile: (p) => (p in files ? files[p] : null),
    write: (text) => written.push(text),
  };
}

test('readTree lists only the features, step files and libs the assessor is about', () => {
  const tree = readTree(
    io({
      'specs/features/BL-1-one.feature': 'Feature: one',
      'specs/features/BL-2-two.feature.draft': 'parked',
      [`${STEPS}/index.js`]: 'const DOMAINS = [];',
      [`${STEPS}/notes.md`]: '# not a handler',
      [`${STEPS}/lib/bl1Cli.sh`]: '#!/usr/bin/env bash',
    })
  );
  assert.deepEqual(tree.featureFiles, ['specs/features/BL-1-one.feature']);
  assert.deepEqual(tree.stepFiles, [`${STEPS}/index.js`]);
  assert.deepEqual(tree.libFiles, [`${STEPS}/lib/bl1Cli.sh`]);
});

test('a clean tree exits 0 and writes nothing', () => {
  const deps = io({
    'specs/features/BL-1-one.feature': 'Feature: one',
    [`${STEPS}/index.js`]: "const DOMAINS = [require('./bl1OneSteps')];",
    [`${STEPS}/bl1OneSteps.js`]: 'module.exports = {};',
  });
  assert.equal(checkFeatureHandlerRegistration(deps), 0);
  assert.deepEqual(deps.written, []);
});

// BL-1371: a `*Steps.js` file at the top of the steps directory is registered
// by existing, so the offender the guard still refuses is a handler discovery
// cannot reach - here one named outside that predicate.
test('an offending tree exits 1 and writes the refusal naming the offender', () => {
  const deps = io({
    'specs/features/BL-1253-dead-feeder.feature': 'Feature: dead feeder',
    [`${STEPS}/index.js`]: 'const DOMAINS = [];',
    [`${STEPS}/bl1253DeadFeederHandler.js`]: 'module.exports = {};',
  });
  assert.equal(checkFeatureHandlerRegistration(deps), 1);
  const text = deps.written.join('');
  assert.match(text, /unregistered handler/);
  assert.match(text, /bl1253DeadFeederHandler\.js/);
  assert.match(text, /specs\/features\/BL-1253-dead-feeder\.feature/);
});

test('an unreadable registry exits 1 rather than passing silently', () => {
  const deps = io({ 'specs/features/BL-1-one.feature': 'Feature: one' });
  assert.equal(checkFeatureHandlerRegistration(deps), 1);
  assert.match(deps.written.join(''), /unreadable step registry/);
});

test('main with no repo root exits 2 without deciding anything', () => {
  let made = 0;
  assert.equal(
    main([], () => {
      made += 1;
      return io({});
    }),
    2
  );
  assert.equal(made, 0, 'a usage error must not go on to read a tree');
});

test('main passes its repo-root argument to the io factory and returns its status', () => {
  const seen = [];
  const status = main(['/some/repo'], (root) => {
    seen.push(root);
    return io({
      'specs/features/BL-1-one.feature': 'Feature: one',
      [`${STEPS}/index.js`]: 'const DOMAINS = [];',
      [`${STEPS}/bl1OneHandler.js`]: 'module.exports = {};',
    });
  });
  assert.deepEqual(seen, ['/some/repo']);
  assert.equal(status, 1);
});


// BL-1400: the guard's predicate rejects a subdirectory placement and its own
// header promises such a handler is "still refused" - but readTree listed the
// steps directory FLAT, so a nested handler never entered the tree at all and
// the feature passed for want of seeing it.

test('readTree lists a handler nested in a subdirectory of the steps directory', () => {
  const tree = readTree(
    io({
      'specs/features/BL-9009-x.feature': 'Feature: x',
      [`${STEPS}/index.js`]: 'const DOMAINS = [];',
      [`${STEPS}/nested/bl9009XSteps.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(tree.stepFiles, [`${STEPS}/index.js`, `${STEPS}/nested/bl9009XSteps.js`]);
});

test('readTree keeps lib files out of the step files - a helper is not a handler', () => {
  const tree = readTree(
    io({
      [`${STEPS}/index.js`]: 'const DOMAINS = [];',
      [`${STEPS}/lib/bl9009Helper.js`]: 'module.exports = {};',
      [`${STEPS}/lib/deep/bl9009Deeper.js`]: 'module.exports = {};',
    })
  );
  assert.deepEqual(tree.stepFiles, [`${STEPS}/index.js`]);
  assert.deepEqual(tree.libFiles.sort(), [`${STEPS}/lib/bl9009Helper.js`, `${STEPS}/lib/deep/bl9009Deeper.js`]);
});

test('a feature whose only handler is nested is refused, naming the handler and the feature', () => {
  const deps = io({
    'specs/features/BL-9009-x.feature': 'Feature: x',
    [`${STEPS}/index.js`]: 'const DOMAINS = [];',
    [`${STEPS}/nested/bl9009XSteps.js`]: 'module.exports = {};',
  });
  assert.equal(checkFeatureHandlerRegistration(deps), 1);
  const refusal = deps.written.join('');
  assert.match(refusal, /nested\/bl9009XSteps\.js/);
  assert.match(refusal, /BL-9009-x\.feature/);
});

test('the same handler at the top of the steps directory passes', () => {
  const deps = io({
    'specs/features/BL-9009-x.feature': 'Feature: x',
    [`${STEPS}/index.js`]: 'const DOMAINS = [];',
    [`${STEPS}/bl9009XSteps.js`]: 'module.exports = {};',
  });
  assert.equal(checkFeatureHandlerRegistration(deps), 0);
  assert.deepEqual(deps.written, []);
});

for (const [relation, registry] of [
  ['a top-level handler requires', "const helper = require('./lib/bl9009Helper');"],
  ['no handler requires', ''],
]) {
  test(`a lib helper ${relation} it is never reported as an unregistered handler`, () => {
    const deps = io({
      'specs/features/BL-9009-x.feature': 'Feature: x',
      [`${STEPS}/index.js`]: 'const DOMAINS = [];',
      [`${STEPS}/bl9009XSteps.js`]: `${registry}\nmodule.exports = {};`,
      [`${STEPS}/lib/bl9009Helper.js`]: 'module.exports = {};',
    });
    assert.equal(checkFeatureHandlerRegistration(deps), 0);
    assert.deepEqual(deps.written, []);
  });
}
