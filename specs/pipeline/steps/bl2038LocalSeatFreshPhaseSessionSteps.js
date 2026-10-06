'use strict';

// BL-2038: step handlers for "A local seat's phases each run in a fresh
// session". Drives the REAL babashka scripts (ready_for_next_task.bb,
// local_seat_phase_cli.bb, done_with_current_task.bb) as subprocesses over
// a real git-initialized fixture (same mkSocketFixtureRoot + send/claim
// recipe as bl1316ClaimTimeEffortSteps.js's own fixture), with a fake tmux
// on PATH standing in for the real respawn-pane-fresh! target - never a
// restatement of the serve/move/done logic.
//
// The fake tmux never names a server-creating subcommand (only
// 'respawn-pane', a query/control command, not 'new-session'/
// 'start-server'), so it is outside tmuxReaperGuard's scope exactly as
// bl1316's own fake tmux is - confirmed against the guard before forwarding.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { installScripts } = require('./lib/fixtureScriptsInstall');

const FEATURE = "BL-2038 A local seat's phases each run in a fresh session";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLE = 'coder';
const TICKET = 'BL-9001';
const PANE = '%7';

function seatDir(root, role) {
  return path.join(root, role);
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function recordPath(ctx) {
  return path.join(seatDir(ctx.root, ROLE), '.swarmforge', 'phase', `${TICKET}.md`);
}

// Logs only a static marker plus the phase record's OWN content at the
// moment respawn-pane is invoked - never the raw tmux argv, which carries
// real provider keys via handoff_lib.bb's openrouter-pane-env-args in any
// environment where those are exported. Asserting on that argv would risk
// a committed test leaking live secrets into failure output.
function writeFakeTmux(ctx) {
  const bin = path.join(ctx.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const logPath = path.join(ctx.root, 'tmux-calls.log');
  const script = [
    '#!/usr/bin/env bash',
    'case "$*" in',
    '  *respawn-pane*)',
    `    snap="$(cat ${JSON.stringify(recordPath(ctx))} 2>/dev/null || echo MISSING)"`,
    `    printf 'respawn-pane\\n%s\\n---\\n' "$snap" >> ${JSON.stringify(logPath)}`,
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(bin, 'tmux'), script);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  ctx.logPath = logPath;
}

function mkFixture(ctx, agent) {
  const root = mkSocketFixtureRoot('bl2038-acc-');
  ctx.root = root;
  // BL-1905 (QA bounce): ready_for_next_task.bb/done_with_current_task.bb
  // are receive/completion dispatchers - run from the REAL scripts dir they
  // cd into their own real checkout and receive/complete against the LIVE
  // mailbox, not this fixture's. Run the fixture's own installed copy
  // instead; its cd lands inside this checkout. swarm_handoff.bb and
  // local_seat_phase_cli.bb are not dispatchers (BL-1905's own definition)
  // and keep running from the real scripts dir, as other handlers do.
  ctx.dispatcherScripts = installScripts(root);
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv() });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  for (const r of ['specifier', ROLE, 'QA']) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', `${ROLE}.sh`), '#!/usr/bin/env bash\necho fake-launch\n');
  fs.chmodSync(path.join(root, '.swarmforge', 'launch', `${ROLE}.sh`), 0o755);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      `specifier\tspecifier-wt\t${seatDir(root, 'specifier')}\tswarmforge-specifier\tspecifier\tclaude\ttask`,
      `${ROLE}\t${ROLE}-wt\t${seatDir(root, ROLE)}\tswarmforge-${ROLE}\t${ROLE}\t${agent}\ttask`,
      `QA\tQA-wt\t${seatDir(root, 'QA')}\tswarmforge-QA\tQA\tclaude\ttask`,
    ].join('\n') + '\n'
  );
  writeFakeTmux(ctx);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed']);
}

function commitAll(ctx, message) {
  const git = (args) => execFileSync('git', args, { cwd: ctx.root, encoding: 'utf8', env: gitEnv() });
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  try {
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', message]);
  } catch {
    // nothing to commit - fine, HEAD already carries everything
  }
  return git(['rev-parse', 'HEAD']).trim().slice(0, 10);
}

function fixtureEnv(ctx, role) {
  return {
    ...gitEnv(),
    PATH: `${path.join(ctx.root, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: role,
    TMUX_PANE: PANE,
  };
}

function writeTicket(ctx) {
  // The pre-QA gate (coder -> QA forward) reads this at the cited commit
  // and refuses when it is unreadable - a trivial real feature file keeps
  // the fixture's forward (done_with_current's own forward-gate
  // precondition) realistic rather than stubbed around.
  const featureDir = path.join(ctx.root, 'specs', 'features');
  fs.mkdirSync(featureDir, { recursive: true });
  const featurePath = path.join(featureDir, `${TICKET}-fixture.feature`);
  fs.writeFileSync(featurePath, 'Feature: fixture\n\n  Scenario: ok\n    Given a thing\n');
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${TICKET}.yaml`),
    [
      `id: ${TICKET}`,
      'title: fixture ticket',
      'status: active',
      'required_stages: [coder, qa]',
      `acceptance: specs/features/${TICKET}-fixture.feature`,
      '',
    ].join('\n')
  );
}

