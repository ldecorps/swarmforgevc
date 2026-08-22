'use strict';

// BL-1025: step handlers for "work an expedite run's own QA hat approved is
// not reported as having bypassed QA". Every row drives the REAL
// babysitter_check.bb sweep over a real, disposable git fixture - never a
// reimplementation of the check, and never the shared predicate in
// isolation, because the thing the ticket is about is what the SWEEP
// reports.
//
// The fixture pins swarmforge-QA to an UNRELATED root commit for the
// not-merged-by-live-QA rows, so ancestry can only ever answer "no" there and
// the expedite verdict on file is the only thing that can approve. (Pointing
// it at main instead makes every row pass without the record being read at
// all - measured, on this file's own first draft of its sibling shell test.)
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { reap } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "work an expedite run's own QA hat approved is not reported as having bypassed QA";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');

// A path inside the QA-exclusive set (check_pipeline_code_on_main.sh
// --list-paths is its one definition; this is literal EXAMPLE fixture data,
// not a second copy of the set).
const QA_EXCLUSIVE_FILE = path.join('specs', 'pipeline', 'steps', 'bl1025Fixture.js');

// Explicit known values per the Scenario Outline handler rule: the closed set
// each Examples column actually uses. A row these handlers do not know is a
// hard failure, never a passthrough.
const KNOWN_LIVE_QA = new Set(['was', 'was not']);
const KNOWN_VERDICTS = new Set(['approving', 'bouncing', 'absent', 'unreadable']);
const KNOWN_MESSAGES = new Set(['says nothing about', 'claims it came from']);
const KNOWN_OUTCOMES = new Set(['reports', 'does not report']);

const SUBJECTS = {
  'says nothing about': 'ordinary pipeline work',
  'claims it came from': 'BL-999: landed via an expedite run, approved by its QA hat',
};

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    // Restore any permission we removed, or the rmSync below cannot finish.
    const store = path.join(root, '.swarmforge', 'expedite-approvals');
    try {
      for (const f of fs.readdirSync(store)) {
        fs.chmodSync(path.join(store, f), 0o644);
      }
    } catch {
      // No store, or already readable - nothing to restore.
    }
    reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

function mkFixtureRepo() {
  const root = mkSocketFixtureRoot('sfvc-bl1025-');
  trackedRoots.push(root);
  fs.writeFileSync(path.join(root, 'README.md'), 'init\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function commitQaExclusive(root, subject) {
  const full = path.join(root, QA_EXCLUSIVE_FILE);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `// ${subject}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', subject]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

// An empty-tree, parentless commit: it shares no history with anything, so a
// swarmforge-QA pinned here can never make the commit under test an ancestor.
function unrelatedRoot(root) {
  const emptyTree = execFileSync('git', ['hash-object', '-t', 'tree', '/dev/null'], { cwd: root, encoding: 'utf8' }).trim();
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit-tree', emptyTree, '-m', 'unrelated qa root'], {
    cwd: root,
    encoding: 'utf8',
    input: '',
  }).trim();
}

function writeExpediteVerdict(root, sha, verdict) {
  const dir = path.join(root, '.swarmforge', 'expedite-approvals');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '2026-08.jsonl');
  const record = { at: '2026-08-22T00:00:00Z', ticket: 'BL-1025', stage: 'QA', verdict, commit: sha.slice(0, 10) };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

function runSweep(root) {
  try {
    return { exitCode: 0, output: execFileSync('bb', [BABYSITTER_CHECK, root], { encoding: 'utf8' }) };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a commit touching a QA-exclusive path that has landed on main$/, (ctx) => {
    ctx.root = mkFixtureRepo();
  });

  scoped(/^the commit (was not|was) merged by a live QA agent$/, (ctx, liveQa) => {
    assert.ok(KNOWN_LIVE_QA.has(liveQa), `unknown live-qa value "${liveQa}" - the handlers know ${[...KNOWN_LIVE_QA]}`);
    ctx.liveQa = liveQa === 'was';
  });

  scoped(/^the expedite QA-hat verdict on file for the commit is (approving|bouncing|absent|unreadable)$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict "${verdict}" - the handlers know ${[...KNOWN_VERDICTS]}`);
    ctx.expediteVerdict = verdict;
  });

  // The last Given: every fact is now known, so the fixture is built here in
  // one place rather than in three steps that each half-know the shape.
  scoped(/^the commit message (says nothing about|claims it came from) an expedite run$/, (ctx, message) => {
    assert.ok(KNOWN_MESSAGES.has(message), `unknown commit-message shape "${message}" - the handlers know ${[...KNOWN_MESSAGES]}`);
    ctx.sha = commitQaExclusive(ctx.root, SUBJECTS[message]);

    // swarmforge-QA: the commit itself when a live QA agent merged it,
    // an unrelated root otherwise.
    git(ctx.root, ['branch', '-f', 'swarmforge-QA', ctx.liveQa ? ctx.sha : unrelatedRoot(ctx.root)]);

    if (ctx.expediteVerdict === 'approving' || ctx.expediteVerdict === 'bouncing') {
      writeExpediteVerdict(ctx.root, ctx.sha, ctx.expediteVerdict === 'approving' ? 'pass' : 'bounce');
    } else if (ctx.expediteVerdict === 'unreadable') {
      // A store that EXISTS and cannot be consulted - the fail-closed row.
      const file = writeExpediteVerdict(ctx.root, ctx.sha, 'pass');
      fs.chmodSync(file, 0o000);
      ctx.unreadableStore = file;
    }
  });

  scoped(/^the Article 4\.2 pipeline-code-on-main check sweeps main$/, (ctx) => {
    ctx.sweep = runSweep(ctx.root);
  });

  scoped(/^the check (reports|does not report) the commit as landed outside QA$/, (ctx, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome "${outcome}" - the handlers know ${[...KNOWN_OUTCOMES]}`);
    if (ctx.unreadableStore) {
      // Running as root defeats chmod 000; a row that cannot be produced
      // must say so rather than pass on an unbuilt fixture.
      assert.ok(!fs.existsSync(ctx.unreadableStore) || !isReadable(ctx.unreadableStore), 'the unreadable-store row needs a genuinely unreadable file');
    }
    const short = ctx.sha.slice(0, 10);
    const named = ctx.sweep.output.includes(short) || ctx.sweep.output.includes(ctx.sha.slice(0, 7));
    const failedClosed = /UNAVAILABLE \[pipeline-code-on-main\]/.test(ctx.sweep.output);

    if (outcome === 'does not report') {
      assert.ok(!named, `the sweep must NOT name ${short}:\n${ctx.sweep.output}`);
      assert.ok(!failedClosed, `a clean row must not fail closed either - that is a different bug wearing the same silence:\n${ctx.sweep.output}`);
      return;
    }

    // An undeterminable verdict does not name the commit: the sweep collapses
    // the WHOLE pipeline-code-on-main check to one UNAVAILABLE line and
    // reports that instead. Pre-existing and not this ticket's to change -
    // measured 2026-08-22, an unreadable BOUNCE store (untouched by BL-1025)
    // produces the byte-identical line. What the feature's header demands of
    // this row is that it REPORT rather than go quiet, and a fail-closed
    // UNAVAILABLE is a report: nothing was waved through.
    if (ctx.unreadableStore) {
      assert.ok(failedClosed, `an unreadable verdict store must fail the check CLOSED, never read as clean:\n${ctx.sweep.output}`);
      return;
    }
    assert.ok(named, `the sweep must name ${short} as landed outside QA:\n${ctx.sweep.output}`);
  });
}

function isReadable(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = { registerSteps };
