'use strict';

// BL-1499: step handlers for "the notify fixture's pane state follows what
// was typed, not how often it was read". Drives the REAL
// test_handoffd_notify_verified.sh (never a parallel reimplementation of
// the fixture) for the whole-file scenarios. For the case-02 daemon-log
// assertion, that shell script's own daemon log dir is wiped by every
// later case's run_notify, so this reproduces case 02's exact before/after
// pane text - extracted from the live script, never duplicated by hand -
// against the REAL handoffd.bb directly, to inspect its daemon log and
// call log for that one case in isolation.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const TEST_SH = path.join(SCRIPTS, 'test', 'test_handoffd_notify_verified.sh');

const FEATURE = "BL-1499 The notify fixture's pane state follows what was typed, not how often it was read";

function ensureState(ctx) {
  if (!ctx.bl1499) ctx.bl1499 = {};
  return ctx.bl1499;
}

// Case 02's before/after pane text lives only in the shell fixture; pulling
// it from the live file (rather than a hand-copied literal here) means this
// handler cannot drift from what the shell test actually encodes.
function extractCase02Fixture(source) {
  const between = source.split(/^#.*── 3:/m)[0].split(/^#.*── 2:/m)[1];
  if (!between) {
    throw new Error('could not locate the case 02 section in test_handoffd_notify_verified.sh');
  }
  const before = between.match(/echo '([^']*)' > "\$BEFORE_STDOUT_FILE"/);
  const after = between.match(/echo '([^']*)' > "\$AFTER_STDOUT_FILE"/);
  if (!before || !after) {
    throw new Error('could not extract case 02 before/after pane text from test_handoffd_notify_verified.sh');
  }
  return { before: before[1], after: after[1] };
}

function mkFixtureRoot() {
  const root = mkSocketFixtureRoot('bl1499-');
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(
    path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new', '50_test_pending.handoff'),
    'type: git_handoff\nto: coder\npriority: 50\ntask: BL-093\n'
  );
  return root;
}

// The same send-keys-keyed fake BL-1499 puts in the shell test: any
// capture-pane before the first send-keys call returns `beforeFile`, every
// one after returns `afterFile` - independent of how many probes read the
// pane first.
function writeFakeTmux(binDir, typedFile, callLog, beforeFile, afterFile) {
  const tmux = path.join(binDir, 'tmux');
  fs.writeFileSync(
    tmux,
    [
      '#!/usr/bin/env bash',
      `echo "$*" >> "${callLog}"`,
      'for arg in "$@"; do',
      `  if [[ "$arg" == "send-keys" ]]; then touch "${typedFile}"; fi`,
      'done',
      'for arg in "$@"; do',
      '  if [[ "$arg" == "capture-pane" ]]; then',
      `    if [[ -e "${typedFile}" ]]; then cat "${afterFile}" 2>/dev/null; else cat "${beforeFile}" 2>/dev/null; fi`,
      '    exit 0',
      '  fi',
      'done',
      'exit 0',
      '',
    ].join('\n')
  );
  fs.chmodSync(tmux, 0o755);
}

function runCase02Isolated(fixtureText) {
  const { before, after } = extractCase02Fixture(fixtureText);
  const root = mkFixtureRoot();
  try {
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const callLog = path.join(root, 'tmux-calls.log');
    fs.writeFileSync(callLog, '');
    const typedFile = path.join(root, 'typed-marker');
    const beforeFile = path.join(root, 'before-stdout.txt');
    const afterFile = path.join(root, 'after-stdout.txt');
    fs.writeFileSync(beforeFile, `${before}\n`);
    fs.writeFileSync(afterFile, `${after}\n`);
    writeFakeTmux(binDir, typedFile, callLog, beforeFile, afterFile);
    fs.rmSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true, force: true });
    spawnSync('bb', [HANDOFFD, root, '--startup-notify-only'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
    });
    const callText = fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8') : '';
    const logPath = path.join(root, '.swarmforge', 'daemon', 'handoffd.log');
    const daemonLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    return { callText, daemonLog };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    releaseSocketFixtureRoot(root);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^the notify test's fixture as it stands on the tree$/, (ctx) => {
    ensureState(ctx).source = fs.readFileSync(TEST_SH, 'utf8');
  }, FEATURE);

  registry.defineScoped(/^the notify test runs against the real startup-notify path$/, (ctx) => {
    ensureState(ctx).result = spawnSync('bash', [TEST_SH], { encoding: 'utf8' });
  }, FEATURE);

  registry.defineScoped(/^it reports the wedged-pane case as passed$/, (ctx) => {
    const st = ensureState(ctx);
    const out = `${st.result.stdout || ''}${st.result.stderr || ''}`;
    if (!/PASS: 02: wedged pane exhausts retries, reports failure, never stacks a retype/.test(out)) {
      throw new Error(`expected case 02 to pass; got:\n${out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^its daemon log for that case names a delivery failure and no second typed copy$/, (ctx) => {
    const st = ensureState(ctx);
    const { callText, daemonLog } = runCase02Isolated(st.source);
    if (!/notify-delivery-failed/.test(daemonLog)) {
      throw new Error(`expected notify-delivery-failed in the daemon log; got:\n${daemonLog}`);
    }
    const lines = callText.split('\n').filter(Boolean);
    const literalLineIdx = lines
      .map((l, i) => (l.split(/\s+/).includes('-l') ? i : -1))
      .filter((i) => i >= 0);
    if (literalLineIdx.length !== 1) {
      throw new Error(`expected exactly one literal send-keys call, got ${literalLineIdx.length}:\n${callText}`);
    }
    const lastCmIdx = lines
      .map((l, i) => (l.split(/\s+/).includes('C-m') ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    if (lastCmIdx !== undefined && literalLineIdx[0] > lastCmIdx) {
      throw new Error(`expected the literal send before any C-m submit; call log:\n${callText}`);
    }
  }, FEATURE);

  registry.defineScoped(/^it exits zero$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.result.status !== 0) {
      throw new Error(`expected exit 0; got ${st.result.status}\n${st.result.stdout}\n${st.result.stderr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^it reports every case as passed$/, (ctx) => {
    const st = ensureState(ctx);
    const out = st.result.stdout || '';
    const passLines = out.split('\n').filter((l) => l.startsWith('PASS: '));
    if (passLines.length !== 5) {
      throw new Error(`expected 5 PASS lines, got ${passLines.length}:\n${out}`);
    }
    if (!/ALL PASS/.test(out)) {
      throw new Error(`expected the file to print ALL PASS; got:\n${out}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
