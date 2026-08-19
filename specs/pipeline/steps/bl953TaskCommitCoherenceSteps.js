'use strict';

// BL-953: step handlers for "A git_handoff's commit must belong to the
// ticket its task names". Drives REAL swarm_handoff.bb sends against a
// fixture repo whose commits are crafted per <commit_tickets> row - never a
// reimplementation of the gate. The unreadable-subject row injects a
// PATH-stub git that passes every call through to the real git EXCEPT
// `log -1 --format=%s` (the one read the gate makes), the established
// PATH-stub idiom - never chmod, never corrupting the repo.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');

const FEATURE = "A git_handoff's commit must belong to the ticket its task names";

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

const TASK_NAMES = {
  'BL-935': 'BL-935-cap-the-vitest-fork-pool',
  'BL-949': 'BL-949-concierge-board-wiring',
  'BL-945': 'BL-945-constitution-citations',
};

// The <commit_tickets> rows: each crafts one commit whose subject names
// exactly that id set. KNOWN_VALUES - an unknown token throws.
const COMMIT_SUBJECTS = {
  'BL-949': 'BL-949: concierge board-wiring tests assert the live matrix',
  'no ticket id': "Merge commit 'e336c44dba' into swarm/coder",
  'BL-631, BL-945': 'BL-631+BL-945: batch bounce fixes, one commit satisfying both',
};

function mkFixture(ctx) {
  const root = mkTmp('sfvc-bl953-');
  git(root, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'x.feature'), 'Feature: x\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const rows = ['coordinator', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']
    .map((r) => `${r}\t${r === 'coordinator' ? 'master' : r}\t${root}\tswarmforge-${r}\tX\tclaude\ttask`)
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);
  for (const [id, task] of Object.entries(TASK_NAMES)) {
    fs.writeFileSync(
      path.join(root, 'backlog', 'active', `${task}.yaml`),
      `id: ${id}\ntitle: "probe"\nstatus: active\nacceptance: specs/features/x.feature\n`
    );
  }
  ctx.root = root;
}

function craftCommit(ctx, subject) {
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', subject]);
  ctx.commit = git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
}

// A passthrough git stub whose ONLY failure is the subject read the gate
// makes (`log -1 --format=%s ...`) - every other git call swarm_handoff.bb
// performs (rev-parse canonicalization etc.) reaches the real binary.
function mkSubjectBlindGit(ctx) {
  const bin = path.join(ctx.root, 'stub-bin');
  fs.mkdirSync(bin, { recursive: true });
  const script = `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "--format=%s" ]]; then
    echo "stub: subject read disabled" >&2
    exit 1
  fi
done
exec /usr/local/bin/git "$@"
`;
  fs.writeFileSync(path.join(bin, 'git'), script);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  ctx.stubBin = bin;
}

function send(ctx, { from, to, draft }) {
  const draftPath = path.join(ctx.root, 'draft.txt');
  fs.writeFileSync(draftPath, draft);
  const env = { ...process.env, SWARMFORGE_ROLE: from, SWARMFORGE_SKIP_SYNC_INJECT: '1' };
  delete env.SWARMFORGE_CONFIG;
  if (ctx.stubBin) env.PATH = `${ctx.stubBin}:${env.PATH}`;
  const res = spawnSync('bb', [SWARM_HANDOFF, 'draft.txt'], { cwd: ctx.root, encoding: 'utf8', env });
  ctx.result = { exitCode: res.status ?? 99, output: `${res.stdout || ''}${res.stderr || ''}` };
}

function sendGitHandoff(ctx, { from, taskId, to = 'cleaner' }) {
  const task = TASK_NAMES[taskId];
  if (!task) {
    throw new Error(`unknown <task_ticket> token: ${taskId}`);
  }
  send(ctx, {
    from,
    to,
    draft: `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`,
  });
}

function newInboxFiles(ctx) {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (full.includes(`${path.sep}inbox${path.sep}new${path.sep}`)) found.push(full);
    }
  };
  walk(path.join(ctx.root, '.swarmforge', 'handoffs'));
  return found;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a swarm repository whose roles send parcels with swarm_handoff\.sh$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a commit whose introduced history names (.+)$/,
    (ctx, token) => {
      const clean = token.replace(/^"|"$/g, '');
      if (!Object.prototype.hasOwnProperty.call(COMMIT_SUBJECTS, clean)) {
        throw new Error(`unknown <commit_tickets> token: ${clean}`);
      }
      craftCommit(ctx, COMMIT_SUBJECTS[clean]);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit whose introduced history cannot be read$/,
    (ctx) => {
      craftCommit(ctx, 'BL-949: real subject the stub will refuse to reveal');
      mkSubjectBlindGit(ctx);
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the (coder|cleaner) sends a git_handoff for task ticket "([^"]+)" citing that commit$/,
    (ctx, from, taskId) => {
      sendGitHandoff(ctx, { from, taskId, to: from === 'cleaner' ? 'architect' : 'cleaner' });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the coder sends a note to the coordinator$/,
    (ctx) => {
      send(ctx, { from: 'coder', to: 'coordinator', draft: 'type: note\nto: coordinator\npriority: 50\nmessage: no commit here\n' });
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the send is (refused|accepted)$/,
    (ctx, outcome) => {
      if (outcome === 'refused') {
        assert.equal(ctx.result.exitCode, 2, `expected a refusal (exit 2), got ${ctx.result.exitCode}:\n${ctx.result.output}`);
        assert.match(ctx.result.output, /HANDOFF INVALID/);
      } else {
        assert.ok(
          !/HANDOFF INVALID/.test(ctx.result.output) && /\.handoff/.test(ctx.result.output),
          `expected an accepted send (an installed .handoff, no INVALID), got exit ${ctx.result.exitCode}:\n${ctx.result.output}`
        );
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the refusal reports the ticket the task names and the ticket the commit carries$/,
    (ctx) => {
      assert.match(ctx.result.output, /BL-935/, `expected the task's ticket named:\n${ctx.result.output}`);
      assert.match(ctx.result.output, /BL-949/, `expected the commit's ticket named:\n${ctx.result.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the parcel is not delivered to any mailbox$/,
    (ctx) => {
      assert.deepEqual(newInboxFiles(ctx), [], 'expected no parcel in any inbox/new');
    },
    FEATURE
  );

  registry.defineScoped(
    /^a warning records that the coherence check could not run$/,
    (ctx) => {
      assert.match(
        ctx.result.output,
        /TASK_COMMIT_COHERENCE WARNING: .*could not run/,
        `expected the fail-open warning, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
