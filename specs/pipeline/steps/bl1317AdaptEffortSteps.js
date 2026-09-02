'use strict';

// BL-1317: the Adapt tier moves a seat's reasoning effort from OUTCOME
// signals. Drives the REAL pipeline end to end over the same single-seat
// coder fixture BL-1316's claim-time feature uses - a real
// ready_for_next_task.bb claim to establish the BL-1316 baseline, then a
// real done_with_current_task.bb completion to deliver the outcome signal -
// and asserts on the real launch/coder.claude-settings.json file, which is
// what a respawn reads. Nothing here asserts over prose or a diff.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1317 Adapt-tier effort dial follows outcome signals';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLE = 'coder';

// The ladder, restated here only as the ACCEPTANCE's own expectation of what
// "the next higher notch" means - the cross-language parity of the two
// implementations is gated separately by
// swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh.
const LADDER = ['low', 'medium', 'high'];
const PACK_DEFAULT_EFFORT = 'medium';
const CLAIM_TIME_EFFORT = 'medium';

function seatDir(root, role) {
  return path.join(root, role);
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function confPath(root) {
  return path.join(root, 'swarmforge', 'swarmforge.conf');
}

function writeConf(root, backend) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    confPath(root),
    [`window ${ROLE} ${backend} coder --model claude-sonnet-5 --effort ${PACK_DEFAULT_EFFORT}`, ''].join('\n')
  );
}

function mkFixture(ctx, { backend = 'claude' } = {}) {
  const root = mkSocketFixtureRoot('bl1317-acc-');
  ctx.root = root;
  ctx.backend = backend;
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv() });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  const roles = ['specifier', ROLE];
  for (const r of roles) fs.mkdirSync(seatDir(root, r), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${r}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  writeConf(root, backend);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'launch', `${ROLE}.claude-settings.json`),
    JSON.stringify({ model: 'claude-sonnet-5', effortLevel: PACK_DEFAULT_EFFORT }, null, 2)
  );
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
  ctx.parcelCounter = 0;
}

function fixtureEnv(root, role) {
  return {
    ...gitEnv(),
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: role,
  };
}

// One ticket per scenario: Adapt is ticket-scoped, and a second ticket id
// would legitimately reset the effort to its own claim-time baseline.
function writeTicket(ctx, cost) {
  ctx.ticketId = 'BL-9317';
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}.yaml`),
    `id: ${ctx.ticketId}\ntitle: probe\nstatus: active\nmutation_cost: ${cost}\n`
  );
}

function send(ctx) {
  ctx.parcelCounter += 1;
  ctx.task = `${ctx.ticketId}-probe-${ctx.parcelCounter}`;
  const draft = path.join(seatDir(ctx.root, 'specifier'), `d-${ctx.task}.txt`);
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: ${ROLE}\npriority: 50\ntask: ${ctx.task}\ncommit: ${ctx.commit}\n`
  );
  const sendOnce = () =>
    spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
      cwd: seatDir(ctx.root, 'specifier'),
      encoding: 'utf8',
      timeout: 60000,
      env: fixtureEnv(ctx.root, 'specifier'),
    });
  // Article 2.3's self-audit: the first call against a draft fingerprint
  // challenges and queues nothing; an identical second call queues it.
  let res = sendOnce();
  assert.equal(res.status, 0, `send (audit) failed: ${res.stdout}${res.stderr}`);
  res = sendOnce();
  assert.equal(res.status, 0, `send (queue) failed: ${res.stdout}${res.stderr}`);
}

function claim(ctx) {
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: seatDir(ctx.root, ROLE),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, ROLE),
  });
  assert.equal(res.status, 0, `claim failed: ${res.stdout}${res.stderr}`);
  return res;
}

function inProcessDir(ctx) {
  return path.join(seatDir(ctx.root, ROLE), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function inProcessFile(ctx) {
  const d = inProcessDir(ctx);
  const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
  assert.equal(files.length, 1, `expected exactly one in_process parcel, found ${files.length}`);
  return path.join(d, files[0]);
}

// A bounce reaches a seat as a reverse hop: a non-forwarding inbound. That
// header is helper-stamped in the live swarm, so the fixture stamps it on
// the claimed parcel rather than hand-writing a parcel into inbox/new.
function markBounced(ctx) {
  const file = inProcessFile(ctx);
  const text = fs.readFileSync(file, 'utf8');
  const [head, ...rest] = text.split('\n\n');
  fs.writeFileSync(file, [`${head}\nnon-forwarding: true`, ...rest].join('\n\n'));
}

function complete(ctx) {
  // done_with_current_task.bb execs ready_for_next_task.sh at the end, which
  // reports NO_TASK once the queue is empty - a non-zero exit that says the
  // completion itself worked. The effort record happens before that exec.
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'done_with_current_task.bb')], {
    cwd: seatDir(ctx.root, ROLE),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, ROLE),
  });
  assert.match(`${res.stdout}`, /COMPLETED:/, `completion failed: ${res.stdout}${res.stderr}`);
  return res;
}

function settingsFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'launch', `${ROLE}.claude-settings.json`);
}

function readEffort(ctx) {
  return JSON.parse(fs.readFileSync(settingsFile(ctx), 'utf8')).effortLevel;
}

