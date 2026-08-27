'use strict';

// BL-962: step handlers for "on-main sweep adjudicates reconciliation
// merges against QA-approved parents". Drives the REAL
// swarmforge/scripts/babysitter_check.bb over disposable scratch git
// fixtures (main + swarmforge-QA branches, the BL-631 harness shape) with
// the QA-exclusive path set stubbed through the established
// BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT seam and - scenario 05 only - the
// ancestry predicate substituted through BABYSITTER_QA_ANCESTOR_SCRIPT,
// failing selectively for one sha while delegating everything else to the
// real is_qa_ancestor.sh. Never a reimplementation of the gatherer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { reap } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');
const IS_QA_ANCESTOR = path.join(SCRIPTS, 'is_qa_ancestor.sh');

const FEATURE = 'BL-962 on-main sweep adjudicates reconciliation merges against QA-approved parents';

// The only path literals these scenarios use - every quoted <path> from the
// feature is validated against this set and throws on anything else, the
// same explicit-lookup discipline the Outline rule requires (never a bare
// passthrough). Fixture data, not a second QA-exclusive path definition.
const KNOWN_PATHS = new Set([
  'extension/src/landed.ts',
  'extension/src/rider.ts',
  'extension/src/side.ts',
  'extension/src/direct.ts',
]);

function knownPath(token) {
  if (!KNOWN_PATHS.has(token)) throw new Error(`unknown <path> token: ${token}`);
  return token;
}

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
    const stdout = execFileSync('bb', [BABYSITTER_CHECK, root], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// babysitterd-sweep-lib/format-finding-line's own output shape.
const FINDING_LINE_RE = /^\S+ (\S+) \[([^\]]+)\] (.*)$/;

function parseFindings(output) {
  return output
    .split('\n')
    .map((line) => line.match(FINDING_LINE_RE))
    .filter(Boolean)
    .map((m) => ({ severity: m[1], key: m[2], message: m[3] }));
}

function pipelineFindings(output) {
  return parseFindings(output).filter((f) => f.key.startsWith('pipeline-code-on-main'));
}

