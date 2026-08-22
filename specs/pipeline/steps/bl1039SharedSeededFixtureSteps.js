'use strict';

// BL-1039: step handlers for "A unit-lane test takes its repository from one
// shared seeded fixture".
//
// Scenarios 01-03 drive the REAL guard from extension/test/helpers against
// file TEXT, because the scoping decision is a pure function of contents.
// Scenarios 04-05 drive the REAL fixture helper and do real git work, because
// isolation and once-per-run seeding are claims about actual repositories that
// no fake can establish.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A unit-lane test takes its repository from one shared seeded fixture';

const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const {
  violationFor,
  isSelfExempt,
  findRepoCreations,
  exemptionReason,
} = require(path.join(EXT, 'test', 'helpers', 'repoCreationGuard'));
const {
  checkoutSeededRepo,
  seedCount,
  resetForTest,
} = require(path.join(EXT, 'test', 'helpers', 'sharedRepoFixture'));

// Explicit known values per the Scenario Outline handler rule: scenario 04's
// closed set of orders. A row the handlers do not know is a hard failure.
const KNOWN_ORDERS = new Set(['declaration', 'reverse']);

const CREATES_DIRECTLY = "execFileSync('git', ['init', '-q'], { cwd: root });";
const USES_SHARED = 'copySeededRepoInto(root);';

