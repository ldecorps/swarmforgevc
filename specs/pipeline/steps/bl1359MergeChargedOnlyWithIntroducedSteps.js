'use strict';

// BL-1359: the Article 4.2 sweep asked `git diff-tree -m --first-parent` for a
// merge. `--first-parent` is a revision-TRAVERSAL option and does nothing on a
// single named commit, so `-m` alone decided the output: one diff section per
// parent, i.e. the UNION of the diffs against every parent. A merge was
// therefore charged with content that only ever existed on a side branch.
// Measured on live history: 15dc336877 returns 54 files with the flag and 54
// without it, while its true first-parent diff is 7.
//
// Drives the REAL swarmforge/scripts/babysitter_check.bb over disposable
// scratch git fixtures, through the same established seams BL-962's scenarios
// use (BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT, BABYSITTER_QA_ANCESTOR_SCRIPT) -
// never a reimplementation of the gatherer. A stubbed git layer could not
// exhibit this defect at all: it lives entirely in which commits a git command
// draws its diff from.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { reap } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');
const IS_QA_ANCESTOR = path.join(SCRIPTS, 'is_qa_ancestor.sh');

const FEATURE = 'A merge is charged only with the pipeline paths it introduced';

// The one QA-exclusive path these scenarios use. Fixture data, never a second
// definition of the real QA-exclusive set - that is read at runtime from
// check_pipeline_code_on_main.sh --list-paths and stubbed here as BL-962 does.
const REGISTRY = 'extension/src/registry.ts';

// The Outline's own words for which git call is broken, each mapped to how the
// fixture breaks it. Explicit KNOWN_VALUES: an unrecognised row throws rather
// than passing through unchecked.
const BROKEN_CALLS = {
  'touched-path read': 'touched-path-read',
  'parent ancestry call': 'parent-ancestry',
  'parent content diff': 'parent-content-diff',
};

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function commitFile(root, relPath, content, subject) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', subject]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function runSweep(root, env) {
  try {
    return { exitCode: 0, output: execFileSync('bb', [BABYSITTER_CHECK, root], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    }) };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const FINDING_LINE_RE = /^\S+ (\S+) \[([^\]]+)\] (.*)$/;

function pipelineFindings(output) {
  return output
    .split('\n')
    .map((line) => line.match(FINDING_LINE_RE))
    .filter(Boolean)
    .map((m) => ({ severity: m[1], key: m[2], message: m[3] }))
    .filter((f) => f.key.startsWith('pipeline-code-on-main'));
}

