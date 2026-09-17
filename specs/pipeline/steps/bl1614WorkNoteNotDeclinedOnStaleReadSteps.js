'use strict';

// BL-1614: step handlers for "A Work note is not declined on a stale
// worktree read". Drives the REAL ready_for_next_task.bb claim and the REAL
// done_with_current_task.bb completion against a real TWO-checkout git
// fixture (a main branch checkout and a linked "coder" worktree branched
// off an OLDER commit of it, mirroring the coordinator's real promote-then-
// route race) - the defect and its fix are both about what the claim and
// the completion read off git, never anything a reimplementation could
// stand in for.
//
// Fixture roots come from mkProcessTmpDir (BL-1385/BL-1390: no prefix-glob
// sweep, no single-step early cleanup - a scenario's root is needed across
// multiple steps and the acceptance runner has no Vitest afterEach).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1614 A Work note is not declined on a stale worktree read';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TICKET_YAML = ['id: BL-4242', 'title: "fixture ticket"', 'status: todo', 'assigned_to: coder', ''].join('\n');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1614acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitkeep'), '');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  // Branched from this OLDER commit - the on-main step below advances main
  // AFTER this branch point, so a worktree that never merges stays behind
  // exactly the way the real coordinator's promote-then-route race leaves
  // the coder's own tree behind.
  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);

  const scriptsDir = path.join(coderWt, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    const full = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.statSync(full).isFile() && (name.endsWith('.bb') || name.endsWith('.sh'))) {
      fs.copyFileSync(full, path.join(scriptsDir, name));
      fs.chmodSync(path.join(scriptsDir, name), 0o755);
    }
  }
  // Stubs the .sh WRAPPER only - done_with_current_task.bb's own post-
  // completion run-ready! chains through it, and this fixture has nothing
  // left to dequeue by then anyway. The claim scenarios below call
  // ready_for_next_task.bb directly instead, so the real claim path (and
  // its BL-1614 hint) is still genuinely exercised, same split BL-1422's
  // own sibling handler uses for the identical reason.
  fs.writeFileSync(
    path.join(scriptsDir, 'ready_for_next_task.sh'),
    '#!/usr/bin/env zsh\necho "NO_TASK"\nexit 0\n',
    { mode: 0o755 }
  );

  const rolesLine = `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  fs.mkdirSync(path.join(coderWt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(coderWt, '.swarmforge', 'roles.tsv'), rolesLine);

  const newDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new');
  const inProcess = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const completed = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  const abandoned = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'abandoned');
  for (const dir of [newDir, inProcess, completed, abandoned]) fs.mkdirSync(dir, { recursive: true });

  return {
    root,
    coderWt,
    newDir,
    inProcess,
    completed,
    claimBb: path.join(scriptsDir, 'ready_for_next_task.bb'),
    done: path.join(scriptsDir, 'done_with_current.sh'),
  };
}

function writeTicket(root, lane) {
  fs.mkdirSync(path.join(root, 'backlog', lane), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', lane, 'BL-4242-fixture.yaml'), TICKET_YAML);
}

function removeTicketEverywhere(root) {
  for (const lane of ['active', 'paused']) {
    fs.rmSync(path.join(root, 'backlog', lane, 'BL-4242-fixture.yaml'), { force: true });
  }
}

function setOnMain(state, kind) {
  removeTicketEverywhere(state.root);
  if (kind === 'active and assigned to coder') {
    writeTicket(state.root, 'active');
  } else if (kind === 'still in paused') {
    writeTicket(state.root, 'paused');
  }
  // "absent": nothing written - the removal above already covers it.
  // Scoped to backlog/ only - `git add -A` at root would also pick up the
  // linked .worktrees/coder checkout as an embedded git repository.
  git(state.root, ['add', 'backlog']);
  // --allow-empty keeps every row's commit shape uniform, including the
  // "absent" row where nothing actually changed.
  git(state.root, ['commit', '-q', '--allow-empty', '-m', `BL-4242 on-main: ${kind}`]);
  state.mainTip = git(state.root, ['rev-parse', '--short=10', 'main']);
}

function setInWorktree(state, kind) {
  if (kind === 'active and assigned to coder') {
    git(state.coderWt, ['merge', '-q', 'main']);
  }
  // "still in paused" and "absent" both leave the worktree branch exactly
  // where it started - worktree-active? only ever looks at backlog/active/,
  // so paused-vs-absent makes no observable difference to it either.
}

function writeWorkNote(state) {
  const body = 'Work BL-4242: merge main first, then read backlog/active';
  fs.writeFileSync(
    path.join(state.newDir, '10_work.handoff'),
    `id: x\nfrom: coordinator\nto: coder\nrecipient: coder\npriority: 10\ntype: note\nmessage: ${body}\n\n${body}\n`
  );
}

function runClaim(state) {
  try {
    const out = execFileSync('bb', [state.claimBb], {
      cwd: state.coderWt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function runDone(state, extraArgs) {
  try {
    const out = execFileSync('bash', [state.done, ...(extraArgs || [])], {
      cwd: state.coderWt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
    });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (!ctx.bl1614) ctx.bl1614 = makeFixture();
  return ctx.bl1614;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with a main branch and a coder worktree branched from an older main, with a coder mailbox and a fixture ticket BL-4242$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  scoped(/^on main the ticket BL-4242 is (active and assigned to coder|still in paused|absent)$/, (ctx, kind) => {
    const state = ensureState(ctx);
    setOnMain(state, kind);
  });

  scoped(
    /^in the coder worktree the ticket BL-4242 is (active and assigned to coder|still in paused|absent)$/,
    (ctx, kind) => {
      const state = ensureState(ctx);
      setInWorktree(state, kind);
    }
  );

  scoped(/^a Work note for BL-4242 is queued to the coder$/, (ctx) => {
    const state = ensureState(ctx);
    writeWorkNote(state);
  });

  scoped(/^the coder claims the Work note$/, (ctx) => {
    const state = ensureState(ctx);
    state.claimResult = runClaim(state);
  });

  scoped(
    /^the coder claims the Work note and, with no work done, completes it with the reason not promoted yet$/,
    (ctx) => {
      const state = ensureState(ctx);
      state.claimResult = runClaim(state);
      state.doneResult = runDone(state, ['--no-work', 'not promoted yet']);
    }
  );

  scoped(/^the claim prints a merge-main-first line naming BL-4242 and main's tip$/, (ctx) => {
    const state = ensureState(ctx);
    assert.match(
      state.claimResult.output,
      /MERGE_MAIN_FIRST:\s*BL-4242/,
      `expected a MERGE_MAIN_FIRST line naming BL-4242: ${state.claimResult.output}`
    );
    assert.match(
      state.claimResult.output,
      new RegExp(state.mainTip),
      `expected main's tip ${state.mainTip} in the hint: ${state.claimResult.output}`
    );
  });

  scoped(/^the claim prints no merge-main-first line$/, (ctx) => {
    const state = ensureState(ctx);
    assert.doesNotMatch(
      state.claimResult.output,
      /MERGE_MAIN_FIRST/,
      `expected no MERGE_MAIN_FIRST line: ${state.claimResult.output}`
    );
  });

  scoped(/^the completion is refused naming BL-4242 as active on main and the note stays in in_process$/, (ctx) => {
    const state = ensureState(ctx);
    assert.notEqual(state.doneResult.status, 0, `expected a refusal: ${state.doneResult.output}`);
    assert.match(state.doneResult.output, /WORK_ACTIVE_ON_MAIN/, `expected WORK_ACTIVE_ON_MAIN: ${state.doneResult.output}`);
    assert.match(state.doneResult.output, /BL-4242/, `refusal must name BL-4242: ${state.doneResult.output}`);
    assert.ok(
      fs.existsSync(path.join(state.inProcess, '10_work.handoff')),
      'expected the Work note to still be in in_process'
    );
  });

  scoped(/^the note is completed with the reason recorded$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.doneResult.status, 0, `expected completion, got: ${state.doneResult.output}`);
    assert.match(state.doneResult.output, /COMPLETED:/, `expected COMPLETED: ${state.doneResult.output}`);
    const text = fs.readFileSync(path.join(state.completed, '10_work.handoff'), 'utf8');
    assert.match(text, /^no_work_reason: not promoted yet$/m, `expected no_work_reason recorded: ${text}`);
  });
}

module.exports = { registerSteps };
