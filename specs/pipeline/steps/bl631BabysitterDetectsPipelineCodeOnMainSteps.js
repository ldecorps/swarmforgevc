'use strict';

// BL-631: step handlers for "babysitter sweep detects pipeline code
// landing on main outside the QA path". Drives the real
// swarmforge/scripts/babysitter_check.bb (--nudge included where needed)
// against real, disposable git fixture repos, and the real
// babysitterd_sweep_lib.bb decide-nudges/nudge-eligible? via small bb
// subprocess calls - never a reimplementation of any of it. The
// QA-exclusive path set is never restated as a second definition in this
// file except as literal EXAMPLE fixture data, matching the feature's own
// header note and the paths already written into the Outline's Examples
// table.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');

const FEATURE = 'babysitter sweep detects pipeline code landing on main outside the QA path';

// Every fixture root/tmux socket this file creates is tracked here and torn
// down in afterEach - regardless of which assertion throws, matching the
// bl915/bl938 precedent this session already established. A fixture-dir
// leak measured at 273 directories across repeated non-vacuity runs before
// this existed.
let trackedRoots = [];
let trackedSockets = [];

afterEach(() => {
  while (trackedSockets.length) {
    const sock = trackedSockets.pop();
    try {
      execFileSync('tmux', ['-S', sock, 'kill-server'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args, extraEnv) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function mkFixtureRepo() {
  const root = mkTmp('sfvc-bl631-');
  fs.writeFileSync(path.join(root, 'README.md'), 'init\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', 'swarmforge-QA']);
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

function runSweep(root, { nudge = false, env = {} } = {}) {
  const args = [BABYSITTER_CHECK, root];
  if (nudge) args.push('--nudge');
  try {
    const stdout = execFileSync('bb', args, { encoding: 'utf8', env: { ...process.env, ...env } });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// A REAL fake coordinator tmux pane, so --nudge reaches nudge-resident!'s
// own :nudged branch for real - the ONLY path that calls write-dedup-state!
// - rather than stopping short at :no-target. This is deliberate: scenarios
// 05/06 must exercise babysitter_check.bb's own real read-dedup-state/
// write-dedup-state! functions end to end, not a bypass, so a regression
// in either (this ticket found and fixed a real one - see the commit
// message) is actually caught here.
function addFakeCoordinatorPane(root) {
  const sock = path.join(root, 'fake.sock');
  execFileSync('tmux', [
    '-S', sock, 'new-session', '-d', '-s', 'swarmforge-coordinator',
    'bash', '-c', 'exec -a "claude --remote-control fake" sleep 999 & wait',
  ]);
  trackedSockets.push(sock);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
  return sock;
}

// Parses babysitterd-sweep-lib/format-finding-line's own output shape:
// "<ts> <SEVERITY> [<key>] <message>".
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

// Calls the REAL babysitterd-sweep-lib functions via a small bb subprocess
// - never a reimplementation of decide-nudges/nudge-eligible? in JS.
function callSweepLib(exprBuilder) {
  const expr = `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${SWEEP_LIB.replace(/\\/g, '\\\\')}")
${exprBuilder}
`;
  const out = execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
  return JSON.parse(out);
}

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough. The three QA-exclusive paths and the
// four non-exclusive ones are the SAME literals the feature file's own
// Examples table already carries - test/fixture data, not a second
// definition (the feature's own header note).
const PATH_EXAMPLES = {
  'extension/src/': { relFile: 'extension/src/foo.ts', expectFires: true },
  'extension/test/': { relFile: 'extension/test/foo.test.js', expectFires: true },
  'specs/pipeline/steps/': { relFile: 'specs/pipeline/steps/fooSteps.js', expectFires: true },
  'backlog/': { relFile: 'backlog/BL-1.yaml', expectFires: false },
  'docs/': { relFile: 'docs/readme.md', expectFires: false },
  'swarmforge/': { relFile: 'swarmforge/scripts/foo.sh', expectFires: false },
  'specs/features/': { relFile: 'specs/features/foo.feature', expectFires: false },
};

function knownPath(token) {
  if (!Object.prototype.hasOwnProperty.call(PATH_EXAMPLES, token)) {
    throw new Error(`unknown <path> token: ${token}`);
  }
  return PATH_EXAMPLES[token];
}

const OUTCOME_EXAMPLES = {
  'a critical finding': true,
  'no finding': false,
};

function knownOutcome(token) {
  if (!Object.prototype.hasOwnProperty.call(OUTCOME_EXAMPLES, token)) {
    throw new Error(`unknown <outcome> token: ${token}`);
  }
  return OUTCOME_EXAMPLES[token];
}

const REF_EXAMPLES = new Set(['main', 'origin/main']);

function knownRef(token) {
  if (!REF_EXAMPLES.has(token)) {
    throw new Error(`unknown <ref> token: ${token}`);
  }
  return token;
}

function registerSteps(registry) {
  // ── Scenario 01 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^a commit reachable from main that is not an ancestor of swarmforge-QA$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit touches only (.+)$/,
    (ctx, token) => {
      const { relFile } = knownPath(token);
      ctx.sha = commitFile(ctx.root, relFile, 'content\n', 'coder: touches ' + token);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the babysitter sweep runs$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root);
      ctx.findings = pipelineFindings(ctx.result.output);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the sweep reports (.+) for that commit$/,
    (ctx, token) => {
      const expectFires = knownOutcome(token);
      const fired = ctx.findings.some((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.equal(fired, expectFires, `expected outcome "${token}" (fires=${expectFires}) for ${ctx.sha}, got findings:\n${ctx.result.output}`);
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^that commit is a merge whose first-parent diff touches extension\/src\/$/,
    (ctx) => {
      git(ctx.root, ['checkout', '-q', '-b', 'feature']);
      commitFile(ctx.root, 'extension/src/foo.ts', 'code\n', 'coder: real feature work');
      git(ctx.root, ['checkout', '-q', 'main']);
      git(ctx.root, ['merge', 'feature', '--no-ff', '-q', '-m', 'cleaner: bad merge onto main']);
      ctx.sha = git(ctx.root, ['rev-parse', 'HEAD']).trim();
    },
    FEATURE
  );

  registry.defineScoped(
    /^a critical finding names that commit$/,
    (ctx) => {
      const finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(finding, `expected a finding naming ${ctx.sha}, got:\n${ctx.result.output}`);
      assert.equal(finding.severity, 'CRIT');
    },
    FEATURE
  );

  // ── Scenario 03/04 (shared Given) ───────────────────────────────────────
  registry.defineScoped(
    /^a critical finding was produced for an offending commit$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      ctx.sha = commitFile(ctx.root, 'extension/src/foo.ts', 'code\n', 'coder: merge BL-590 fix');
      ctx.result = runSweep(ctx.root);
      ctx.findings = pipelineFindings(ctx.result.output);
      ctx.finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(ctx.finding, `expected a finding for ${ctx.sha} in:\n${ctx.result.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the sweep's findings are assembled$/,
    () => {},
    FEATURE
  );

  registry.defineScoped(
    /^the finding carries a key, a severity of CRIT, and a message naming that commit's sha, subject and offending paths$/,
    (ctx) => {
      assert.equal(ctx.finding.key, `pipeline-code-on-main-${ctx.sha}`);
      assert.equal(ctx.finding.severity, 'CRIT');
      assert.match(ctx.finding.message, new RegExp(ctx.sha));
      assert.match(ctx.finding.message, /coder: merge BL-590 fix/);
      assert.match(ctx.finding.message, /extension\/src\/foo\.ts/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^it is nudge-eligible on the same rule as every other CRIT finding$/,
    (ctx) => {
      const eligible = callSweepLib(
        `(println (json/generate-string (babysitterd-sweep-lib/nudge-eligible? {:key "${ctx.finding.key}" :severity "${ctx.finding.severity}"})))`
      );
      assert.equal(eligible, true, `expected nudge-eligible? true for a CRIT finding, got ${eligible}`);
    },
    FEATURE
  );

  // ── Scenario 04 (Then) ───────────────────────────────────────────────────
  registry.defineScoped(
    /^the finding's key is inspected$/,
    () => {},
    FEATURE
  );

  registry.defineScoped(
    /^the key identifies that commit and no other$/,
    (ctx) => {
      assert.equal(ctx.finding.key, `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(!ctx.finding.key.endsWith('-0000000000'), 'sanity: key must not be a placeholder');
      const otherKey = `pipeline-code-on-main-${'a'.repeat(ctx.sha.length)}`;
      assert.notEqual(ctx.finding.key, otherKey, "expected the key to differ from an arbitrary other commit's key");
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────────
  // A REAL fake coordinator pane so --nudge reaches :nudged for real - the
  // ONLY branch that calls write-dedup-state! - so "nudged on the previous
  // sweep" is a genuine prior real sweep, not a hand-shaped dedup file.
  registry.defineScoped(
    /^an offending commit sha was nudged as critical on the previous sweep$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      ctx.coordinatorSock = addFakeCoordinatorPane(ctx.root);
      ctx.firstSha = commitFile(ctx.root, 'extension/src/foo.ts', 'code\n', 'coder: first offender');
      const first = runSweep(ctx.root, { nudge: true });
      assert.match(first.output, /NUDGED coordinator/, `expected the first sweep to genuinely nudge, got:\n${first.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit is still reachable from main$/,
    () => {
      // No-op: the fixture never removes the first commit - it stays on main.
    },
    FEATURE
  );

  registry.defineScoped(
    /^the babysitter sweep runs again$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root, { nudge: true });
      ctx.findings = pipelineFindings(ctx.result.output);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the finding is produced again$/,
    (ctx) => {
      assert.ok(
        ctx.findings.some((f) => f.key === `pipeline-code-on-main-${ctx.firstSha}`),
        `expected the finding to be recomputed and reported again, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no new nudge is sent for that sha$/,
    (ctx) => {
      assert.ok(
        !ctx.result.output.includes('NUDGED coordinator'),
        `expected the second sweep to send NO nudge (the only offender is deduped), got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  // ── Scenario 06 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a different offending commit is now reachable from main$/,
    (ctx) => {
      ctx.secondSha = commitFile(ctx.root, 'extension/src/bar.ts', 'more code\n', 'coder: second offender');
    },
    FEATURE
  );

  registry.defineScoped(
    /^a nudge is sent naming the second commit$/,
    (ctx) => {
      // "the babysitter sweep runs again" (shared with scenario 05, already
      // run for this scenario too) IS the sweep that should nudge the new
      // second offender while the first stays deduped - its own result is
      // already in ctx.result/ctx.findings. Re-running the sweep here would
      // be a THIRD real --nudge call, by which point the second offender
      // would ALSO already be deduped from the second call - exactly the
      // bug this comment is warning a future edit away from reintroducing.
      assert.match(ctx.result.output, /NUDGED coordinator: 1 finding\(s\)/, `expected exactly one (the new) finding nudged, got:\n${ctx.result.output}`);
      assert.ok(
        ctx.findings.some((f) => f.key === `pipeline-code-on-main-${ctx.secondSha}`),
        `expected the second commit's finding to still be reported, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  // ── Scenario 07 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^check_pipeline_code_on_main\.sh --list-paths reports a path set the sweep has never seen$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      const stubDir = mkTmp('sfvc-bl631-stub-');
      const stub = path.join(stubDir, 'stub-list-paths.sh');
      fs.writeFileSync(
        stub,
        '#!/usr/bin/env bash\nif [[ "${1:-}" == "--list-paths" ]]; then\n  printf \'%s\\n\' "docs/custom-secret.md"\n  exit 0\nfi\nexit 0\n'
      );
      fs.chmodSync(stub, 0o755);
      ctx.stubScript = stub;
      ctx.stubPath = 'docs/custom-secret.md';
      ctx.stubSha = commitFile(ctx.root, ctx.stubPath, 'top secret\n', 'coder: touches a stub-only path');
      ctx.realPathSha = commitFile(ctx.root, 'extension/src/foo.ts', 'code\n', 'coder: touches the real QA-exclusive path');
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touching only a path from that reported set fires a critical finding$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: ctx.stubScript } });
      ctx.findings = pipelineFindings(ctx.result.output);
      assert.ok(
        ctx.findings.some((f) => f.key === `pipeline-code-on-main-${ctx.stubSha}`),
        `expected the stub-only path to fire under the stub, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touching extension\/src\/ produces no finding$/,
    (ctx) => {
      assert.ok(
        !ctx.findings.some((f) => f.key === `pipeline-code-on-main-${ctx.realPathSha}`),
        `expected extension/src/ to NOT fire while the stub is active, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  // ── Scenario 08 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the swarmforge-QA ref cannot be resolved$/,
    (ctx) => {
      ctx.root = mkTmp('sfvc-bl631-noqa-');
      fs.writeFileSync(path.join(ctx.root, 'README.md'), 'init\n');
      git(ctx.root, ['init', '-q', '-b', 'main']);
      git(ctx.root, ['add', '-A']);
      git(ctx.root, ['commit', '-q', '-m', 'init']);
      // Deliberately no swarmforge-QA branch at all.
    },
    FEATURE
  );

  registry.defineScoped(
    /^the sweep reports an UNAVAILABLE finding for the check$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root);
      const findings = parseFindings(ctx.result.output);
      assert.ok(
        findings.some((f) => f.key === 'pipeline-code-on-main' && f.severity === 'UNAVAILABLE'),
        `expected an UNAVAILABLE pipeline-code-on-main finding, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^it does not report the repository as clean$/,
    (ctx) => {
      assert.ok(!ctx.result.output.includes('OK all checks green'), `expected NOT an all-clean sweep, got:\n${ctx.result.output}`);
    },
    FEATURE
  );

  // ── Scenario 09 (Outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^an offending commit is reachable from (\S+) and from no other ref naming main$/,
    (ctx, token) => {
      const ref = knownRef(token);
      const originDir = mkTmp('sfvc-bl631-origin-');
      execFileSync('git', ['init', '-q', '--bare', originDir]);

      ctx.root = mkTmp('sfvc-bl631-refs-');
      fs.writeFileSync(path.join(ctx.root, 'README.md'), 'init\n');
      git(ctx.root, ['init', '-q', '-b', 'main']);
      git(ctx.root, ['add', '-A']);
      git(ctx.root, ['commit', '-q', '-m', 'init']);
      git(ctx.root, ['branch', 'swarmforge-QA']);
      git(ctx.root, ['remote', 'add', 'origin', originDir]);
      git(ctx.root, ['push', '-q', 'origin', 'main', 'swarmforge-QA']);

      if (ref === 'main') {
        // Offending commit lands on LOCAL main only - never pushed, so
        // origin/main (the remote-tracking ref) never sees it.
        ctx.sha = commitFile(ctx.root, 'extension/src/foo.ts', 'code\n', 'coder: offends local main only');
      } else {
        // Offending commit lands on origin's OWN main via a SEPARATE
        // clone (simulating a push nobody's local checkout has fetched
        // into its own main branch), then this checkout fetches so its
        // origin/main remote-tracking ref advances while LOCAL main does
        // not.
        const otherClone = mkTmp('sfvc-bl631-pusher-');
        git(REPO_ROOT, ['clone', '-q', originDir, otherClone]);
        git(otherClone, ['checkout', '-q', 'main']);
        ctx.sha = commitFile(otherClone, 'extension/src/foo.ts', 'code\n', 'coder: offends origin main only');
        git(otherClone, ['push', '-q', 'origin', 'main']);
        git(ctx.root, ['fetch', '-q', 'origin']);
      }
    },
    FEATURE
  );

  // Reuses "the babysitter sweep runs" and "a critical finding names that
  // commit" from scenarios 01/02 above - identical step text.

  // ── Scenario 10 ──────────────────────────────────────────────────────────
  // Reproduces the 2026-07-25 BL-590 incident's STRUCTURAL shape (6
  // individual offending commits + 1 merge, plus 2 false-positive-shaped
  // clean commits) against a fresh fixture - the real historical shas cited
  // in the feature file's own prose are QA's own live-host verification
  // (qa_e2e_procedure step 2), not reproducible here since they have since
  // become ancestors of the CURRENT swarmforge-QA tip (the fix landed
  // fix-forward) and no ref may be mutated to reconstruct their original
  // ancestry state.
  registry.defineScoped(
    /^the commit set from the 2026-07-25 BL-590 incident window$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      ctx.offendingShas = [];
      ctx.offendingShas.push(commitFile(ctx.root, 'extension/src/a.ts', '1\n', 'coder: 4851901ed-shaped'));
      ctx.offendingShas.push(commitFile(ctx.root, 'extension/src/b.ts', '2\n', 'coder: 73706d79e-shaped'));
      ctx.offendingShas.push(commitFile(ctx.root, 'extension/test/c.test.js', '3\n', 'coder: 8e76f8f10-shaped'));
      ctx.offendingShas.push(commitFile(ctx.root, 'specs/pipeline/steps/d.js', '4\n', 'coder: ebd12542d-shaped'));
      ctx.offendingShas.push(commitFile(ctx.root, 'extension/src/e.ts', '5\n', 'coder: e05c025d4-shaped'));
      ctx.offendingShas.push(commitFile(ctx.root, 'extension/src/f.ts', '6\n', 'coder: cce634a6c-shaped'));
      git(ctx.root, ['checkout', '-q', '-b', 'feature-10']);
      commitFile(ctx.root, 'extension/src/g.ts', '7\n', 'coder: merge parent work');
      git(ctx.root, ['checkout', '-q', 'main']);
      git(ctx.root, ['merge', 'feature-10', '--no-ff', '-q', '-m', 'cleaner: f8dc07963-shaped merge']);
      ctx.mergeSha = git(ctx.root, ['rev-parse', 'HEAD']).trim();
      ctx.cleanShas = [];
      ctx.cleanShas.push(commitFile(ctx.root, 'backlog/active/BL-1.yaml', 'ticket\n', 'specifier: b03e17429-shaped backlog drain'));
      ctx.cleanShas.push(commitFile(ctx.root, 'extension/docs/briefings/summary.json', '{}\n', 'coder: cb85b9e4b-shaped cost sidecar'));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the babysitter sweep classifies that set$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root);
      ctx.findings = pipelineFindings(ctx.result.output);
    },
    FEATURE
  );

  registry.defineScoped(
    /^commits 4851901ed, 73706d79e, 8e76f8f10, ebd12542d, e05c025d4, cce634a6c and the merge f8dc07963 are all critical$/,
    (ctx) => {
      const wantSet = new Set([...ctx.offendingShas, ctx.mergeSha]);
      const foundSet = new Set(ctx.findings.map((f) => f.key.replace('pipeline-code-on-main-', '')));
      for (const sha of wantSet) {
        assert.ok(foundSet.has(sha), `expected ${sha} to be CRIT, got findings:\n${ctx.result.output}`);
      }
      assert.equal(wantSet.size, 7, 'sanity: expected exactly 7 offending shas in the reproduced regression set');
    },
    FEATURE
  );

  registry.defineScoped(
    /^commits b03e17429 and cb85b9e4b produce no finding$/,
    (ctx) => {
      const foundSet = new Set(ctx.findings.map((f) => f.key.replace('pipeline-code-on-main-', '')));
      for (const sha of ctx.cleanShas) {
        assert.ok(!foundSet.has(sha), `expected ${sha} (a clean-shaped commit) to produce NO finding, got findings:\n${ctx.result.output}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
