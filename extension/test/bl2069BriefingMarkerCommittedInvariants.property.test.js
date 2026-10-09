'use strict';

// BL-2069 declared invariants (coder-authored per BL-654 / coder.prompt):
//   1. "After a sweep, HEAD's docs/briefings/.sent.json lists every
//      briefing the working tree's lists."
//   2. "A sent-marker commit changes no path but docs/briefings/.sent.json."
// Runs ONLY via `npm run test:properties`.
//
// Drives the REAL briefing_email_harness.bb's "bl821" mode (commit-mode
// "real" - the real commit-sent-marker!, real git) against a fixture git
// repository standing in for the master checkout - never a
// reimplementation of send-unsent-briefings! or commit-sent-marker!.
//
// GENERATOR REACH: each draw mixes a random number (1-3) of leftover
// briefing names already marked sent in the working tree's marker but not
// yet in HEAD, with an independent coin flip each for an unrelated
// tracked-file edit and an unrelated untracked extra sitting in the
// fixture alongside them - so a bare heal and a heal surrounded by
// unrelated writer noise are both reachable in the same run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HARNESS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'briefing_email_harness.bb');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function buildFixtureRepo() {
  const root = mkSharedTmpDir('sfvc-bl2069-prop-');
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);

  // BL-1390 (this ticket's own constraint): proven isolated before any
  // further, actually-mutating git command.
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`BL-2069 fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  fs.writeFileSync(path.join(root, 'README.md'), '# fixture repo\n');
  fs.writeFileSync(path.join(root, 'docs', 'briefings', '.sent.json'), JSON.stringify({ sent: [] }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return { root, briefingsDir: path.join(root, 'docs', 'briefings') };
}

function resetToClean(root) {
  git(root, ['checkout', '-q', '--', '.']);
  git(root, ['clean', '-q', '-fdx', '--', 'docs']);
}

function headSentSet(root) {
  const committed = git(root, ['show', 'HEAD:docs/briefings/.sent.json']);
  return JSON.parse(committed).sent || [];
}

function runSweep(briefingsDir) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, 'bl821', 'none', 'real', 'success'], { encoding: 'utf8' });
  return JSON.parse(out);
}

const leftoverNameArb = fc.integer({ min: 1, max: 28 }).map((d) => `2020-01-${String(d).padStart(2, '0')}.md`);

const draws = fc.record({
  leftovers: fc.uniqueArray(leftoverNameArb, { minLength: 1, maxLength: 3 }),
  editUnrelated: fc.boolean(),
  untrackedExtra: fc.boolean(),
});

test("BL-2069 invariant 1: a sweep's HEAD marker lists every briefing the working tree's marker lists", () => {
  const fixture = buildFixtureRepo();
  let reached = 0;

  fc.assert(
    fc.property(draws, ({ leftovers }) => {
      reached += 1;
      resetToClean(fixture.root);
      fs.writeFileSync(path.join(fixture.briefingsDir, '.sent.json'), JSON.stringify({ sent: leftovers }));

      runSweep(fixture.briefingsDir);

      const headSent = headSentSet(fixture.root);
      for (const name of leftovers) {
        assert.ok(headSent.includes(name), `expected HEAD's marker to list ${name}, got ${JSON.stringify(headSent)}`);
      }
    }),
    { numRuns: 10 }
  );

  assert.ok(reached >= 10, `generator reach floor: reached=${reached}`);
});

test('BL-2069 invariant 2: a sent-marker commit changes no path but the sent marker', () => {
  const fixture = buildFixtureRepo();
  let reached = 0;
  let contaminatedRuns = 0;

  fc.assert(
    fc.property(draws, ({ leftovers, editUnrelated, untrackedExtra }) => {
      reached += 1;
      resetToClean(fixture.root);
      fs.writeFileSync(path.join(fixture.briefingsDir, '.sent.json'), JSON.stringify({ sent: leftovers }));
      if (editUnrelated) {
        fs.writeFileSync(path.join(fixture.root, 'README.md'), `# fixture repo\nedited ${Math.random()}\n`);
      }
      if (untrackedExtra) {
        fs.writeFileSync(path.join(fixture.briefingsDir, 'extra-unrelated.txt'), 'noise\n');
      }
      if (editUnrelated || untrackedExtra) {
        contaminatedRuns += 1;
      }

      runSweep(fixture.briefingsDir);

      const stat = git(fixture.root, ['show', '--stat', '-1', '--format=', 'HEAD']);
      assert.ok(stat.includes('docs/briefings/.sent.json'), `expected the commit to touch the marker, got: ${stat}`);
      assert.ok(!stat.includes('README.md'), `expected the commit to NOT touch README.md, got: ${stat}`);
      assert.ok(
        !stat.includes('extra-unrelated.txt'),
        `expected the commit to NOT touch the unrelated untracked extra, got: ${stat}`
      );
    }),
    { numRuns: 10 }
  );

  assert.ok(reached >= 10, `generator reach floor: reached=${reached}`);
  assert.ok(contaminatedRuns >= 3, `generator reach floor: contaminatedRuns=${contaminatedRuns}/${reached}`);
});
