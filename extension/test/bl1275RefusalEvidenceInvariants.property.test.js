'use strict';

// BL-1275 declared invariants:
//
// 1. A refusal that names a failing property file also leaves that run's
//    full suite output at a durable path, and names that path in the
//    refusal.
// 2. Nothing the guard retains ever becomes a commitable artifact: a
//    refused commit leaves the tracked working tree exactly as it found it.
//
// Both drive the REAL swarmforge/scripts/check_property_suite_drift.sh in a
// REAL scratch git repository, through its documented positional
// suite-command seam. A faked guard could not exhibit the defect this
// ticket fixes, which lives entirely in what the script does with its own
// temp file on the way out.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const RETAIN_REL = path.join('.swarmforge', 'property-guard-refusals');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
  }).trim();
}

// `ignoresSwarmforge` is the whole point of invariant 2's second face: the
// real checkout gitignores .swarmforge/, and retention must not rest on
// that happening to be true of whatever tree the guard runs in.
function initRepo(root, ignoresSwarmforge) {
  fs.mkdirSync(path.join(root, 'extension', 'src'), { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@test');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'commit.gpgsign', 'false');
  if (ignoresSwarmforge) {
    fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
    git(root, 'add', '.gitignore');
  }
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'seed');
  fs.writeFileSync(path.join(root, 'extension', 'src', 'board.ts'), 'v1\n');
  git(root, 'add', 'extension/src/board.ts');
}

// The injected suite writes exactly `body` and exits `code` - the script's
// own `[suite-command [args...]]` seam, never an env bypass.
function runGuard(root, body, code, keep) {
  const env = { ...process.env };
  delete env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
  if (keep !== undefined) env.SWARMFORGE_PROPERTY_GUARD_REFUSAL_KEEP = String(keep);
  const result = spawnSync(
    'bash',
    [GUARD, 'bash', '-c', 'printf "%s\\n" "$0"; exit ' + code, body],
    { cwd: root, encoding: 'utf8', env }
  );
  return { out: `${result.stdout || ''}${result.stderr || ''}`, rc: result.status ?? 1 };
}

function retainedLogs(root) {
  const dir = path.join(root, RETAIN_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^refusal-\d+-.*\.log$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ── generators ───────────────────────────────────────────────────────────
//
// The output shapes that matter are the ones a real suite produces: several
// FAIL lines naming different property files, bodies long enough that a
// "keep the scrollback" habit loses them (the 53KB properties.log of
// 2026-08-22), and single-line reds. `padKb` is what reaches the large end
// deliberately rather than by luck - an arbitrary string generator almost
// never draws kilobytes.
const failLineArb = fc
  .tuple(
    fc.integer({ min: 1, max: 9999 }),
    fc.stringMatching(/^[a-zA-Z0-9 .:_-]{1,60}$/)
  )
  .map(([n, detail]) => `FAIL extension/test/bl1275gen${n}.property.test.js > ${detail}`);

const suiteOutputArb = fc
  .tuple(fc.array(failLineArb, { minLength: 1, maxLength: 4 }), fc.integer({ min: 0, max: 60 }))
  .map(([lines, padKb]) => {
    const pad = padKb > 0 ? `\n${'x'.repeat(padKb * 1024)}` : '';
    return `${lines.join('\n')}${pad}`;
  });

test('property (invariant 1): a refusal retains this run\'s full output and names where', () => {
  const seen = { large: 0, multiLine: 0, singleLine: 0 };
  fc.assert(
    fc.property(suiteOutputArb, (body) => {
      if (body.length > 16 * 1024) seen.large += 1;
      if (body.includes('\n')) seen.multiLine += 1;
      else seen.singleLine += 1;

      withRoot('sfvc-bl1275-inv1-', (root) => {
        initRepo(root, true);
        const { out, rc } = runGuard(root, body, 1);

        assert.notEqual(rc, 0, `a non-allowlisted red must refuse:\n${out}`);

        const named = /retained at (\S+)/.exec(out);
        assert.ok(named, `the refusal named no retained-output path:\n${out}`);

        const namedPath = named[1];
        assert.ok(path.isAbsolute(namedPath), `the named path must be usable from anywhere: ${namedPath}`);
        assert.ok(fs.existsSync(namedPath), `the refusal named ${namedPath} but nothing is there`);

        // FULL output, not a head/tail of it: the failing assertion's own
        // body line is what an adjudication turns on, and it can be
        // anywhere in the run.
        const retained = fs.readFileSync(namedPath, 'utf8');
        assert.equal(retained.trimEnd(), body.trimEnd(), 'the retained file is not this run\'s own full output');
      });
    }),
    { numRuns: 12 }
  );

  // Reachability floor - asserted, never hoped for. Without it a generator
  // that only ever drew short single-line bodies would pass this property
  // while never once exercising the case the ticket was filed about.
  assert.ok(seen.large >= 1, `generator never reached a large (>16KB) suite output: ${JSON.stringify(seen)}`);
  assert.ok(seen.multiLine >= 1, `generator never reached a multi-line suite output: ${JSON.stringify(seen)}`);
});

test('property (invariant 2): nothing retained is ever commitable, over any number of refusals', () => {
  const seen = { overBound: 0, underBound: 0, withoutIgnoreRule: 0 };
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 6 }),
      fc.integer({ min: 2, max: 4 }),
      fc.boolean(),
      (refusals, keep, ignoresSwarmforge) => {
        if (refusals > keep) seen.overBound += 1;
        else seen.underBound += 1;
        if (!ignoresSwarmforge) seen.withoutIgnoreRule += 1;

        withRoot('sfvc-bl1275-inv2-', (root) => {
          initRepo(root, ignoresSwarmforge);
          const before = git(root, 'status', '--porcelain');

          for (let i = 1; i <= refusals; i += 1) {
            runGuard(root, `FAIL extension/test/bl1275seq${i}.property.test.js > run ${i}`, 1, keep);
          }

          assert.ok(retainedLogs(root).length > 0, 'a refusal retained nothing at all');
          assert.equal(
            git(root, 'status', '--porcelain'),
            before,
            'retention changed what git sees in the working tree'
          );

          // The teeth: `git add -A` is the way a retained log would
          // actually reach a commit, and it must find nothing to add
          // whether or not this tree carries a .swarmforge/ ignore rule.
          git(root, 'add', '-A');
          assert.equal(
            git(root, 'status', '--porcelain'),
            before,
            'a retained log was stageable by git add -A'
          );

          // Bounded, so the directory cannot grow without limit.
          assert.ok(
            retainedLogs(root).length <= keep,
            `retention exceeded its bound: ${retainedLogs(root).length} > ${keep}`
          );
        });
      }
    ),
    { numRuns: 10 }
  );

  assert.ok(seen.overBound >= 1, `generator never exceeded the retention bound: ${JSON.stringify(seen)}`);
  assert.ok(seen.underBound >= 1, `generator never stayed under the bound: ${JSON.stringify(seen)}`);
  assert.ok(
    seen.withoutIgnoreRule >= 1,
    `generator never reached a tree lacking the .swarmforge/ ignore rule: ${JSON.stringify(seen)}`
  );
});
