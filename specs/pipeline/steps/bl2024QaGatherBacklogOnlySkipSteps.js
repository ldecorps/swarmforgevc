'use strict';

// BL-2024: step handlers for "QA's gather skips the unit and property
// lanes for a backlog-only parcel". Drives the REAL
// extension/src/quality/qaGather.ts (compiled) - composeQaGatherReport -
// against a real fixture git repo (git init under mkdtemp, BL-1390), with
// a runFn that passes `git` through to the real git (the production
// decision reads real merge-base/diff output) and answers every other
// command with exit 0 (never a real npm test/property-lane spawn from
// inside an acceptance test). Never a restatement of the backlog-only
// decision itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { composeQaGatherReport } = require('../../../extension/out/quality/qaGather');
const { defaultRunFn } = require('../../../extension/out/metrics/qaGatherAdapter');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-2024 QA's gather skips the unit and property lanes for a backlog-only parcel";
const TICKET = 'BL-9999';
const YAML_CONTENT = `id: ${TICKET}\nacceptance: specs/features/fixture.feature\n`;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// QA bounce D3 (2026-10-09): branch is explicit and REQUIRED, never left
// to git's own init.defaultBranch config - a host with that config set to
// "main" previously made the "no main branch" fixture HAVE one anyway,
// resolving a real (vacuous) merge-base instead of the unresolvable one
// that scenario names.
function mkRepo(prefix, branch) {
  const root = trackedTmpRoot(prefix);
  git(root, ['init', '-q', '-b', branch]);
  // BL-1390: proven isolated before any other mutating git command.
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitParcel(root, paths) {
  // The parcel commit is a DESCENDANT of main on its OWN branch, never
  // main's own tip - merge-base main <commit> must resolve to the commit
  // BEFORE these paths were added, or the diff this ticket's own decision
  // reads would be empty (vacuous: every path "outside" it trivially).
  git(root, ['checkout', '-q', '-b', 'parcel']);
  for (const p of paths) {
    writeFile(root, p, `fixture content for ${p}\n`);
  }
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'parcel commit']);
  return git(root, ['rev-parse', 'HEAD']);
}

function runGather(ctx) {
  const { root, commit } = ctx.bl2024;
  const calls = [];
  const runFn = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (command === 'git') {
      return defaultRunFn(command, args, cwd);
    }
    return { started: true, exit: 0, stdout: '', stderr: '' };
  };
  ctx.bl2024.calls = calls;
  ctx.bl2024.report = composeQaGatherReport(root, TICKET, { commit }, runFn, YAML_CONTENT);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp('^a fixture repository whose parcel commit adds only "backlog/evidence/BL-9001-coder\\.md" on top of main$'), (ctx) => {
    const root = mkRepo('bl2024-backlog-only-', 'main');
    const commit = commitParcel(root, ['backlog/evidence/BL-9001-coder.md']);
    ctx.bl2024 = { root, commit };
  });

  scoped(
    new RegExp('^a fixture repository whose parcel commit adds "backlog/evidence/BL-9001-coder\\.md" and "(.+?)" on top of main$'),
    (ctx, extraPath) => {
      const root = mkRepo('bl2024-mixed-', 'main');
      const commit = commitParcel(root, ['backlog/evidence/BL-9001-coder.md', extraPath]);
      ctx.bl2024 = { root, commit };
    }
  );

  // QA bounce D1 (2026-10-09): a RENAME out of extension/src/ into
  // backlog/ is the one diff shape --name-only's default rename
  // detection hides the source path for - the production fix is
  // --no-renames; this proves it against real git, never a restatement.
  scoped(new RegExp('^a fixture repository whose parcel commit renames "(.+?)" to "(.+?)" on top of main$'), (ctx, fromPath, toPath) => {
    const root = mkRepo('bl2024-rename-', 'main');
    writeFile(root, fromPath, 'fixture content to be moved\n');
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed the source file']);
    git(root, ['checkout', '-q', '-b', 'parcel']);
    fs.mkdirSync(path.join(root, path.dirname(toPath)), { recursive: true });
    git(root, ['mv', fromPath, toPath]);
    git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'rename into backlog/']);
    const commit = git(root, ['rev-parse', 'HEAD']);
    ctx.bl2024 = { root, commit };
  });

  scoped(new RegExp('^a fixture repository with no main branch$'), (ctx) => {
    // An explicit non-"main" initial branch (mkRepo's own branch arg),
    // never ambient-config-dependent - proven below, not assumed.
    const root = mkRepo('bl2024-no-main-', 'other');
    writeFile(root, 'backlog/evidence/BL-9001-coder.md', 'fixture content\n');
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add evidence']);
    const commit = git(root, ['rev-parse', 'HEAD']);
    assert.throws(() => git(root, ['rev-parse', '--verify', 'main']), 'expected "main" to be unresolvable in this fixture, not vacuously present');
    ctx.bl2024 = { root, commit };
  });

  scoped(new RegExp('^the QA gather runs for that parcel commit$'), (ctx) => {
    runGather(ctx);
  });

  scoped(new RegExp('^the QA gather runs for its HEAD commit$'), (ctx) => {
    runGather(ctx);
  });

  scoped(new RegExp('^the unit row and the properties row read skipped, naming the backlog-only diff$'), (ctx) => {
    const { report } = ctx.bl2024;
    const unitRow = report.checks.find((c) => c.id === 'unit');
    const propsRow = report.checks.find((c) => c.id === 'properties');
    assert.equal(unitRow.status, 'skipped', `expected unit skipped; got ${unitRow.status}`);
    assert.equal(propsRow.status, 'skipped', `expected properties skipped; got ${propsRow.status}`);
    assert.match(unitRow.reason || '', /backlog\/evidence\/BL-9001-coder\.md/, `expected the reason to name the backlog-only diff; got: ${unitRow.reason}`);
    assert.match(propsRow.reason || '', /backlog\/evidence\/BL-9001-coder\.md/, `expected the reason to name the backlog-only diff; got: ${propsRow.reason}`);
  });

  scoped(new RegExp('^neither npm test nor npm run test:properties was started$'), (ctx) => {
    const started = ctx.bl2024.calls.filter((c) => c.command === 'npm');
    assert.deepEqual(started, [], `expected no npm call at all; got: ${JSON.stringify(started)}`);
  });

  scoped(new RegExp('^the acceptance row ran$'), (ctx) => {
    const row = ctx.bl2024.report.checks.find((c) => c.id === 'acceptance');
    assert.equal(row.status, 'ran', `expected the acceptance row to run; got ${row.status} (${row.reason})`);
  });

  scoped(new RegExp('^the unit row and the properties row ran$'), (ctx) => {
    const { report, calls } = ctx.bl2024;
    const unitRow = report.checks.find((c) => c.id === 'unit');
    const propsRow = report.checks.find((c) => c.id === 'properties');
    assert.equal(unitRow.status, 'ran', `expected unit to run; got ${unitRow.status} (${unitRow.reason})`);
    assert.equal(propsRow.status, 'ran', `expected properties to run; got ${propsRow.status} (${propsRow.reason})`);
    const npmCalls = calls.filter((c) => c.command === 'npm').map((c) => c.args.join(' '));
    assert.deepEqual(npmCalls.sort(), ['run test:properties', 'test'], 'expected both lanes to have actually started');
  });
}

module.exports = { registerSteps };