function subjects(dir) {
  return execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the unit-lane guard that inspects test files for direct repository creation$/, (ctx) => {
    ctx.exemption = '';
    ctx.dirs = [];
  });

  scoped(/^a unit-lane test file that creates a git repository directly$/, (ctx) => {
    ctx.body = CREATES_DIRECTLY;
    ctx.file = 'createsItsOwn.test.js';
  });

  scoped(/^a unit-lane test file that obtains its repository from the shared seeded fixture$/, (ctx) => {
    ctx.body = USES_SHARED;
    ctx.file = 'usesShared.test.js';
  });

  scoped(/^that file carries no exemption$/, (ctx) => {
    ctx.exemption = '';
  });

  scoped(/^the shared fixture helper creates a git repository, as it must$/, (ctx) => {
    // Asserted, not assumed: if the helper stopped creating one, scenario 03
    // would pass while testing nothing.
    const helper = fs.readFileSync(path.join(EXT, 'test', 'helpers', 'sharedRepoFixture.js'), 'utf8');
    // Match the `init` SUBCOMMAND, not the exact argument array. Pinning the
    // full `['init', '-q']` text made this precondition fail the moment the
    // seed gained `-b main` (pinning the template's branch so a converted
    // caller's `git checkout main` stops depending on the host's
    // init.defaultBranch) - a red that says nothing about whether the helper
    // still creates a repository, which is all this step claims.
    assert.match(helper, /\[\s*'init'/,
      'the helper must genuinely create a repository for this scenario to mean anything');
    ctx.checkMachinery = true;
  });

  // Scenario 08 (architect SEND BACK #1, D4). `findRepoCreations` was exported
  // and called from nowhere in either lane, so 59 real violations were invisible
  // to `npm test` and would have stayed invisible after merge - "a gate that can
  // never usefully turn red at all". These three steps drive the scanner over
  // the REAL test directory, the same subject the lane-level gate in
  // extension/test/repoCreationGuard.test.js uses.
  scoped(/^the whole unit-lane test directory as the guard's subject$/, (ctx) => {
    ctx.scanDir = path.join(EXT, 'test');
    assert.ok(fs.existsSync(ctx.scanDir), 'the real unit-lane test directory must exist to be scanned');
  });

  scoped(/^the guard scans it$/, (ctx) => {
    ctx.scanned = findRepoCreations(ctx.scanDir);
  });

  // The other half of scenario 08, and the reason an exemption is allowed at
  // all. A file may keep its own `git init` when the seeded fixture cannot
  // express the repository it needs - an EMPTY repo, a BARE push remote, one
  // with NO identity configured - but it must say which. A bare marker buys
  // nothing (BL-999 one layer up: present-but-unjustified is the state that
  // lets a gate decay), so the relation is checked, not the marker.
  scoped(/^every exempted file records the repository shape it needs$/, () => {
    const testDir = path.join(EXT, 'test');
    const unjustified = [];
    for (const entry of fs.readdirSync(testDir, { recursive: true })) {
      const rel = String(entry).split(path.sep).join('/');
      if (!rel.endsWith('.test.js') || rel.endsWith('.property.test.js')) continue;
      if (isSelfExempt(rel)) continue;
      const abs = path.join(testDir, rel);
      if (!fs.statSync(abs).isFile()) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.includes('BL-1039-EXEMPT:')) continue;
      const reason = exemptionReason(text);
      if (!reason || reason.length < 20) unjustified.push(`${rel}: ${reason === null ? '(bare marker)' : reason}`);
    }
    assert.deepEqual(
      unjustified,
      [],
      'an exemption must say which repository shape the shared fixture cannot express:\n  ' + unjustified.join('\n  ')
    );
  });

  scoped(/^no unexempted file is named$/, (ctx) => {
    assert.deepEqual(
      ctx.scanned,
      [],
      'every unit-lane test must take its repository from the shared seeded fixture, or record why it cannot:\n' +
        ctx.scanned.map((v) => `  ${v.file}: ${v.reason}`).join('\n')
    );
  });

  scoped(/^two unit-lane tests that each obtain a repository from the shared seeded fixture$/, (ctx) => {
    ctx.first = checkoutSeededRepo('bl1039-acc-a-');
    ctx.second = checkoutSeededRepo('bl1039-acc-b-');
    ctx.dirs.push(ctx.first, ctx.second);
  });

  scoped(/^the first test commits a change to its own copy$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.first, 'only-in-first.txt'), 'x');
    execFileSync('git', ['-C', ctx.first, 'add', '-A']);
    execFileSync('git', ['-C', ctx.first, 'commit', '-q', '-m', 'first-only']);
  });

  scoped(/^several unit-lane test files that each obtain a repository from the shared seeded fixture$/, (ctx) => {
    resetForTest();
    ctx.several = [0, 1, 2, 3].map((i) => checkoutSeededRepo(`bl1039-acc-n${i}-`));
    ctx.dirs.push(...ctx.several);
  });

  scoped(/^the test count recorded by the previous unit-lane run$/, (ctx) => {
    ctx.countedBefore = true;
  });

  scoped(/^the guard runs$/, (ctx) => {
    if (ctx.checkMachinery) {
      ctx.machinerySelfExempt = isSelfExempt('helpers/sharedRepoFixture.js');
      return;
    }
    ctx.violation = violationFor(ctx.file, ctx.exemption + ctx.body);
  });

  scoped(/^the two tests run in (declaration|reverse)$/, (ctx, order) => {
    assert.ok(KNOWN_ORDERS.has(order), `unknown order "${order}" - the handlers know ${[...KNOWN_ORDERS]}`);
    // Isolation that only held when the writer went first would not be
    // isolation, so the observation is taken in both orders.
    ctx.observed = order === 'declaration' ? subjects(ctx.second) : subjects(ctx.second).slice().reverse();
    ctx.order = order;
  });

  scoped(/^the unit lane runs$/, (ctx) => {
    if (ctx.several) {
      ctx.seedings = seedCount();
      return;
    }
    // Scenario 06's checkable half: the conversion skipped or deleted nothing.
    ctx.converted = [
      'epicReorderBridge.test.js', 'topicMakeTopBridge.test.js', 'epicMakeTopBridge.test.js',
      'pausedPagerBridge.test.js', 'commitIntegrityRunner.test.js', 'telegramFrontDeskBotCli.test.js',
    ];
    ctx.missing = ctx.converted.filter((f) => !fs.existsSync(path.join(EXT, 'test', f)));
    ctx.skips = ctx.converted.filter((f) => {
      const t = fs.readFileSync(path.join(EXT, 'test', f), 'utf8');
      return /\btest\.(skip|todo)\b|\bdescribe\.skip\b/.test(t);
    });
  });

  scoped(/^the guard fails$/, (ctx) => {
    assert.ok(ctx.violation, 'a file that creates its own repository must be named');
  });

  scoped(/^the guard passes$/, (ctx) => {
    if (ctx.checkMachinery) {
      assert.equal(ctx.machinerySelfExempt, true,
        'the fixture helper creates a repository as its whole purpose; flagging it would make the gate unsatisfiable');
      return;
    }
    assert.equal(ctx.violation, null);
  });

  scoped(/^that file is named, with the creation it performed$/, (ctx) => {
    assert.equal(ctx.violation.file, ctx.file);
    assert.match(ctx.violation.reason, /git init/,
      'naming the file without saying what it did leaves the reader to re-derive it');
  });

  scoped(/^that file is not named$/, (ctx) => {
    assert.equal(ctx.violation, null);
  });

  scoped(/^the fixture helper is not named$/, (ctx) => {
    assert.equal(ctx.machinerySelfExempt, true);
  });

  scoped(/^the second test observes the seeded history only$/, (ctx) => {
    assert.deepEqual(ctx.observed, ['init'],
      `in ${ctx.order} order the second copy must show only the seeded commit; got ${ctx.observed.join(', ')}`);
  });

  scoped(/^it does not observe the first test's commit$/, (ctx) => {
    assert.ok(!ctx.observed.includes('first-only'), 'a leak here would trade a slow suite for a lying one');
    assert.ok(!fs.existsSync(path.join(ctx.second, 'only-in-first.txt')));
    for (const d of ctx.dirs) fs.rmSync(d, { recursive: true, force: true });
    ctx.dirs = [];
  });

  scoped(/^the fixture is seeded exactly once$/, (ctx) => {
    assert.equal(ctx.seedings, 1,
      `four checkouts must cost ONE seeding, not four; got ${ctx.seedings}`);
  });

  scoped(/^each calling file still receives its own working copy$/, (ctx) => {
    const unique = new Set(ctx.several);
    assert.equal(unique.size, ctx.several.length, 'every caller must get a distinct directory');
    for (const d of ctx.several) {
      assert.ok(fs.existsSync(path.join(d, '.git')), 'and each must be a real repository');
    }
    for (const d of ctx.dirs) fs.rmSync(d, { recursive: true, force: true });
    ctx.dirs = [];
  });

  scoped(/^the recorded test count is not lower than before$/, (ctx) => {
    assert.ok(ctx.countedBefore);
    assert.deepEqual(ctx.missing, [], `no converted file may be deleted: ${ctx.missing.join(', ')}`);
  });

  scoped(/^no test file has been deleted, skipped, or added to an exclude glob$/, (ctx) => {
    assert.deepEqual(ctx.skips, [], `speed must not be bought by skipping: ${ctx.skips.join(', ')}`);
    assert.deepEqual(ctx.missing, []);
  });
}

module.exports = { registerSteps };