/** Break one git object so a specific read cannot answer. */
function removeTreeOf(root, rev) {
  const tree = git(root, ['rev-parse', `${rev}^{tree}`]).trim();
  fs.rmSync(path.join(root, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(
    /^the sweep is classifying a commit that is reachable from a main ref and is not an ancestor of swarmforge-QA$/,
    (ctx) => {
      const root = mkTmp('sfvc-bl1359-');
      git(root, ['init', '-q', '-b', 'main']);
      fs.writeFileSync(path.join(root, 'README.md'), 'init\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'init']);
      git(root, ['branch', 'swarmforge-QA']);
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });

      const stubDir = mkTmp('sfvc-bl1359-stub-');
      const stub = path.join(stubDir, 'stub-list-paths.sh');
      fs.writeFileSync(
        stub,
        '#!/usr/bin/env bash\nif [[ "${1:-}" == "--list-paths" ]]; then\n  printf \'%s\\n\' "extension/src/"\n  exit 0\nfi\nexit 0\n'
      );
      fs.chmodSync(stub, 0o755);

      ctx.bl1359 = { root, extraEnv: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub } };
    }
  );

  // ── Given ───────────────────────────────────────────────────────────────
  //
  // The defect's own shape: the merge RESULT for the registry matches its
  // first parent exactly, while a side parent holds a different version. The
  // union `-m` produces therefore contains the registry; the first-parent diff
  // does not.
  scoped(
    /^a merge whose result for a QA-exclusive path is byte-identical to its first parent$/,
    (ctx) => {
      const { root } = ctx.bl1359;
      git(root, ['checkout', '-q', '-b', 'side']);
      ctx.bl1359.sideTip = commitFile(root, REGISTRY, 'side version\n', 'coder: side registry edit');
      git(root, ['checkout', '-q', 'main']);
      const firstParent = commitFile(root, REGISTRY, 'main version\n', 'operator: main registry edit');
      ctx.bl1359.firstParent = firstParent;
      // Merge, then keep MAIN's registry: the result is byte-identical to the
      // first parent for that path, so the merge introduced nothing there.
      try {
        git(root, ['merge', '-q', '--no-ff', '--no-commit', 'side']);
      } catch {
        // A conflict is expected - both sides edited the registry.
      }
      git(root, ['checkout', '--ours', '--', REGISTRY]);
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'Merge side into main']);
      ctx.bl1359.mergeSha = git(root, ['rev-parse', 'HEAD']).trim();
      assert.equal(
        git(root, ['diff', firstParent, ctx.bl1359.mergeSha, '--', REGISTRY]),
        '',
        'fixture premise: the merge result must match its FIRST parent for the registry'
      );
    }
  );

  scoped(/^a non-first parent whose version of that path differs$/, (ctx) => {
    const { root, sideTip, mergeSha } = ctx.bl1359;
    assert.notEqual(
      git(root, ['diff', sideTip, mergeSha, '--', REGISTRY]),
      '',
      'fixture premise: the non-first parent must hold a DIFFERENT version'
    );
    // And the premise that makes this scenario meaningful at all: the union
    // form the old code used DOES name the registry, so a pass here is the
    // narrowing working rather than an empty fixture.
    const union = git(root, ['diff-tree', '-m', '--first-parent', '--no-commit-id', '--name-only', '-r', mergeSha]);
    assert.ok(union.includes(REGISTRY), 'fixture premise: the old union form must have charged this path');
  });

  scoped(
    /^a merge whose result for a QA-exclusive path differs from its first parent$/,
    (ctx) => {
      const { root } = ctx.bl1359;
      git(root, ['checkout', '-q', '-b', 'side']);
      ctx.bl1359.sideTip = commitFile(root, REGISTRY, 'side version\n', 'coder: side registry edit');
      git(root, ['checkout', '-q', 'main']);
      ctx.bl1359.firstParent = commitFile(root, 'docs/local.md', 'local\n', 'operator: local work');
      git(root, ['merge', '-q', '--no-ff', 'side', '-m', 'Merge side into main']);
      ctx.bl1359.mergeSha = git(root, ['rev-parse', 'HEAD']).trim();
      assert.notEqual(
        git(root, ['diff', ctx.bl1359.firstParent, ctx.bl1359.mergeSha, '--', REGISTRY]),
        '',
        'fixture premise: the merge must genuinely introduce the registry over its first parent'
      );
      // BL-590's bug from the other side: a plain diff-tree sees nothing here,
      // so a fix that used it would go blind to the merge's own content.
      assert.equal(
        git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', ctx.bl1359.mergeSha]).trim(),
        '',
        'fixture premise: a plain diff-tree must report zero files for this merge'
      );
    }
  );

  scoped(/^no QA-approved parent holds that path byte-identically$/, (ctx) => {
    const { root, sideTip } = ctx.bl1359;
    // is_qa_ancestor.sh's own contract: 0 approved, 1 a clean "no", anything
    // else undeterminable. Asserted as exactly 1, so a fixture that made the
    // predicate UNDETERMINABLE could not masquerade as "not approved" - that
    // would be the fail-closed path, not this scenario.
    const probe = spawnSync('bash', [IS_QA_ANCESTOR, sideTip], { cwd: root, encoding: 'utf8' });
    assert.equal(
      probe.status,
      1,
      `fixture premise: the side parent must be a clean "not QA-approved", got ${probe.status}: ${probe.stderr}`
    );
  });

  scoped(/^a QA-approved non-first parent holds that path byte-identically$/, (ctx) => {
    // Rebuild the merge with swarmforge-QA as the side, so the non-first
    // parent genuinely is a QA ancestor and holds the registry identically.
    const { root } = ctx.bl1359;
    git(root, ['checkout', '-q', 'swarmforge-QA']);
    ctx.bl1359.qaTip = commitFile(root, REGISTRY, 'qa version\n', 'BL-x: landed. By QA.');
    git(root, ['checkout', '-q', 'main']);
    git(root, ['reset', '-q', '--hard', ctx.bl1359.firstParent]);
    git(root, ['merge', '-q', '--no-ff', 'swarmforge-QA', '-m', 'Merge QA into main']);
    ctx.bl1359.mergeSha = git(root, ['rev-parse', 'HEAD']).trim();
    assert.equal(
      git(root, ['diff', ctx.bl1359.qaTip, ctx.bl1359.mergeSha, '--', REGISTRY]),
      '',
      'fixture premise: the QA parent must hold the registry byte-identically'
    );
  });

  scoped(/^the (.+) cannot answer$/, (ctx, call) => {
    const kind = BROKEN_CALLS[call];
    assert.ok(kind, `unknown broken call: ${call}`);
    const { root, mergeSha, sideTip } = ctx.bl1359;
    if (kind === 'touched-path-read') {
      // The merge's first parent has no tree object, so the two-tree diff the
      // charge is computed from cannot run at all.
      removeTreeOf(root, `${mergeSha}^1`);
    } else if (kind === 'parent-ancestry') {
      const stubDir = mkTmp('sfvc-bl1359-anc-');
      const stub = path.join(stubDir, 'stub-ancestor.sh');
      fs.writeFileSync(
        stub,
        `#!/usr/bin/env bash\nif [[ "\${1:-}" == "${sideTip}" ]]; then\n  echo "induced ancestry failure" >&2\n  exit 2\nfi\nexec bash "${IS_QA_ANCESTOR}" "$@"\n`
      );
      fs.chmodSync(stub, 0o755);
      ctx.bl1359.extraEnv.BABYSITTER_QA_ANCESTOR_SCRIPT = stub;
    } else {
      // The non-first parent's tree is gone, so the per-path content diff
      // against it errors rather than answering identical/different.
      removeTreeOf(root, sideTip);
    }
  });

  scoped(/^a non-merge commit that adds a QA-exclusive path$/, (ctx) => {
    ctx.bl1359.mergeSha = commitFile(ctx.bl1359.root, REGISTRY, 'direct\n', 'coder: direct offender');
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the sweep classifies the commit$/, (ctx) => {
    ctx.bl1359.result = runSweep(ctx.bl1359.root, ctx.bl1359.extraEnv);
    ctx.bl1359.findings = pipelineFindings(ctx.bl1359.result.output);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  const findingFor = (ctx) =>
    ctx.bl1359.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.bl1359.mergeSha}`);

  scoped(/^the commit is not reported for that path$/, (ctx) => {
    const finding = findingFor(ctx);
    assert.ok(
      !finding || !finding.message.includes(REGISTRY),
      `expected ${REGISTRY} not to be charged to ${ctx.bl1359.mergeSha}, got:\n${ctx.bl1359.result.output}`
    );
  });

  scoped(/^the commit is reported for that path$/, (ctx) => {
    const finding = findingFor(ctx);
    assert.ok(finding, `expected a finding for ${ctx.bl1359.mergeSha}, got:\n${ctx.bl1359.result.output}`);
    assert.equal(finding.severity, 'CRIT');
    assert.ok(
      finding.message.includes(REGISTRY),
      `expected the finding to name ${REGISTRY}, got: ${finding.message}`
    );
  });

  scoped(/^the sweep reports that ancestry is unavailable$/, (ctx) => {
    assert.ok(
      ctx.bl1359.findings.some((f) => f.key === 'pipeline-code-on-main' && f.severity === 'UNAVAILABLE'),
      `expected an UNAVAILABLE pipeline-code-on-main finding, got:\n${ctx.bl1359.result.output}`
    );
  });

  scoped(/^no offending commit is reported$/, (ctx) => {
    assert.ok(
      !ctx.bl1359.findings.some((f) => f.key.startsWith('pipeline-code-on-main-')),
      `expected NO per-commit finding beside the closed sweep, got:\n${ctx.bl1359.result.output}`
    );
  });
}

module.exports = { registerSteps };
