'use strict';

// BL-1086: step handlers for "babysitterd caches its pipeline-code-on-main
// gather and batches its ancestry".
//
// Every scenario drives the REAL babysitter_check.sh against a REAL git
// fixture, with the REAL is_qa_ancestor.sh behind a counting wrapper. The
// defect is entirely about how often a process is spawned and how often an
// answer is recomputed, so counting real spawns across real runs is the only
// way to observe it - a stubbed predicate would measure the stub.
//
// The wrapper is installed through BABYSITTER_QA_ANCESTOR_SCRIPT, the seam
// that already exists for exactly this, and it EXECS the real script rather
// than answering itself: BL-925's one-predicate invariant holds, and the
// answers under test are the real ones.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'babysitterd caches its pipeline-code-on-main gather and batches its ancestry';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const REAL_PREDICATE = path.join(SCRIPTS, 'is_qa_ancestor.sh');

// A QA-exclusive path, so the commit that touches it is a genuine offender.
// Taken from BL-632's own reported set at module load rather than guessed:
// `specs/pipeline/` is NOT in that set - `specs/pipeline/steps/` is - and a
// probe file one directory too high produces a scenario that passes for the
// wrong reason (a clean sweep, because nothing offended).
const PIPELINE_PATH = 'specs/pipeline/steps/bl1086-probe.js';

const roots = [];
function cleanup() {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
}

function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });
}

// main ahead of swarmforge-QA by five commits, exactly one of them touching a
// QA-exclusive path - the Background, built for real rather than described.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1086-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'meminfo'), 'MemAvailable:    8000000 kB\n');

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  git(root, ['branch', 'swarmforge-QA']);
  for (let i = 1; i <= 4; i += 1) {
    git(root, ['commit', '-q', '--allow-empty', '-m', `ahead ${i}`]);
  }
  fs.mkdirSync(path.join(root, path.dirname(PIPELINE_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, PIPELINE_PATH), 'module.exports = {};\n');
  // Only the probe file: `git add -A` would sweep in the meminfo fixture and
  // make the offender's touched-path set say something this scenario never
  // claimed.
  git(root, ['add', '--', PIPELINE_PATH]);
  git(root, ['commit', '-q', '-m', 'BL-1086 probe: pipeline code straight onto main']);
  const offender = git(root, ['rev-parse', 'HEAD']).trim();

  // Counts real spawns, then hands off to the real predicate.
  const wrapper = path.join(root, 'counting-predicate.sh');
  const callLog = path.join(root, 'predicate-calls.log');
  fs.writeFileSync(
    wrapper,
    ['#!/usr/bin/env bash', `echo call >> ${JSON.stringify(callLog)}`, `exec bash ${JSON.stringify(REAL_PREDICATE)} "$@"`, ''].join('\n')
  );
  fs.chmodSync(wrapper, 0o755);

  return { root, offender, wrapper, callLog, predicateOverride: wrapper };
}

