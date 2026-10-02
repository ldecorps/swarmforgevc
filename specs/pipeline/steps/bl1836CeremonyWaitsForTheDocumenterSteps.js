'use strict';

// BL-1836: the closing ceremony waits for the documenter's briefing and
// never writes one itself. Drives the REAL compiled runner
// (runNightClosingCeremony) in-process with the REAL git-facing deps -
// landDocumenterBriefing (through the real commit_integrity_cli.bb),
// mainHasBriefing and briefingSent - against a git fixture under mkdtemp
// (BL-1390: proven by --git-common-dir before any mutating command). The
// deps that stop a swarm, surface a code or send a note are recorded, never
// run: this fixture has no swarm to stop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1836 The closing ceremony waits for the documenter's briefing and never writes one itself";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUN = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'night-closing-ceremony-run.js');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// A synthetic day no real briefing will ever carry; noon local, so the
// runner's local day key is this day under any TZ.
const TODAY = '2099-01-01';
const NOW_MS = new Date(2099, 0, 1, 12, 0, 0).getTime();
const DOC_BRANCH = 'sc-documenter';
const BRIEFING = `docs/briefings/${TODAY}.md`;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeFixture() {
  const root = mkProcessTmpDir('bl1836acc-');
  git(root, ['init', '-q', '-b', 'main']);
  const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  assert.equal(common, path.join(root, '.git'), `fixture is not its own repository: ${common}`);
  // The landing commit is made by commit_integrity_cli.bb, which runs plain
  // `git commit`: the fixture carries its own identity.
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.cpSync(SCRIPTS, path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\nswarmforge/\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `documenter\tdocumenter\t${root}\t${DOC_BRANCH}\tDocumenter\tclaude\ttask\n`
  );
  git(root, ['add', '.gitignore', 'README.md']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', DOC_BRANCH]);
  return { root, recorded: [], state: null, deadlinePassed: false };
}

function ensureState(ctx) {
  if (!ctx.bl1836) ctx.bl1836 = makeFixture();
  return ctx.bl1836;
}

function briefingPhaseState(fx) {
  return {
    nightKey: TODAY,
    phase: 'briefing',
    sequence: ['freeze-promotion', 'lean-packet'],
    startedAtMs: NOW_MS - 10 * 60_000,
    drainDeadlineMs: NOW_MS - 5 * 60_000,
    hardDeadlineMs: fx.deadlinePassed ? NOW_MS - 1000 : NOW_MS + 60 * 60_000,
    rotationRequested: false,
    loudSurfaces: [],
    parked: false,
    briefingInstructed: true,
    hadInFlight: false,
  };
}

function deps(fx, run) {
  const rec = (name) => (...args) => {
    fx.recorded.push([name, ...args.slice(1)]);
    return [];
  };
  return {
    readConf: () => '',
    evaluate: () => ({ mode: 'ceremony', ceremonyDue: true, closureStopLocal: '06:00' }),
    readState: () => fx.state,
    writeState: (_t, s) => {
      fx.state = s;
    },
    scanInFlight: () => ({ count: 0, roles: [] }),
    scanHeld: () => [],
    readActiveRole: () => 'documenter',
    briefingSent: run.briefingSent,
    applyFreeze: rec('freeze'),
    rotateDocumenter: rec('rotate'),
    instructBriefing: rec('instruct'),
    nightStop: rec('stop'),
    surface: rec('surface'),
    recordCnp: rec('cnp'),
    deliverLeanPacket: rec('lean'),
    recordEmptyOutcome: rec('empty'),
    workedAShift: () => true,
    landDocumenterBriefing: run.landDocumenterBriefing,
    mainHasBriefing: run.mainHasBriefing,
  };
}

function commitOn(fx, branch, rel, text, msg) {
  git(fx.root, ['checkout', '-q', branch]);
  fs.mkdirSync(path.dirname(path.join(fx.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(fx.root, rel), text);
  git(fx.root, ['add', rel]);
  git(fx.root, ['commit', '-q', '-m', msg]);
  const sha = git(fx.root, ['rev-parse', 'HEAD']);
  git(fx.root, ['checkout', '-q', 'main']);
  return sha;
}

function surfaced(fx) {
  return (
    fx.recorded.some((r) => r[0] === 'surface' && r[1] === 'closing-briefing-missing') ||
    fx.result.state.loudSurfaces.includes('closing-briefing-missing')
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a git fixture root under a temporary directory with a main branch and a documenter branch$/, (ctx) => {
    ensureState(ctx);
  });
  scoped(/^the ceremony is in its briefing phase with the documenter instructed and today's briefing not recorded as sent$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^the hard deadline (has not passed|has passed)$/, (ctx, which) => {
    ensureState(ctx).deadlinePassed = which === 'has passed';
  });

  scoped(/^main has no briefing for today$/, (ctx) => {
    const fx = ensureState(ctx);
    assert.throws(() => git(fx.root, ['cat-file', '-e', `main:${BRIEFING}`]));
  });

  scoped(/^main already has a briefing for today$/, (ctx) => {
    const fx = ensureState(ctx);
    commitOn(fx, 'main', BRIEFING, `# Briefing for ${TODAY}\n\nAlready on main.\n`, `briefing ${TODAY}`);
  });

  scoped(/^the documenter branch's newest commit adds only "docs\/briefings\/<today>\.md"$/, (ctx) => {
    const fx = ensureState(ctx);
    fx.docSha = commitOn(fx, DOC_BRANCH, BRIEFING, `# Briefing for ${TODAY}\n\nThe documenter's words.\n`, `Compose the ${TODAY} briefing`);
  });

  scoped(/^the documenter branch has no commit touching "docs\/briefings\/<today>\.md"$/, (ctx) => {
    const fx = ensureState(ctx);
    commitOn(fx, DOC_BRANCH, 'docs/other.md', 'other\n', 'documenter: unrelated');
    assert.equal(git(fx.root, ['log', DOC_BRANCH, '--format=%H', '--', BRIEFING]), '');
  });

  scoped(/^docs\/briefings\/\.sent\.json records today's briefing in the shape the email sweep writes$/, (ctx) => {
    const fx = ensureState(ctx);
    // The sweep's own writer, not a hand-built shape (BL-897).
    execFileSync(
      'bb',
      ['-e', `(load-file ${JSON.stringify(path.join(SCRIPTS, 'briefing_email_lib.bb'))}) (briefing-email-lib/record-briefing-sent! ${JSON.stringify(path.join(fx.root, 'docs', 'briefings'))} "${TODAY}.md")`],
      { stdio: 'pipe' }
    );
  });

  scoped(/^the ceremony advances$/, (ctx) => {
    const fx = ensureState(ctx);
    // eslint-disable-next-line global-require
    const run = require(RUN);
    fx.state = briefingPhaseState(fx);
    fx.mainBefore = git(fx.root, ['rev-parse', 'main']);
    fx.result = run.runNightClosingCeremony(fx.root, '/nonexistent.conf', NOW_MS, deps(fx, run), false, 'finish-shift');
  });

  scoped(/^main's tip adds "docs\/briefings\/<today>\.md" byte-identical to the documenter's copy and touches no other path$/, (ctx) => {
    const fx = ensureState(ctx);
    const tip = git(fx.root, ['rev-parse', 'main']);
    assert.notEqual(tip, fx.mainBefore, 'main did not move');
    assert.equal(git(fx.root, ['diff', '--name-only', fx.mainBefore, tip]), BRIEFING);
    assert.equal(git(fx.root, ['show', `main:${BRIEFING}`]), git(fx.root, ['show', `${fx.docSha}:${BRIEFING}`]));
  });

  scoped(/^"closing-briefing-missing" is not surfaced$/, (ctx) => {
    assert.equal(surfaced(ensureState(ctx)), false, JSON.stringify(ctx.bl1836.result.state));
  });

  scoped(/^"closing-briefing-missing" is surfaced$/, (ctx) => {
    assert.equal(surfaced(ensureState(ctx)), true, JSON.stringify(ctx.bl1836.result.state));
  });

  scoped(/^the recorded sequence contains "send-confirmed" before "swarm-stopped"$/, (ctx) => {
    const seq = ensureState(ctx).result.state.sequence;
    assert.ok(seq.includes('send-confirmed') && seq.indexOf('send-confirmed') < seq.indexOf('swarm-stopped'), seq.join(' -> '));
  });

  scoped(/^the recorded sequence ends with "briefing-missing, swarm-stopped"$/, (ctx) => {
    const seq = ensureState(ctx).result.state.sequence;
    assert.deepEqual(seq.slice(-2), ['briefing-missing', 'swarm-stopped'], seq.join(' -> '));
  });

  scoped(/^main's tip is unchanged$/, (ctx) => {
    const fx = ensureState(ctx);
    assert.equal(git(fx.root, ['rev-parse', 'main']), fx.mainBefore);
  });

  scoped(/^the swarm is stopped$/, (ctx) => {
    const fx = ensureState(ctx);
    assert.ok(fx.recorded.some((r) => r[0] === 'stop'), JSON.stringify(fx.recorded));
    assert.equal(fx.result.state.phase, 'done');
  });
}

module.exports = { registerSteps };