function mergeFinding(ctx) {
  return ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.mergeSha}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a scratch git repository with branches "main" and "swarmforge-QA"$/, (ctx) => {
    ctx.root = mkTmp('sfvc-bl962-');
    fs.writeFileSync(path.join(ctx.root, 'README.md'), 'init\n');
    git(ctx.root, ['init', '-q', '-b', 'main']);
    git(ctx.root, ['add', '-A']);
    git(ctx.root, ['commit', '-q', '-m', 'init']);
    git(ctx.root, ['branch', 'swarmforge-QA']);
    fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
    ctx.extraEnv = {};
  });

  scoped(/^the QA-exclusive path set is stubbed to contain "extension\/src\/"$/, (ctx) => {
    const stubDir = mkTmp('sfvc-bl962-stub-');
    const stub = path.join(stubDir, 'stub-list-paths.sh');
    fs.writeFileSync(
      stub,
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "--list-paths" ]]; then\n  printf \'%s\\n\' "extension/src/"\n  exit 0\nfi\nexit 0\n'
    );
    fs.chmodSync(stub, 0o755);
    ctx.extraEnv.BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT = stub;
  });

  // ── Givens: the QA-landed content and the reconciliation merge ───────────
  scoped(
    /^a commit on "swarmforge-QA" adds "extension\/src\/landed\.ts" and is merged into "main" by QA$/,
    (ctx) => {
      git(ctx.root, ['checkout', '-q', 'swarmforge-QA']);
      ctx.qaTip = commitFile(ctx.root, 'extension/src/landed.ts', 'landed by QA\n', 'BL-x: landed. By QA.');
      git(ctx.root, ['checkout', '-q', 'main']);
      // QA's BL-247 landing reaches THIS checkout's main only through the
      // reconciliation merge the next step creates - exactly the live
      // da6031c60/b3ba48bfc shape (main and origin/main diverge, BL-891).
    }
  );

  scoped(
    /^"main" gains a reconciliation merge whose second parent is that QA-approved tip$/,
    (ctx) => {
      // Diverge main first (a non-QA-exclusive local commit) so the merge is
      // a genuine two-parent reconciliation, then merge the QA tip.
      commitFile(ctx.root, 'docs/local-note.md', 'local divergence\n', 'operator: local work');
      ctx.preMergeMain = git(ctx.root, ['rev-parse', 'HEAD']).trim();
      git(ctx.root, ['merge', '-q', '--no-ff', 'swarmforge-QA', '-m', "Merge remote-tracking branch 'origin/main'"]);
      ctx.mergeSha = git(ctx.root, ['rev-parse', 'HEAD']).trim();
      assert.equal(git(ctx.root, ['rev-parse', `${ctx.mergeSha}^2`]).trim(), ctx.qaTip, 'fixture sanity: parent2 must be the QA tip');
    }
  );

  scoped(
    /^the merge result for "extension\/src\/landed\.ts" is byte-identical to that parent's version$/,
    (ctx) => {
      const diff = git(ctx.root, ['diff', ctx.qaTip, ctx.mergeSha, '--', 'extension/src/landed.ts']);
      assert.equal(diff, '', 'fixture premise: the merge result must hold the QA parent content byte-identical');
    }
  );

  scoped(
    /^the merge result additionally changes "extension\/src\/rider\.ts" to content held by no parent$/,
    (ctx) => {
      // Rebuild the reconciliation merge with a rider edit folded into the
      // merge commit itself: content neither parent holds.
      git(ctx.root, ['reset', '-q', '--hard', ctx.preMergeMain]);
      git(ctx.root, ['merge', '-q', '--no-ff', '--no-commit', 'swarmforge-QA']);
      fs.mkdirSync(path.join(ctx.root, 'extension', 'src'), { recursive: true });
      fs.writeFileSync(path.join(ctx.root, 'extension/src/rider.ts'), 'fresh rider edit\n');
      git(ctx.root, ['add', '-A']);
      git(ctx.root, ['commit', '-q', '-m', "Merge remote-tracking branch 'origin/main'"]);
      ctx.mergeSha = git(ctx.root, ['rev-parse', 'HEAD']).trim();
      assert.equal(git(ctx.root, ['rev-parse', `${ctx.mergeSha}^2`]).trim(), ctx.qaTip, 'fixture sanity: parent2 must still be the QA tip');
    }
  );

  // ── Givens: non-QA parent and non-merge shapes ────────────────────────────
  scoped(
    /^a merge on "main" whose second parent is a branch tip that is not an ancestor of "swarmforge-QA"$/,
    (ctx) => {
      git(ctx.root, ['checkout', '-q', '-b', 'feature']);
      ctx.featureTip = commitFile(ctx.root, 'extension/src/side.ts', 'side work\n', 'coder: side work');
      git(ctx.root, ['checkout', '-q', 'main']);
      git(ctx.root, ['merge', '-q', '--no-ff', 'feature', '-m', "Merge remote-tracking branch 'origin/main'"]);
      ctx.mergeSha = git(ctx.root, ['rev-parse', 'HEAD']).trim();
    }
  );

  scoped(
    /^the merge result for "extension\/src\/side\.ts" is byte-identical to that second parent's version$/,
    (ctx) => {
      const diff = git(ctx.root, ['diff', ctx.featureTip, ctx.mergeSha, '--', 'extension/src/side.ts']);
      assert.equal(diff, '', 'fixture premise: the merge result must hold the side-branch content byte-identical');
    }
  );

  scoped(
    /^a non-merge commit on "main" that adds "extension\/src\/direct\.ts" and is not an ancestor of "swarmforge-QA"$/,
    (ctx) => {
      ctx.mergeSha = commitFile(ctx.root, 'extension/src/direct.ts', 'direct\n', 'coder: direct offender');
    }
  );

  // ── Given: selective ancestry failure through the predicate seam ─────────
  scoped(
    /^the ancestry predicate fails with an error during the adjudication of that merge$/,
    (ctx) => {
      // Fails (exit 2, the undeterminable contract) for exactly the merge's
      // QA-side parent - the sha only the NEW adjudication ever asks about
      // (rev-list swarmforge-QA..main never lists it) - and delegates every
      // other sha to the real predicate, so the sweep's pre-existing
      // confirmations pass and the failure surfaces INSIDE adjudication.
      const stubDir = mkTmp('sfvc-bl962-anc-stub-');
      const stub = path.join(stubDir, 'stub-ancestor.sh');
      fs.writeFileSync(
        stub,
        `#!/usr/bin/env bash\nif [[ "\${1:-}" == "${ctx.qaTip}" ]]; then\n  echo "induced ancestry failure" >&2\n  exit 2\nfi\nexec bash "${IS_QA_ANCESTOR}" "$@"\n`
      );
      fs.chmodSync(stub, 0o755);
      ctx.extraEnv.BABYSITTER_QA_ANCESTOR_SCRIPT = stub;
    }
  );

  // ── When ──────────────────────────────────────────────────────────────────
  scoped(/^the sweep gathers pipeline-code-on-main findings$/, (ctx) => {
    ctx.result = runSweep(ctx.root, ctx.extraEnv);
    ctx.findings = pipelineFindings(ctx.result.output);
  });

  // ── Thens ─────────────────────────────────────────────────────────────────
  scoped(/^the reconciliation merge commit is absent from the offending commits$/, (ctx) => {
    assert.ok(
      !mergeFinding(ctx),
      `expected NO finding for reconciliation merge ${ctx.mergeSha}, got:\n${ctx.result.output}`
    );
  });

  scoped(/^ancestry-unavailable is false$/, (ctx) => {
    assert.ok(
      !ctx.findings.some((f) => f.severity === 'UNAVAILABLE'),
      `expected no UNAVAILABLE pipeline-code-on-main finding, got:\n${ctx.result.output}`
    );
  });

  scoped(/^(?:the merge|that) commit is reported with the offending path "([^"]+)"$/, (ctx, token) => {
    const p = knownPath(token);
    const finding = mergeFinding(ctx);
    assert.ok(finding, `expected a finding for ${ctx.mergeSha}, got:\n${ctx.result.output}`);
    assert.equal(finding.severity, 'CRIT');
    assert.ok(finding.message.includes(p), `expected the finding to name ${p}, got: ${finding.message}`);
  });

  scoped(/^"extension\/src\/landed\.ts" is not among its offending paths$/, (ctx) => {
    const finding = mergeFinding(ctx);
    assert.ok(finding, 'expected the merge finding to exist for this assertion');
    assert.ok(
      !finding.message.includes('extension/src/landed.ts'),
      `expected landed.ts to be exempted from the reported paths, got: ${finding.message}`
    );
  });

  scoped(/^the gather reports ancestry-unavailable$/, (ctx) => {
    assert.ok(
      ctx.findings.some((f) => f.key === 'pipeline-code-on-main' && f.severity === 'UNAVAILABLE'),
      `expected an UNAVAILABLE pipeline-code-on-main finding, got:\n${ctx.result.output}`
    );
  });

  scoped(/^no offending commits are reported alongside it$/, (ctx) => {
    assert.ok(
      !ctx.findings.some((f) => f.key.startsWith('pipeline-code-on-main-')),
      `expected NO per-commit pipeline-code-on-main findings beside the closed sweep, got:\n${ctx.result.output}`
    );
  });
}

module.exports = { registerSteps };