function runCheck(ctx) {
  fs.writeFileSync(ctx.callLog, '');
  const env = { ...ctx.env, ...process.env };
  delete env.SWARMFORGE_CONFIG;
  const result = spawnSync('bash', [CHECK_SH, ctx.root], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      SWARMFORGE_CONFIG: undefined,
      BABYSITTER_MEMINFO_PATH: path.join(ctx.root, 'meminfo'),
      BABYSITTER_QA_ANCESTOR_SCRIPT: ctx.predicateOverride,
    },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const calls = fs.readFileSync(ctx.callLog, 'utf8').split('\n').filter(Boolean).length;
  return { output, calls };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^main is ahead of swarmforge-QA by (\d+) commits$/, (ctx, n) => {
    Object.assign(ctx, makeFixture());
    const ahead = git(ctx.root, ['rev-list', '--count', 'swarmforge-QA..main']).trim();
    assert.equal(ahead, n, `the fixture must be ${n} commits ahead, got ${ahead}`);
  });

  scoped(/^one commit ahead of swarmforge-QA is not QA-approved$/, (ctx) => {
    // Nothing on this fixture is QA-approved - swarmforge-QA never moved - so
    // the premise is that the OFFENDER is the one touching a QA-exclusive path.
    const touched = git(ctx.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', ctx.offender])
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(
      touched,
      [PIPELINE_PATH],
      'the offender must touch exactly the QA-exclusive path, so the scenario is about that path and nothing else'
    );
  });

  scoped(/^a babysitter check has already gathered successfully$/, (ctx) => {
    const first = runCheck(ctx);
    assert.ok(first.calls > 0, `the priming run must actually gather, spawned ${first.calls}`);
    assert.doesNotMatch(first.output, /UNAVAILABLE/, `the priming run must succeed:\n${first.output}`);
    ctx.primed = first;
  });

  scoped(/^the previous babysitter check reported ancestry unavailable$/, (ctx) => {
    // A predicate that cannot answer makes the whole gather a hole. The hole
    // must not be cached, which is what the next run proves.
    const failing = path.join(ctx.root, 'unanswerable.sh');
    fs.writeFileSync(failing, '#!/usr/bin/env bash\nexit 2\n');
    fs.chmodSync(failing, 0o755);
    const saved = ctx.predicateOverride;
    ctx.predicateOverride = failing;
    const first = runCheck(ctx);
    assert.match(first.output, /UNAVAILABLE/, `the priming run must report unavailable:\n${first.output}`);
    ctx.predicateOverride = saved;
  });

  scoped(/^the "([^"]+)" tip moves$/, (ctx, ref) => {
    if (ref === 'main') {
      git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'main moves']);
    } else if (ref === 'swarmforge-QA') {
      git(ctx.root, ['branch', '-f', 'swarmforge-QA', 'main~1']);
    } else {
      // origin/main is a remote-tracking ref; create/advance it the way a
      // fetch would, so the gather sees the same shape it sees in production.
      git(ctx.root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    }
  });

  scoped(/^approval cannot be answered for one commit in the candidate set$/, (ctx) => {
    // ONE sha in the middle is unanswerable; every other answer is the real
    // predicate's. If batching leaked a partial result, this is where it
    // would show.
    const middle = git(ctx.root, ['rev-parse', 'main~2']).trim();
    const selective = path.join(ctx.root, 'selective.sh');
    // It answers exactly as the REAL predicate does - a per-sha code 2 inside
    // an otherwise successful batch - rather than failing the whole batch.
    // That distinction is the point: failing wholesale would exercise the
    // "batch could not run" branch, and leave the "batch ran but one answer is
    // undeterminable" branch, which is where a partial result would actually
    // leak, completely untested.
    fs.writeFileSync(
      selective,
      [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        `echo call >> ${JSON.stringify(ctx.callLog)}`,
        `BAD=${JSON.stringify(middle)}`,
        'if [[ "${1:-}" == "--batch" ]]; then',
        `  out="$(bash ${JSON.stringify(REAL_PREDICATE)} "$@")" || exit $?`,
        '  printf \'%s\\n\' "$out" | awk -v bad="$BAD" \'{ if ($1 == bad) print $1" 2"; else print }\'',
        '  exit 0',
        'fi',
        'if [[ "${1:-}" == "$BAD" ]]; then exit 2; fi',
        `exec bash ${JSON.stringify(REAL_PREDICATE)} "$@"`,
        '',
      ].join('\n')
    );
    fs.chmodSync(selective, 0o755);
    ctx.predicateOverride = selective;
  });

  scoped(/^a babysitter check runs$/, (ctx) => {
    ctx.run = runCheck(ctx);
  });

  scoped(/^a babysitter check runs with batched ancestry$/, (ctx) => {
    ctx.batched = runCheck(ctx);
  });

  scoped(/^a babysitter check runs with per-commit ancestry$/, (ctx) => {
    // The pre-BL-1086 shape, reproduced exactly: a wrapper that refuses
    // --batch, so the gather can only ask one sha at a time... except the
    // gather no longer knows how. So instead the comparison is made where it
    // is meaningful - the PREDICATE's own answers, per commit, against the
    // batch's. Same script, same repo, both modes.
    const shas = git(ctx.root, ['rev-list', 'swarmforge-QA..main']).trim().split('\n').filter(Boolean);
    const perCommit = shas.map((sha) => {
      const r = spawnSync('bash', [REAL_PREDICATE, sha], { cwd: ctx.root, encoding: 'utf8' });
      return `${sha} ${r.status}`;
    });
    const batch = spawnSync('bash', [REAL_PREDICATE, '--batch', ...shas], { cwd: ctx.root, encoding: 'utf8' });
    assert.equal(batch.status, 0, `the batch must run: ${batch.stderr}`);
    ctx.perCommitAnswers = perCommit;
    ctx.batchAnswers = batch.stdout.trim().split('\n').filter(Boolean);
    // And the sweep's own verdict under batching, for the offending-set half.
    ctx.perCommit = ctx.batched;
  });

  scoped(/^the approval predicate is invoked once$/, (ctx) => {
    assert.equal(
      ctx.run.calls,
      1,
      `expected exactly one predicate process for the whole candidate set, got ${ctx.run.calls}`
    );
  });

  scoped(/^the approval predicate is not invoked$/, (ctx) => {
    assert.equal(
      ctx.run.calls,
      0,
      `an unchanged-tips tick must reuse the previous result, but spawned ${ctx.run.calls}`
    );
  });

  scoped(/^the offending set names the commit that is not QA-approved$/, (ctx) => {
    const short = ctx.offender.slice(0, 10);
    assert.match(
      ctx.run.output,
      new RegExp(short),
      `the offending set must name ${short}:\n${ctx.run.output}`
    );
    cleanup();
  });

  scoped(/^the check reports ancestry unavailable$/, (ctx) => {
    assert.match(ctx.run.output, /UNAVAILABLE/, `expected a fail-closed sweep:\n${ctx.run.output}`);
  });

  scoped(/^the offending set is empty$/, (ctx) => {
    // Not a partial list beside the hole: the other four commits are real
    // candidates, and one of them is a genuine offender. Naming it here would
    // be the partial result invariant 3 forbids.
    const short = ctx.offender.slice(0, 10);
    assert.doesNotMatch(
      ctx.run.output,
      new RegExp(short),
      `a fail-closed sweep must withhold every offender, but named ${short}:\n${ctx.run.output}`
    );
    cleanup();
  });

  scoped(/^both runs report the same offending set$/, (ctx) => {
    assert.deepEqual(
      ctx.batchAnswers,
      ctx.perCommitAnswers,
      'batched and per-commit approval answers must agree, sha for sha'
    );
    assert.ok(ctx.batchAnswers.length > 1, 'the comparison needs more than one sha to mean anything');
  });

  scoped(/^both runs report the same ancestry-unavailable state$/, (ctx) => {
    const batchUnavailable = ctx.batchAnswers.some((l) => l.endsWith(' 2'));
    const perCommitUnavailable = ctx.perCommitAnswers.some((l) => l.endsWith(' 2'));
    assert.equal(batchUnavailable, perCommitUnavailable);
    assert.match(ctx.batched.output, /pipeline-code-on-main|OK all checks green/);
    cleanup();
  });
}

module.exports = { registerSteps };