function oneCycle(ctx, { bounced }) {
  send(ctx);
  claim(ctx);
  if (bounced) markBounced(ctx);
  complete(ctx);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a seat whose backend exposes a reasoning-effort setting$/, (ctx) => {
    mkFixture(ctx, { backend: 'claude' });
  });

  scoped(/^BL-1316 has set a claim-time baseline for the held ticket$/, (ctx) => {
    // Established for real by the claim below, not asserted from prose: the
    // scenario's own Given claims a ticket and checks the resulting effort.
    if (!ctx.root) mkFixture(ctx, { backend: 'claude' });
  });

  scoped(/^the seat holds a ticket at medium claim-time effort$/, (ctx) => {
    writeTicket(ctx, CLAIM_TIME_EFFORT);
    send(ctx);
    claim(ctx);
    assert.equal(readEffort(ctx), CLAIM_TIME_EFFORT, 'BL-1316 baseline not established');
    ctx.baseline = CLAIM_TIME_EFFORT;
    ctx.confBefore = fs.readFileSync(confPath(ctx.root));
  });

  scoped(/^a bounce is recorded for that ticket on this seat$/, (ctx) => {
    markBounced(ctx);
    complete(ctx);
  });

  scoped(/^the seat respawns at the next higher effort notch$/, (ctx) => {
    const expected = LADDER[LADDER.indexOf(ctx.baseline) + 1];
    assert.ok(expected, 'the baseline must not already be the top rung for this scenario');
    // The settings file IS the respawn path: it is the --settings file the
    // launcher hands the agent, so what it says is what the seat comes back
    // at (the same mechanism BL-1316's claim-time apply uses).
    assert.equal(readEffort(ctx), expected);
  });

  scoped(/^the pack conf on disk is unchanged$/, (ctx) => {
    assert.ok(
      ctx.confBefore.equals(fs.readFileSync(confPath(ctx.root))),
      'declared invariant 1: Adapt must never rewrite the pack window line on disk'
    );
  });

  scoped(/^the seat has climbed above its claim-time baseline$/, (ctx) => {
    writeTicket(ctx, CLAIM_TIME_EFFORT);
    ctx.baseline = CLAIM_TIME_EFFORT;
    ctx.confBefore = fs.readFileSync(confPath(ctx.root));
    oneCycle(ctx, { bounced: true });
    const climbed = LADDER[LADDER.indexOf(CLAIM_TIME_EFFORT) + 1];
    assert.equal(readEffort(ctx), climbed, 'the seat should have climbed on the bounce');
    ctx.climbed = climbed;
  });

  scoped(/^the configured clean-completion streak is met$/, (ctx) => {
    // The streak is deliberately not restated here: the run keeps completing
    // cleanly until the dial actually moves, and fails if it never does. A
    // hardcoded count would pass against an implementation that dropped on
    // the first clean pass, which is exactly invariant 2's asymmetry.
    ctx.cleanPassesBeforeDrop = 0;
    for (let i = 0; i < 10 && readEffort(ctx) === ctx.climbed; i += 1) {
      oneCycle(ctx, { bounced: false });
      ctx.cleanPassesBeforeDrop += 1;
    }
    assert.ok(readEffort(ctx) !== ctx.climbed, 'the clean streak never gave a notch back');
    assert.ok(
      ctx.cleanPassesBeforeDrop > 1,
      'a single clean completion dropped a notch - the streak rule is not being applied'
    );
  });

  scoped(/^the seat may drop one notch$/, (ctx) => {
    assert.equal(LADDER.indexOf(readEffort(ctx)), LADDER.indexOf(ctx.climbed) - 1);
  });

  scoped(/^the resulting effort is never below the BL-1316 baseline for that ticket$/, (ctx) => {
    // Keep completing cleanly well past the streak: the floor must hold for
    // an unbounded clean run, not merely for the next one.
    for (let i = 0; i < 3 * (ctx.cleanPassesBeforeDrop || 3); i += 1) {
      oneCycle(ctx, { bounced: false });
      assert.ok(
        LADDER.indexOf(readEffort(ctx)) >= LADDER.indexOf(ctx.baseline),
        `effort fell below the ${ctx.baseline} baseline`
      );
    }
    assert.equal(readEffort(ctx), ctx.baseline);
  });

  scoped(/^a seat on a backend with no reasoning-effort setting$/, (ctx) => {
    mkFixture(ctx, { backend: 'cursor' });
    writeTicket(ctx, CLAIM_TIME_EFFORT);
    ctx.confBefore = fs.readFileSync(confPath(ctx.root));
    send(ctx);
    claim(ctx);
    ctx.settingsBefore = fs.readFileSync(settingsFile(ctx), 'utf8');
  });

  scoped(/^a bounce is recorded$/, (ctx) => {
    markBounced(ctx);
    complete(ctx);
  });

  scoped(/^Adapt does not send an unsupported effort argument$/, (ctx) => {
    // No lever means nothing is written at all - byte-identical settings
    // file, so there is no effort value for a launch line to pick up.
    assert.equal(fs.readFileSync(settingsFile(ctx), 'utf8'), ctx.settingsBefore);
  });
}

module.exports = { registerSteps };
