'use strict';

// BL-1094 declared invariants (coder first authorship — BL-654):
//
// 1. A handoff the daemon generates for itself is one the daemon's own
//    validator will accept — no generated parcel is refused by a gate
//    written for hand-authored drafts.
// 2. A gate that refuses a parcel says which gate refused it and why, in
//    the log line the operator will actually read.
//
// Encoded against task_commit_coherence_gate_lib.bb (check-enabled? +
// operator-refusal-log-line) and a real swarm_handoff.bb send of a
// dispatch-gap-shaped draft under the daemon env flag.
//
// Non-vacuity: (1) unset the env flag → mismatched HEAD send exits non-zero;
// (2) feed a BL-953 stderr without the formatter → no gate= prefix. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS, 'swarm_handoff.bb');
const COHERENCE_LIB = path.join(SCRIPTS, 'task_commit_coherence_gate_lib.bb');
const ENV_NAME = 'SWARMFORGE_DISPATCH_GAP_AUTOROUTE';

function bbExpr(expr) {
  return execFileSync('bb', ['-e', `(load-file "${COHERENCE_LIB}")\n${expr}`], {
    encoding: 'utf8',
  }).trim();
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function mkSendFixture() {
  const root = mkTmpDir('sfvc-bl1094-prop-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'BL-888: other tip']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tC\tclaude\ttask`,
      `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask`,
    ].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-1094-gap.yaml'),
    'id: BL-1094\ntitle: "gap"\nstatus: todo\nassigned_to: coder\n'
  );
  const commit = git(root, ['rev-parse', '--short=10', 'HEAD']);
  return { root, commit };
}

function trySend(root, commit, withExempt) {
  const draft = path.join(root, 'draft.txt');
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: coder\npriority: 00\ntask: BL-1094\ncommit: ${commit}\n`
  );
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: 'coordinator',
    SWARMFORGE_SKIP_SYNC_INJECT: '1',
  };
  if (withExempt) env[ENV_NAME] = '1';
  try {
    execFileSync('bb', [SWARM_HANDOFF, draft], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message || e) };
  }
}

test(
  'BL-1094/BL-654 invariant 1: daemon-marked auto-route is accepted when HEAD names another ticket',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.boolean(), (withExempt) => {
        draws += 1;
        const { root, commit } = mkSendFixture();
        const result = trySend(root, commit, withExempt);
        if (withExempt) {
          assert.equal(result.ok, true, `exempt auto-route must send; got ${result.err}`);
        } else {
          assert.equal(result.ok, false, 'hand path without exempt must still hit BL-953');
          assert.match(result.err, /BL-953/);
        }
        const enabled = bbExpr(
          `(println (task-commit-coherence-gate-lib/check-enabled? {:dispatch-gap-autoroute? ${withExempt}}))`
        );
        assert.equal(enabled, withExempt ? 'false' : 'true');
      }),
      { numRuns: 8 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('BL-1094/BL-654 invariant 2: operator log line names the refusing gate and reason', () => {
  const samples = [
    'HANDOFF INVALID: x\nErrors:\n- Cannot send git_handoff for BL-1094: commit abc belongs to BL-888, not to the task\'s ticket BL-1094 (BL-953).',
    'task-commit coherence check could not run',
    'some other validation failure HANDOFF INVALID',
    'totally opaque stderr',
  ];
  let draws = 0;
  fc.assert(
    fc.property(fc.constantFrom(...samples), (stderr) => {
      draws += 1;
      const line = bbExpr(
        `(println (task-commit-coherence-gate-lib/operator-refusal-log-line ${JSON.stringify(stderr)}))`
      );
      assert.match(line, /^gate=/);
      assert.match(line, /reason=/);
      if (stderr.includes('BL-953') || stderr.includes('task-commit coherence')) {
        assert.match(line, /gate=task-commit-coherence \(BL-953\)/);
      }
    }),
    { numRuns: samples.length * 3 }
  );
  assert.ok(draws >= samples.length);
});
