'use strict';

// BL-1341's DECLARED invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant  No merge commit lands a tree missing a path that EITHER
//              parent contained, unless the commit message names the ticket
//              that path belongs to.
//
// Drives the REAL swarmforge/scripts/check_merge_deletion.sh against real git
// fixtures - never a JavaScript restatement of the predicate.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). "Either
// parent" is the whole point, and the direction that was blind is the
// INCOMING one - a path the receiving branch never had. A generator that only
// varied which files exist would reach that side by luck. So the SIDE a path
// lives on is drawn explicitly, and the run FAILS unless it reached all three
// - receiving-only, incoming-only, and both - plus both message outcomes.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_merge_deletion.sh');
const FIXTURE_PREFIX = 'bl1341-property-';
const TICKET = 'BL-0341';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function writeCommit(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

// Builds a merge in progress whose resolution has dropped `rel`, with the
// path living on the side the case names.
function fixtureWithDroppedPath(side, rel) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  const seed = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  if (side === 'both') {
    writeCommit(root, rel, 'shared\n', `${TICKET}: a path both sides carry`);
  }
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  git(root, 'checkout', '-q', '-b', 'incoming', base);
  if (side === 'incoming') {
    writeCommit(root, rel, 'incoming only\n', `${TICKET}: work only the incoming branch carries`);
  } else {
    writeCommit(root, 'incoming-note.txt', 'incoming\n', 'BL-0342: unrelated incoming work');
  }
  const incomingTip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  git(root, 'checkout', '-q', '-b', 'receiving', base);
  if (side === 'receiving') {
    writeCommit(root, rel, 'receiving only\n', `${TICKET}: work only the receiving branch carries`);
  } else {
    writeCommit(root, 'receiving-note.txt', 'receiving\n', 'BL-0343: unrelated receiving work');
  }

  spawnSync('git', ['merge', '--no-ff', '--no-commit', incomingTip], { cwd: root, encoding: 'utf8' });
  // The hand resolution that loses the path.
  spawnSync('git', ['rm', '-q', '-f', rel], { cwd: root, encoding: 'utf8' });
  return { root, seed };
}

function runGuard(root, message) {
  const msgFile = path.join(root, '..', `bl1341-msg-${process.pid}-${Math.random()}.txt`);
  fs.writeFileSync(msgFile, message);
  const r = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  fs.rmSync(msgFile, { force: true });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const caseArb = fc.record({
  side: fc.constantFrom('receiving', 'incoming', 'both'),
  names: fc.boolean(),
  rel: fc.constantFrom(
    'specs/pipeline/steps/bl0341ExampleSteps.js',
    'swarmforge/scripts/bl0341_example_lib.bb',
    'docs/how-to/BL-0341-example.md',
  ),
});

test('BL-1341/BL-654 invariant: a merge dropping a path EITHER parent carried is refused unless the message names its ticket', () => {
  const reach = { receiving: 0, incoming: 0, both: 0, named: 0, unnamed: 0 };

  // Each side gets its own property run, so "did we test the blind
  // direction" is settled by construction rather than by a lucky draw.
  for (const side of ['receiving', 'incoming', 'both']) {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { root } = fixtureWithDroppedPath(side, c.rel);
        try {
          reach[side] += 1;
          if (c.names) reach.named += 1;
          else reach.unnamed += 1;

          const message = c.names ? `${TICKET}: dropping it deliberately` : 'merge, saying nothing';
          const { status, out } = runGuard(root, message);

          if (c.names) {
            assert.equal(status, 0, `naming the ticket must exempt the removal:\n${out}`);
          } else {
            assert.notEqual(status, 0, `a ${side}-side drop was waved through:\n${out}`);
            assert.ok(out.includes(c.rel), `the refusal does not name the dropped path:\n${out}`);
            assert.ok(out.includes(TICKET), `the refusal does not name the ticket:\n${out}`);
            // One finding per path, whichever side(s) it came from.
            const mentions = out.split('\n').filter((l) => l.includes(c.rel)).length;
            assert.equal(mentions, 1, `the path is reported ${mentions} times, not once:\n${out}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 6 },
    );
  }

  assert.ok(reach.receiving > 0, 'never exercised a receiving-only drop');
  assert.ok(reach.incoming > 0, 'never exercised an incoming-only drop - the blind direction went untested');
  assert.ok(reach.both > 0, 'never exercised a path both sides carried');
  assert.ok(reach.named > 0, 'never exercised the name-it-to-mean-it exemption');
  assert.ok(reach.unnamed > 0, 'never exercised an unaccounted removal');
});
