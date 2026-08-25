'use strict';

// BL-272: step handlers for "the cost & health sidecar is emitted from the
// headless briefing path". Drives the REAL babashka scheduling decision
// (briefing_generation_schedule_lib.bb's generate-briefing-if-due!, via
// briefing_generation_sidecar_test_runner.bb, mirroring
// rateLimitCooldownSteps.js's own bb-test-runner pattern) together with the
// REAL compiled headless emitter CLI (out/tools/emit-cost-health-sidecar.js,
// mirroring generateBacklogDashboardCli.test.js's git fixture) - no real
// tmux, no real timer (now-ms is injected into the bb runner).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'briefing_generation_sidecar_test_runner.bb');
const CLI_PATH = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'emit-cost-health-sidecar.js');

// Fixed instant (no real clock) - 07:00 UTC on a day whose .md briefing does
// not exist in the fixture, so the morning trigger is due.
const NOW_MS = Date.parse('2026-07-10T07:00:00Z');
const MORNING_HOUR = 7;
const MORNING_MINUTE = 0;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function buildFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-cost-health-headless-')));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  return root;
}

function runTrigger(ctx) {
  const output = execFileSync(
    'bb',
    [RUNNER, ctx.root, String(NOW_MS), String(MORNING_HOUR), String(MORNING_MINUTE), ctx.emitMode || 'real'],
    { encoding: 'utf8' }
  );
  ctx.runnerOutput = output;
  ctx.callsLog = readCallsLog(ctx.root);
}

function readCallsLog(root) {
  try {
    return fs.readFileSync(path.join(root, 'calls.log'), 'utf8');
  } catch {
    return '';
  }
}

function sidecarJsonFiles(root) {
  const dir = path.join(root, 'docs', 'briefings');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
}

function commitCountFor(root, relFilePath) {
  return git(root, ['log', '--oneline', '--', relFilePath])
    .trim()
    .split('\n')
    .filter(Boolean).length;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm is running headless with no VS Code extension host$/, (ctx) => {
    ctx.root = buildFixture();
    ctx.emitMode = 'real';
  });

  registry.define(/^the daily briefing for the day has not yet been generated$/, (ctx) => {
    const dayKey = new Date(NOW_MS).toISOString().slice(0, 10);
    const mdPath = path.join(ctx.root, 'docs', 'briefings', `${dayKey}.md`);
    if (fs.existsSync(mdPath)) {
      throw new Error(`expected no briefing file yet for the fixture day, found: ${mdPath}`);
    }
  });

  // ── headless-cost-health-sidecar-02 ─────────────────────────────────
  registry.define(/^the cost & health sidecar emit fails$/, (ctx) => {
    ctx.emitMode = 'fail';
  });

  // ── headless-cost-health-sidecar-03 ─────────────────────────────────
  registry.define(/^the day's cost & health sidecar already exists with identical content$/, (ctx) => {
    execFileSync('node', [CLI_PATH], { cwd: ctx.root, encoding: 'utf8' });
    const files = sidecarJsonFiles(ctx.root);
    if (files.length !== 1) {
      throw new Error(`expected exactly one seeded sidecar file, got: ${files.join(', ')}`);
    }
    ctx.seededCommitCount = commitCountFor(ctx.root, path.join('docs', 'briefings', files[0]));
  });

  // ── When ──────────────────────────────────────────────────────────────
  registry.define(/^the headless morning briefing trigger fires for the day$/, (ctx) => {
    runTrigger(ctx);
  });

  // ── headless-cost-health-sidecar-01 ─────────────────────────────────
  registry.define(/^the day's cost & health sidecar is emitted and committed by the deterministic emitter$/, (ctx) => {
    const files = sidecarJsonFiles(ctx.root);
    if (files.length !== 1) {
      throw new Error(`expected exactly one sidecar file to have been emitted, got: ${files.join(', ')}`);
    }
    const sidecar = JSON.parse(fs.readFileSync(path.join(ctx.root, 'docs', 'briefings', files[0]), 'utf8'));
    if (typeof sidecar.schemaVersion !== 'number' || !sidecar.dateIso) {
      throw new Error(`expected a well-formed sidecar payload, got: ${JSON.stringify(sidecar)}`);
    }
    const commits = commitCountFor(ctx.root, path.join('docs', 'briefings', files[0]));
    if (commits < 1) {
      throw new Error(`expected the sidecar file to be committed, got ${commits} commit(s)`);
    }
  });

  // ── headless-cost-health-sidecar-02 ─────────────────────────────────
  registry.define(/^the briefing generation nudge is still sent$/, (ctx) => {
    if (!/^notify /m.test(ctx.callsLog)) {
      throw new Error(`expected the notify adapter to have been called despite the emit failure, got calls.log: ${ctx.callsLog}`);
    }
  });

  // ── headless-cost-health-sidecar-03 ─────────────────────────────────
  registry.define(/^no duplicate sidecar commit is made$/, (ctx) => {
    const files = sidecarJsonFiles(ctx.root);
    if (files.length !== 1) {
      throw new Error(`expected exactly one sidecar file, got: ${files.join(', ')}`);
    }
    const commits = commitCountFor(ctx.root, path.join('docs', 'briefings', files[0]));
    if (commits !== ctx.seededCommitCount) {
      throw new Error(`expected the commit count to stay at ${ctx.seededCommitCount}, got ${commits}`);
    }
  });
}

module.exports = { registerSteps };
