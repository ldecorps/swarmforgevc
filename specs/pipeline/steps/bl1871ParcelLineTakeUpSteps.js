'use strict';

// BL-1871: step handlers for "A role takes up a ticket on that ticket's own
// line". Drives the REAL ready_for_next_task.bb claim against a real git
// fixture: a bare origin, a project checkout on main (the master checkout
// the specifier and coordinator share), and linked role worktrees. The
// move is a git fact, so nothing here stands in for git.
//
// Fixture roots come from mkProcessTmpDir (BL-1385/BL-1390) and are proven
// to be their own repository by --git-common-dir before any mutating git
// command. The live checkout and the live .swarmforge/ are never touched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1871 A role takes up a ticket on that ticket's own line";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLAIM_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next_task.bb');
const LIVE_PACK = path.join(REPO_ROOT, 'swarmforge', 'packs', 'full-forge.conf');

const ROLES = ['architect', 'coder', 'cleaner'];

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(cwd, file, subject) {
  fs.writeFileSync(path.join(cwd, file), `${subject}\n`);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-q', '-m', subject]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1871acc-');
  const origin = path.join(root, 'origin.git');
  const proj = path.join(root, 'proj');
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['init', '-q', '-b', 'main', proj]);
  const common = path.resolve(proj, git(proj, ['rev-parse', '--git-common-dir']));
  assert.equal(common, path.join(proj, '.git'), `fixture is not its own repository: ${common}`);
  fs.writeFileSync(path.join(proj, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  fs.writeFileSync(path.join(proj, 'README.md'), 'fixture\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-q', '-m', 'init']);
  git(proj, ['remote', 'add', 'origin', origin]);
  git(proj, ['push', '-q', 'origin', 'main']);
  git(proj, ['fetch', '-q', 'origin']);

  const worktrees = {};
  for (const role of ROLES) {
    const wt = path.join(proj, '.worktrees', role);
    git(proj, ['worktree', 'add', '-q', '-b', `swarmforge-${role}`, wt, 'origin/main']);
    worktrees[role] = wt;
  }
  const lineWt = path.join(proj, '.worktrees', 'line');
  git(proj, ['worktree', 'add', '-q', '--detach', lineWt, 'origin/main']);

  const rows = [
    ['specifier', 'master', proj],
    ['coordinator', 'master', proj],
    ...ROLES.map((r) => [r, r, worktrees[r]]),
  ].map(([role, name, wt]) => `${role}\t${name}\t${wt}\tswarmforge-${role}\t${role}\tclaude\ttask`);
  fs.mkdirSync(path.join(proj, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);

  return { root, proj, worktrees, lineWt, seq: 0 };
}

function roleDir(state, role) {
  return role === 'specifier' || role === 'coordinator' ? state.proj : state.worktrees[role];
}

function mailbox(state, role, box) {
  const base =
    role === 'specifier' || role === 'coordinator'
      ? path.join(state.proj, '.swarmforge', 'handoffs', role)
      : path.join(state.worktrees[role], '.swarmforge', 'handoffs');
  const dir = path.join(base, 'inbox', box);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function lineCommit(state, ticket) {
  git(state.lineWt, ['checkout', '-q', '--detach', 'origin/main']);
  return commitFile(state.lineWt, `${ticket}.txt`, `${ticket}: own line`);
}

function writeHandoff(state, role, box, headers) {
  state.seq += 1;
  const name = `50_20261002T0000${String(state.seq).padStart(2, '0')}Z_00000${state.seq}_from_x_to_${role}.handoff`;
  const body = Object.entries({ id: `x${state.seq}`, to: role, recipient: role, priority: '50', ...headers })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(path.join(mailbox(state, role, box), name), `${body}\n\n${headers.message || `${headers.type} ${headers.task || ""}`}\n`);
}

function head(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']);
}

function runClaim(state, role) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SWARMFORGE_')));
  try {
    const out = execFileSync('bb', [CLAIM_BB], {
      cwd: roleDir(state, role),
      encoding: 'utf8',
      env: { ...env, SWARMFORGE_ROLE: role },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (!ctx.bl1871) ctx.bl1871 = makeFixture();
  return ctx.bl1871;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project whose origin main holds one commit$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^the architect's and the coder's branches each carry an unlanded commit of BL-9000$/, (ctx) => {
    const state = ensureState(ctx);
    for (const role of ['architect', 'coder']) commitFile(state.worktrees[role], `bl9000-${role}.txt`, 'BL-9000: other work');
  });

  scoped(/^the (architect|coder|specifier)'s inbox holds a git_handoff for (BL-\d+) citing a commit on (BL-\d+)'s own line$/, (ctx, role, ticket, lineTicket) => {
    const state = ensureState(ctx);
    state.cited = lineCommit(state, lineTicket);
    writeHandoff(state, role, 'new', { from: 'coder', type: 'git_handoff', task: ticket, commit: state.cited.slice(0, 10) });
  });

  scoped(/^the architect has taken up the git_handoff for (BL-\d+) and committed on top of it$/, (ctx, ticket) => {
    const state = ensureState(ctx);
    state.cited = lineCommit(state, ticket);
    writeHandoff(state, 'architect', 'new', { from: 'coder', type: 'git_handoff', task: ticket, commit: state.cited.slice(0, 10) });
    const first = runClaim(state, 'architect');
    assert.equal(head(state.worktrees.architect), state.cited, `first take-up did not move: ${first.output}`);
    state.own = commitFile(state.worktrees.architect, 'architect-pass.txt', `${ticket}: architect pass`);
  });

  scoped(/^the architect's worktree holds an uncommitted change to a tracked file$/, (ctx) => {
    const state = ensureState(ctx);
    fs.writeFileSync(path.join(state.worktrees.architect, 'README.md'), 'edited\n');
  });

  scoped(/^no commit has been handed off for (BL-\d+)$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^a commit for (BL-\d+) was handed off to the cleaner earlier$/, (ctx, ticket) => {
    const state = ensureState(ctx);
    state.handed = lineCommit(state, ticket);
    writeHandoff(state, 'cleaner', 'completed', { from: 'coder', type: 'git_handoff', task: ticket, commit: state.handed.slice(0, 10) });
  });

  scoped(/^the coder's inbox holds the note "(Work (BL-\d+): [^"]*)"$/, (ctx, message) => {
    const state = ensureState(ctx);
    writeHandoff(state, 'coder', 'new', { from: 'coordinator', type: 'note', message });
  });

  scoped(/^the architect's inbox holds a non-forwarding copy of a git_handoff for (BL-\d+)$/, (ctx, ticket) => {
    const state = ensureState(ctx);
    const c = lineCommit(state, ticket);
    writeHandoff(state, 'architect', 'new', { from: 'coder', type: 'git_handoff', task: ticket, commit: c.slice(0, 10), 'non-forwarding': 'true' });
  });

  scoped(/^the architect's inbox holds QA's merge-up note for (BL-\d+)$/, (ctx, ticket) => {
    const state = ensureState(ctx);
    const c = lineCommit(state, ticket);
    writeHandoff(state, 'architect', 'new', { from: 'QA', type: 'note', message: `merge-up: QA approved ${ticket} at ${c.slice(0, 10)}` });
  });

  scoped(/^the specifier and the coordinator share the master checkout on main$/, (ctx) => {
    const state = ensureState(ctx);
    const rows = fs.readFileSync(path.join(state.proj, '.swarmforge', 'roles.tsv'), 'utf8');
    for (const role of ['specifier', 'coordinator']) assert.match(rows, new RegExp(`^${role}\\tmaster\\t`, 'm'));
  });

  scoped(/^the (architect|coder|specifier) asks for its next task$/, (ctx, role) => {
    const state = ensureState(ctx);
    const cwd = roleDir(state, role);
    state.before = { head: head(cwd), branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) };
    state.claim = runClaim(state, role);
    assert.match(state.claim.output, /TASK:/, `expected the parcel to be printed: ${state.claim.output}`);
  });

  scoped(/^the architect's worktree HEAD is that commit$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(head(state.worktrees.architect), state.cited, state.claim.output);
  });

  scoped(/^the commit the architect held before is kept under a parcel-backup ref$/, (ctx) => {
    const state = ensureState(ctx);
    const refs = git(state.worktrees.architect, ['for-each-ref', '--format=%(objectname)', 'refs/swarmforge/parcel-backup/architect/']);
    assert.ok(refs.split('\n').includes(state.before.head), `backup refs ${refs} lack ${state.before.head}`);
  });

  scoped(/^no commit between origin\/main and the architect's HEAD names a ticket other than (BL-\d+)$/, (ctx, ticket) => {
    const state = ensureState(ctx);
    const subjects = git(state.worktrees.architect, ['log', '--format=%s', 'origin/main..HEAD']).split('\n').filter(Boolean);
    assert.ok(subjects.length > 0, 'expected the parcel line to carry its commit');
    for (const s of subjects) {
      const ids = s.match(/\b(?:BL|GH)-\d+\b/g) || [];
      assert.deepEqual([...new Set(ids)], [ticket], `commit "${s}" names another ticket`);
    }
  });

  scoped(/^the architect's worktree HEAD is the architect's own commit$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(head(state.worktrees.architect), state.own, state.claim.output);
  });

  scoped(/^the architect's worktree HEAD has not moved$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(head(state.worktrees.architect), state.before.head, state.claim.output);
  });

  scoped(/^the output names the changed file and says the parcel was not taken up$/, (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.claim.output, /README\.md/);
    assert.match(state.claim.output, /not taken up/);
  });

  scoped(/^the coder's worktree HEAD is (origin\/main|the newest commit handed off for (BL-\d+))$/, (ctx, start) => {
    const state = ensureState(ctx);
    const expected = start === 'origin/main' ? git(state.proj, ['rev-parse', 'origin/main']) : state.handed;
    assert.equal(head(state.worktrees.coder), expected, state.claim.output);
  });

  scoped(/^the master checkout's HEAD and branch have not changed$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(head(state.proj), state.before.head, state.claim.output);
    assert.equal(git(state.proj, ['rev-parse', '--abbrev-ref', 'HEAD']), state.before.branch);
    assert.equal(state.before.branch, 'main');
  });

  scoped(/^the live pack swarmforge\/packs\/full-forge\.conf$/, (ctx) => {
    ctx.bl1871Pack = fs.readFileSync(LIVE_PACK, 'utf8');
  });

  scoped(/^its cleaner and hardender windows declare task mode$/, (ctx) => {
    for (const role of ['cleaner', 'hardender']) {
      const line = ctx.bl1871Pack.split('\n').find((l) => new RegExp(`^window ${role}\\s`).test(l));
      assert.ok(line, `no ${role} window in the live pack`);
      const mode = line.split(/\s+/)[4];
      assert.equal(mode, 'task', `${role} window declares ${mode}: ${line}`);
    }
  });
}

module.exports = { registerSteps };
