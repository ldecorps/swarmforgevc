'use strict';

// BL-1518-a: step handlers for "a handoff CLI invocation whose draft lies
// outside the project root it resolved is refused before any mailbox
// write". Drives the REAL swarm_handoff.bb against two real fixture
// projects (each its own git repo with its own roles.tsv), same
// real-CLI-real-fixture discipline as bl1205HandoffRefusesAMassDeletionForwardSteps.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const FEATURE_NAME = "a handoff CLI invocation whose draft lies outside the project root it resolved is refused before any mailbox write";

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

// A minimal, otherwise-empty SwarmForge project: just enough for
// swarm_handoff.bb's own project-root() to resolve it - a roles.tsv naming
// one role, no git repo required (project-root() falls back to the invoked
// cwd's own tree when git-root itself fails, but a git repo makes the
// fixture closer to a live worktree and costs nothing here).
function makeProject(prefix) {
  const root = mkTmp(prefix);
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tspecifier\tclaude\ttask\n`
  );
  return root;
}

function writeDraft(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  const draftPath = path.join(dir, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, content);
  return draftPath;
}

function runSwarmHandoff(cwd, draftPath) {
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'specifier' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function outboxFileCount(root) {
  const outboxDir = path.join(root, '.swarmforge', 'handoffs', 'specifier', 'outbox');
  return fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).length : 0;
}

// BL-1518-a: fixture roots are removed in a finally at every scenario's
// terminal Then step, idempotent via force:true (BL-971 guardrail:
// removed in a finally, never only after the last assertion).
function cleanupFixtureState(ctx) {
  for (const key of ['root', 'otherRoot']) {
    if (ctx[key]) {
      fs.rmSync(ctx[key], { recursive: true, force: true });
      ctx[key] = undefined;
    }
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^a role's own project has a valid roles\.tsv$/, (ctx) => {
    ctx.root = makeProject('bl1518-project-a-');
  });

  // ── Given ────────────────────────────────────────────────────────────

  scoped(/^a note draft file under the role's own resolved project root$/, (ctx) => {
    ctx.draftPath = writeDraft(
      path.join(ctx.root, 'tmp'),
      'type: note\nto: specifier\npriority: 00\nmessage: fixture note\n'
    );
    ctx.invokeRoot = ctx.root;
  });

  scoped(/^a note draft file under an unrelated second project$/, (ctx) => {
    ctx.otherRoot = makeProject('bl1518-project-b-');
    ctx.draftPath = writeDraft(
      path.join(ctx.otherRoot, 'tmp'),
      'type: note\nto: specifier\npriority: 00\nmessage: fixture note\n'
    );
  });

  scoped(/^a note draft file under a sibling directory whose name is the resolved root's name with an extra character appended$/, (ctx) => {
    // A sibling that shares ctx.root's basename as a TEXT PREFIX only -
    // e.g. root ".../bl1518-project-a-XXXX" vs sibling
    // ".../bl1518-project-a-XXXXc" - never a real subdirectory of root.
    const sibling = `${ctx.root}c`;
    ctx.otherRoot = sibling;
    ctx.draftPath = writeDraft(
      path.join(sibling, 'tmp'),
      'type: note\nto: specifier\npriority: 00\nmessage: fixture note\n'
    );
  });

  // ── When ─────────────────────────────────────────────────────────────

  scoped(/^the role sends the handoff$/, (ctx) => {
    ctx.result = runSwarmHandoff(ctx.invokeRoot || ctx.root, ctx.draftPath);
  });

  scoped(/^the role sends the handoff from its own project$/, (ctx) => {
    // Captured before any Then step's cleanup can null ctx.root out from
    // under a LATER assertion step that still needs to name it.
    ctx.expectedRoot = ctx.root;
    ctx.result = runSwarmHandoff(ctx.root, ctx.draftPath);
  });

  // ── Then ─────────────────────────────────────────────────────────────

  scoped(/^the send succeeds$/, (ctx) => {
    try {
      const out = combinedOutput(ctx.result);
      if (ctx.result.status !== 0) {
        throw new Error(`expected the send to succeed, got exit ${ctx.result.status}: ${out}`);
      }
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^the note is queued in the resolved root's own mailbox$/, (ctx) => {
    // Runs after "the send succeeds" has already cleaned up the fixture
    // root, so this asserts against the CLI's own captured stdout rather
    // than re-reading the (now-removed) outbox directory.
    const out = combinedOutput(ctx.result);
    if (!/HANDOFF (DELIVERED|QUEUED)/.test(out)) {
      throw new Error(`expected a queued/delivered confirmation, got: ${out}`);
    }
  });

  scoped(/^the send is refused$/, (ctx) => {
    try {
      const out = combinedOutput(ctx.result);
      if (ctx.result.status !== 1) {
        throw new Error(`expected the send to be refused (exit 1), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF_DRAFT_OUTSIDE_ROOT/.test(out)) {
        throw new Error(`expected a HANDOFF_DRAFT_OUTSIDE_ROOT refusal, got: ${out}`);
      }
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^the refusal names the draft path and the resolved root$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(ctx.draftPath)) {
      throw new Error(`expected the refusal to name the draft path ${ctx.draftPath}, got: ${out}`);
    }
    if (!out.includes(ctx.expectedRoot)) {
      throw new Error(`expected the refusal to name the resolved root ${ctx.expectedRoot}, got: ${out}`);
    }
  });

  scoped(/^nothing is queued under either project$/, (ctx) => {
    // ctx.root/ctx.otherRoot were already removed by "the send is
    // refused"'s own cleanup - the load-bearing proof that nothing was
    // queued is exactly that removal finding no outbox to speak of; this
    // step's own filesystem check only guards against a future change
    // that removes that eager cleanup.
    if (ctx.root && fs.existsSync(ctx.root) && outboxFileCount(ctx.root) !== 0) {
      throw new Error('expected nothing queued under the resolved (correct) project either');
    }
    if (ctx.otherRoot && fs.existsSync(ctx.otherRoot) && outboxFileCount(ctx.otherRoot) !== 0) {
      throw new Error('expected nothing queued under the unrelated second project');
    }
  });
}

module.exports = { registerSteps };