function run(ctx, role, args) {
  return spawnSync('bb', args, {
    cwd: seatDir(ctx.root, role),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx, role),
  });
}

function sendAndClaim(ctx) {
  const commit = commitAll(ctx, 'ticket');
  const draft = path.join(seatDir(ctx.root, 'specifier'), `d-${TICKET}.txt`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${ROLE}\npriority: 50\ntask: ${TICKET}\ncommit: ${commit}\n`);
  const sendOnce = () => run(ctx, 'specifier', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft]);
  // Article 2.3's self-audit: the first call against a draft fingerprint
  // always challenges (AUDIT_REQUIRED, nothing queued); an identical
  // second call queues it for real.
  let res = sendOnce();
  assert.ok(
    res.status === 0 || `${res.stdout}${res.stderr}`.includes('AUDIT_REQUIRED'),
    `send (audit) failed: ${res.stdout}${res.stderr}`
  );
  res = sendOnce();
  assert.equal(res.status, 0, `send (queue) failed: ${res.stdout}${res.stderr}`);
  const claimRes = run(ctx, ROLE, [path.join(ctx.dispatcherScripts, 'ready_for_next_task.bb')]);
  assert.equal(claimRes.status, 0, `claim failed: ${claimRes.stdout}${claimRes.stderr}`);
}

function writeRecord(ctx, phase, failed = 0) {
  fs.mkdirSync(path.dirname(recordPath(ctx)), { recursive: true });
  fs.writeFileSync(recordPath(ctx), `phase: ${phase}\nfailed: ${failed}\n`);
}

function inProcessDir(ctx) {
  return path.join(seatDir(ctx.root, ROLE), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function holdsTicket(ctx) {
  const d = inProcessDir(ctx);
  if (!fs.existsSync(d)) return false;
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.handoff'))
    .some((f) => fs.readFileSync(path.join(d, f), 'utf8').includes(`task: ${TICKET}`));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a (local-model|claude) seat holding a parcel for BL-9001 whose phase record is in "(arrange|act|assert|done|none)"$/,
    (ctx, agent, phase) => {
      mkFixture(ctx, agent);
      writeTicket(ctx);
      sendAndClaim(ctx);
      assert.ok(holdsTicket(ctx), 'expected the fixture claim to leave the parcel in_process');
      if (phase !== 'none') writeRecord(ctx, phase);
      // Clear any respawn noise the setup's own claim may have logged
      // (the existing fresh-session-at-parcel-boundary feature only fires
      // with --idle-boundary, which this plain claim never passes, but
      // starting the log empty keeps the WHEN step's assertion exact
      // regardless of that).
      fs.writeFileSync(ctx.logPath, '');
    }
  );

  // BL-2038 a-split-request-never-restarts-05: the fail-move's split case
  // (2 failed asserts already) is the one outcome a genuine assert->act
  // move does NOT reach - the seat is giving up the parcel, not resuming
  // it, so it must never restart. Separate from the arrange/act/assert/done
  // Given above because it also seeds the failed count.
  scoped(
    /^a (local-model|claude) seat holding a parcel for BL-9001 whose phase record is in "(arrange|act|assert|done)" with (\d+) failed asserts?$/,
    (ctx, agent, phase, failed) => {
      mkFixture(ctx, agent);
      writeTicket(ctx);
      sendAndClaim(ctx);
      assert.ok(holdsTicket(ctx), 'expected the fixture claim to leave the parcel in_process');
      writeRecord(ctx, phase, Number(failed));
      fs.writeFileSync(ctx.logPath, '');
    }
  );

  scoped(/^the seat fails that assert with a note$/, (ctx) => {
    const notesFile = path.join(seatDir(ctx.root, ROLE), 'notes.txt');
    fs.writeFileSync(notesFile, 'the assertion found a defect\n');
    ctx.failResult = run(ctx, ROLE, [
      path.join(SCRIPTS_DIR, 'local_seat_phase_cli.bb'),
      'fail',
      TICKET,
      '--notes',
      notesFile,
    ]);
    assert.equal(ctx.failResult.status, 0, `fail failed: ${ctx.failResult.stdout}${ctx.failResult.stderr}`);
    assert.equal(ctx.failResult.stdout.trim(), `SPLIT_REQUEST ${TICKET}`, `expected the split request, got:\n${ctx.failResult.stdout}`);
  });

  scoped(/^ready_for_next\.sh serves the parcel$/, (ctx) => {
    ctx.serveResult = run(ctx, ROLE, [path.join(ctx.dispatcherScripts, 'ready_for_next_task.bb')]);
    assert.equal(ctx.serveResult.status, 0, `serve failed: ${ctx.serveResult.stdout}${ctx.serveResult.stderr}`);
  });

  scoped(/^the output names the phase "([^"]+)" and the record's path$/, (ctx, phase) => {
    const out = ctx.serveResult.stdout;
    // local_seat_phase_cli.bb's own record-path is relative to the
    // worktree cwd it is run from (".swarmforge/phase/<ticket>.md"),
    // never absolute - the PHASE line echoes that same relative form.
    const expected = `PHASE: ${phase} - read ${path.join('.swarmforge', 'phase', `${TICKET}.md`)} first.`;
    assert.ok(out.includes(expected), `expected the output to contain:\n${expected}\ngot:\n${out}`);
  });

  scoped(/^the output carries no phase line$/, (ctx) => {
    assert.ok(!/PHASE:/.test(ctx.serveResult.stdout), `expected no PHASE line, got:\n${ctx.serveResult.stdout}`);
  });

  scoped(/^the seat ends the phase toward "([^"]+)" with a note$/, (ctx, to) => {
    const notesFile = path.join(seatDir(ctx.root, ROLE), 'notes.txt');
    fs.writeFileSync(notesFile, 'moving on to the next phase\n');
    ctx.endResult = run(ctx, ROLE, [
      path.join(SCRIPTS_DIR, 'local_seat_phase_cli.bb'),
      'end',
      TICKET,
      '--to',
      to,
      '--notes',
      notesFile,
    ]);
    assert.equal(ctx.endResult.status, 0, `end failed: ${ctx.endResult.stdout}${ctx.endResult.stderr}`);
  });

  scoped(/^the record is in "([^"]+)" before the seat's pane is respawned$/, (ctx, phase) => {
    const log = fs.existsSync(ctx.logPath) ? fs.readFileSync(ctx.logPath, 'utf8') : '';
    assert.match(log, /^respawn-pane$/m, `expected a logged respawn-pane call, got:\n${log}`);
    const lines = log.split('\n');
    const idx = lines.indexOf('respawn-pane');
    const snapshot = lines.slice(idx + 1, idx + 1 + lines.slice(idx + 1).indexOf('---')).join('\n');
    assert.match(
      snapshot,
      new RegExp(`^phase: ${phase}$`, 'm'),
      `expected the record snapshot AT respawn time to already show phase ${phase}, got:\n${snapshot}`
    );
  });

  scoped(/^the parcel for BL-9001 is still in the seat's in_process queue$/, (ctx) => {
    assert.ok(holdsTicket(ctx), 'expected the parcel to remain in the seat in_process queue');
  });

  // BL-2038 invariant 2 (hardener pass, 2026-10-06): the restart path, not
  // only the PHASE-line path, must gate on the seat's agent. Confirmed by
  // hand-mutation this was previously untested - dropping the `(=
  // "local-model" agent)` check from maybe-restart-session! left all other
  // scenarios green.
  scoped(/^no respawn-pane call was logged$/, (ctx) => {
    const log = fs.existsSync(ctx.logPath) ? fs.readFileSync(ctx.logPath, 'utf8') : '';
    assert.ok(!/respawn-pane/.test(log), `expected no respawn-pane call, got:\n${log}`);
  });

  scoped(/^the seat runs done_with_current\.sh$/, (ctx) => {
    // The forward-evidence gate (BL-1609) refuses a git_handoff's
    // completion with nothing sent since dequeue - the real loop.note
    // prose is "pass <ticket>, THEN send the handoff and run
    // done_with_current.sh", so the fixture sends that forward first,
    // same self-audit two-call send() every other scenario here uses.
    const draft = path.join(seatDir(ctx.root, ROLE), 'tmp-forward.txt');
    fs.mkdirSync(path.dirname(draft), { recursive: true });
    const headSha = commitAll(ctx, 'coder work');
    fs.writeFileSync(draft, `type: git_handoff\nto: QA\npriority: 50\ntask: ${TICKET}\ncommit: ${headSha}\n`);
    const sendOnce = () => run(ctx, ROLE, [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft]);
    let res = sendOnce();
    assert.ok(
      res.status === 0 || `${res.stdout}${res.stderr}`.includes('AUDIT_REQUIRED'),
      `forward (audit) failed: ${res.stdout}${res.stderr}`
    );
    res = sendOnce();
    assert.equal(res.status, 0, `forward (queue) failed: ${res.stdout}${res.stderr}`);
    ctx.doneResult = run(ctx, ROLE, [path.join(ctx.dispatcherScripts, 'done_with_current_task.bb')]);
    assert.equal(ctx.doneResult.status, 0, `done failed: ${ctx.doneResult.stdout}${ctx.doneResult.stderr}`);
  });

  scoped(/^no phase record for BL-9001 remains in the seat's worktree$/, (ctx) => {
    assert.ok(!fs.existsSync(recordPath(ctx)), `expected the phase record to be removed: ${recordPath(ctx)}`);
  });
}

module.exports = { registerSteps };
