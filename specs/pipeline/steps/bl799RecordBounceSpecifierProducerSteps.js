'use strict';

// BL-799: step handlers for "The bounce ledger records specifier-produced
// send-backs". Shells out to the REAL compiled binary
// (extension/out/tools/record-bounce.js) against a real temp fixture repo -
// the recordBounceCli.test.js/bl635RecordBounceByRoleSteps.js pattern,
// never a reimplementation of the CLI's own validation/recording logic in
// JS.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');
const { readBounceRecords } = require(path.join(EXT_DIR, 'out', 'metrics', 'bounceStore'));

const FEATURE_NAME = 'The bounce ledger records specifier-produced send-backs';

const TICKET = 'BL-9799';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl799-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${TICKET}-fixture.yaml`),
    `id: ${TICKET}\ntitle: "fixture"\nstatus: active\nassigned_to: coder\n`
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

function runCli(cwd, args) {
  try {
    const out = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: '', stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

function registerSteps(registry) {
  const step = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── record-bounce-specifier-producer-01 ─────────────────────────────────

  step(
    /^record-bounce runs naming specifier as the producing role and spec-gap as the failure class$/,
    (ctx) => {
      ctx.target = mkFixtureRepo();
      ctx.result = runCli(ctx.target, [
        '--ticket',
        TICKET,
        '--role',
        'specifier',
        '--type',
        'defect',
        '--class',
        'spec-gap',
        '--commit',
        'bl799comm01',
        '--by',
        'specifier',
      ]);
    }
  );

  step(/^it exits successfully$/, (ctx) => {
    if (ctx.result.exitCode !== 0) {
      throw new Error(`expected exit 0, got ${ctx.result.exitCode}, stderr: ${ctx.result.stderr}`);
    }
  });

  step(/^a ledger row is appended naming specifier as the producing role$/, (ctx) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    const newest = records[records.length - 1];
    if (!newest || newest.producingRole !== 'specifier' || newest.failureClass !== 'spec-gap') {
      throw new Error(`expected a ledger row with producingRole specifier and failureClass spec-gap, got ${JSON.stringify(newest)}`);
    }
  });

  // ── record-bounce-specifier-producer-02 ─────────────────────────────────

  step(/^record-bounce is invoked with no arguments$/, (ctx) => {
    ctx.target = ctx.target || mkFixtureRepo();
    ctx.result = runCli(ctx.target, []);
  });

  step(/^the usage text lists specifier among the valid producing roles$/, (ctx) => {
    if (ctx.result.exitCode === 0) {
      throw new Error('expected a nonzero exit for a missing-arguments invocation');
    }
    if (!/--role: specifier\|coder\|cleaner\|architect\|hardender\|documenter/.test(ctx.result.stderr)) {
      throw new Error(`expected the usage text to list specifier among producing roles, got: ${ctx.result.stderr}`);
    }
  });
}

module.exports = { registerSteps };
