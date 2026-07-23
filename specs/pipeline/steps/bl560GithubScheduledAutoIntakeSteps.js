'use strict';

// BL-560 (epic BL-558 slice 1): step handlers for the scheduled GitHub
// auto-intake scan. Drives the REAL github_intake_scan.sh / github_intake_write.sh
// scripts against REAL disposable git repos (a bare "origin" + one or more
// working clones) - no mocked git, mirroring bl419SharedCheckoutCommitIntegritySteps.js's
// own rule for exactly this reason (the race/push behavior under test IS
// real git behavior). The GitHub API side (`gh issue list/comment/edit`) is
// faked with a small script placed earlier on PATH, since no live GitHub
// call is available in this environment - swarmIntakeEnvRouteSteps.js
// establishes there is no existing convention for mocking `gh` in this
// pipeline either; scan-05 stays a static-YAML/shared-script-parity check
// for the same reason that file's checks stay static.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const yaml = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'js-yaml'));

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SCAN_SCRIPT = path.join(SWARMFORGE_SCRIPTS, 'github_intake_scan.sh');
const WRITE_SCRIPT = path.join(SWARMFORGE_SCRIPTS, 'github_intake_write.sh');
const LABEL_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'swarm-intake.yml');

// ── fixture: a real bare "origin" + working clone(s) ────────────────────────

function mkBareOrigin() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-origin-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bare });
  return bare;
}

function seedOrigin(bare) {
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-seed-'));
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: seed });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: seed });
  fs.mkdirSync(path.join(seed, 'backlog'));
  fs.writeFileSync(path.join(seed, 'backlog', '.gitkeep'), '');
  execFileSync('git', ['add', '.'], { cwd: seed });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: seed });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: seed });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: seed });
}

function cloneWorking(bare) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-clone-'));
  execFileSync('git', ['clone', '-q', bare, dir]);
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

function mkFixtureRepo() {
  const bare = mkBareOrigin();
  seedOrigin(bare);
  return { bare, clone: cloneWorking(bare) };
}

// ── fixture: a fake `gh` CLI (issue list/comment/edit only) ─────────────────

const FAKE_GH_LINES = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'if [[ "${1:-}" == "issue" && "${2:-}" == "list" ]]; then',
  '  cat "$GH_FAKE_ISSUES_TSV"',
  '  exit 0',
  'fi',
  'if [[ "${1:-}" == "issue" && "${2:-}" == "comment" ]]; then',
  '  echo "comment $3" >> "$GH_FAKE_LOG"',
  '  exit 0',
  'fi',
  'if [[ "${1:-}" == "issue" && "${2:-}" == "edit" ]]; then',
  '  echo "edit $3 $4 $5" >> "$GH_FAKE_LOG"',
  '  exit 0',
  'fi',
  'echo "unhandled fake gh args: $*" >&2',
  'exit 1',
  ''
];

function mkFakeGhBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-ghbin-'));
  const ghPath = path.join(dir, 'gh');
  fs.writeFileSync(ghPath, FAKE_GH_LINES.join('\n'));
  fs.chmodSync(ghPath, 0o755);
  return dir;
}

// \x1f (unit separator), matching github_intake_scan.sh's own delimiter
// choice - NOT a tab, which bash's `read` collapses as IFS whitespace even
// when IFS is set to nothing else, swallowing an empty labels field.
function tsvLineForIssue({ number, url, labels, title, body }) {
  const b64 = (s) => Buffer.from(s || '', 'utf8').toString('base64');
  return [String(number), url, (labels || []).join(','), b64(title), b64(body)].join('\x1f');
}

function writeIssuesFixture(dir, issues) {
  const p = path.join(dir, 'issues.tsv');
  fs.writeFileSync(p, issues.map(tsvLineForIssue).join('\n') + '\n');
  return p;
}

function runScan(cwd, { fakeGhDir, issuesTsvPath, logPath }) {
  const env = {
    ...process.env,
    PATH: `${fakeGhDir}:${process.env.PATH}`,
    GH_FAKE_ISSUES_TSV: issuesTsvPath,
    GH_FAKE_LOG: logPath,
    GH_TOKEN: 'fake-token-for-tests'
  };
  try {
    const stdout = execFileSync('bash', [SCAN_SCRIPT], { cwd, env, encoding: 'utf8' });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function setupScanFixture(ctx, issues) {
  const { bare, clone } = mkFixtureRepo();
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-fixture-'));
  ctx.bare = bare;
  ctx.clone = clone;
  ctx.issuesTsvPath = writeIssuesFixture(fixtureDir, issues);
  ctx.logPath = path.join(fixtureDir, 'gh-log.txt');
  fs.writeFileSync(ctx.logPath, '');
  ctx.fakeGhDir = mkFakeGhBin();
}

function backlogFilesFor(dir, num) {
  return fs.readdirSync(path.join(dir, 'backlog')).filter((f) => f.startsWith(`GH-${num}-`) && f.endsWith('.yaml'));
}

function showOnMain(bare, relPath) {
  return execFileSync('git', ['--git-dir', bare, 'show', `main:${relPath}`], { encoding: 'utf8' });
}

function findStepByName(doc, name) {
  for (const job of Object.values(doc.jobs)) {
    const step = job.steps.find((s) => s.name === name);
    if (step) {
      return step;
    }
  }
  return null;
}

function registerSteps(registry) {
  // ── scan-01: an open issue without a backlog file is intaked ────────────
  registry.define(/^an open GitHub issue with number N and no swarm-intake label$/, (ctx) => {
    ctx.issue = {
      number: 501,
      url: 'https://github.com/acme/repo/issues/501',
      labels: [],
      title: 'Fix the widget',
      body: 'Widget is broken.\nPlease fix.'
    };
    setupScanFixture(ctx, [ctx.issue]);
  });

  registry.define(/^no file matching backlog\/GH-N-\*\.yaml exists on main$/, (ctx) => {
    const files = backlogFilesFor(ctx.clone, ctx.issue.number);
    assert.equal(files.length, 0, `expected no pre-existing GH-${ctx.issue.number} file, found: ${files.join(',')}`);
  });

  registry.define(/^the scheduled auto-intake workflow runs$/, (ctx) => {
    ctx.result = runScan(ctx.clone, { fakeGhDir: ctx.fakeGhDir, issuesTsvPath: ctx.issuesTsvPath, logPath: ctx.logPath });
  });

  registry.define(/^a file backlog\/GH-N-<slug>\.yaml is committed on main$/, (ctx) => {
    assert.equal(ctx.result.exitCode, 0, `expected the scan to succeed, got: ${JSON.stringify(ctx.result)}`);
    const files = backlogFilesFor(ctx.clone, ctx.issue.number);
    assert.equal(files.length, 1, `expected exactly one GH-${ctx.issue.number} file, found: ${files.join(',')}`);
    ctx.writtenRelPath = path.posix.join('backlog', files[0]);
    ctx.writtenContent = showOnMain(ctx.bare, ctx.writtenRelPath);
  });

  registry.define(/^the file's id is GH-N and source is the issue URL$/, (ctx) => {
    const parsed = yaml.load(ctx.writtenContent);
    assert.equal(parsed.id, `GH-${ctx.issue.number}`);
    assert.equal(parsed.source, ctx.issue.url);
  });

  registry.define(/^the issue receives a queued-for-swarm comment naming that path$/, (ctx) => {
    const log = fs.readFileSync(ctx.logPath, 'utf8');
    const line = log.split('\n').find((l) => l.startsWith(`comment ${ctx.issue.number}`));
    assert.ok(line, `expected a comment call for issue ${ctx.issue.number}, log:\n${log}`);
  });

  registry.define(/^the issue is labeled swarm-intake$/, (ctx) => {
    const log = fs.readFileSync(ctx.logPath, 'utf8');
    const line = log.split('\n').find((l) => l.startsWith(`edit ${ctx.issue.number}`) && l.includes('swarm-intake'));
    assert.ok(line, `expected an edit --add-label swarm-intake call for issue ${ctx.issue.number}, log:\n${log}`);
  });

  // ── scan-02: an issue that already has a GH-N backlog file is skipped ───
  registry.define(/^an open GitHub issue with number N$/, (ctx) => {
    ctx.issue = {
      number: 502,
      url: 'https://github.com/acme/repo/issues/502',
      labels: [],
      title: 'Already handled',
      body: 'n/a'
    };
    setupScanFixture(ctx, [ctx.issue]);
  });

  registry.define(/^backlog\/GH-N-existing\.yaml already exists on main$/, (ctx) => {
    const file = path.join(ctx.clone, 'backlog', `GH-${ctx.issue.number}-existing.yaml`);
    fs.writeFileSync(file, `id: GH-${ctx.issue.number}\ntitle: "pre-existing"\n`);
    execFileSync('git', ['add', '.'], { cwd: ctx.clone });
    execFileSync('git', ['commit', '-q', '-m', 'pre-existing intake'], { cwd: ctx.clone });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: ctx.clone });
  });

  registry.define(/^no second GH-N file is created$/, (ctx) => {
    const files = backlogFilesFor(ctx.clone, ctx.issue.number);
    assert.equal(files.length, 1, `expected exactly the pre-existing GH-${ctx.issue.number} file, found: ${files.join(',')}`);
  });

  registry.define(/^the workflow exits successfully$/, (ctx) => {
    assert.equal(ctx.result.exitCode, 0, `expected exit 0, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── scan-03: an issue already labeled swarm-specced is not re-intaked ───
  registry.define(/^a closed or open issue with label swarm-specced$/, (ctx) => {
    ctx.issue = {
      number: 503,
      url: 'https://github.com/acme/repo/issues/503',
      labels: ['swarm-specced'],
      title: 'Already specced',
      body: 'n/a'
    };
    setupScanFixture(ctx, [ctx.issue]);
  });

  registry.define(/^no new backlog\/GH-<n>-\*\.yaml is created for that issue$/, (ctx) => {
    assert.equal(ctx.result.exitCode, 0, `expected exit 0, got: ${JSON.stringify(ctx.result)}`);
    const files = backlogFilesFor(ctx.clone, ctx.issue.number);
    assert.equal(files.length, 0, `expected no GH-${ctx.issue.number} file, found: ${files.join(',')}`);
  });

  // ── scan-04: parallel intakes both land on main ──────────────────────────
  registry.define(/^two distinct open issues N and M without backlog files$/, (ctx) => {
    const bare = mkBareOrigin();
    seedOrigin(bare);
    ctx.bare = bare;
    ctx.cloneA = cloneWorking(bare);
    ctx.cloneB = cloneWorking(bare);
    ctx.issueN = { number: 601, url: 'https://github.com/acme/repo/issues/601', labels: [], title: 'Race issue N', body: 'n' };
    ctx.issueM = { number: 602, url: 'https://github.com/acme/repo/issues/602', labels: [], title: 'Race issue M', body: 'm' };
    ctx.issuesTsvA = writeIssuesFixture(ctx.cloneA, [ctx.issueN]);
    ctx.issuesTsvB = writeIssuesFixture(ctx.cloneB, [ctx.issueM]);
    ctx.logA = path.join(ctx.cloneA, 'gh-log-a.txt');
    ctx.logB = path.join(ctx.cloneB, 'gh-log-b.txt');
    fs.writeFileSync(ctx.logA, '');
    fs.writeFileSync(ctx.logB, '');
    ctx.fakeGhDir = mkFakeGhBin();
  });

  registry.define(/^two auto-intake workflow runs commit in parallel$/, (ctx) => {
    // Sequential invocations of two INDEPENDENT clones is enough to force
    // the real race: clone A pushes GH-N first, so clone B's own commit of
    // GH-M lands on a now-stale local main - proving out the same
    // pull --rebase --autostash retry a genuinely concurrent pair of
    // scheduled runs would hit, without a flaky real-concurrency test.
    ctx.resultA = runScan(ctx.cloneA, { fakeGhDir: ctx.fakeGhDir, issuesTsvPath: ctx.issuesTsvA, logPath: ctx.logA });
    ctx.resultB = runScan(ctx.cloneB, { fakeGhDir: ctx.fakeGhDir, issuesTsvPath: ctx.issuesTsvB, logPath: ctx.logB });
  });

  registry.define(/^both backlog\/GH-N-\*\.yaml and backlog\/GH-M-\*\.yaml exist on main$/, (ctx) => {
    const verify = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-verify-'));
    execFileSync('git', ['clone', '-q', ctx.bare, verify]);
    const files = fs.readdirSync(path.join(verify, 'backlog'));
    assert.ok(files.some((f) => f.startsWith(`GH-${ctx.issueN.number}-`)), `expected a GH-${ctx.issueN.number} file on main, found: ${files.join(',')}`);
    assert.ok(files.some((f) => f.startsWith(`GH-${ctx.issueM.number}-`)), `expected a GH-${ctx.issueM.number} file on main, found: ${files.join(',')}`);
  });

  registry.define(/^neither workflow fails its push step$/, (ctx) => {
    assert.equal(ctx.resultA.exitCode, 0, `expected run A to succeed, got: ${JSON.stringify(ctx.resultA)}`);
    assert.equal(ctx.resultB.exitCode, 0, `expected run B to succeed, got: ${JSON.stringify(ctx.resultB)}`);
  });

  // ── scan-05: the manual label-triggered intake path still works ─────────
  registry.define(/^the existing swarm-intake\.yml label workflow$/, (ctx) => {
    ctx.labelWorkflow = yaml.load(fs.readFileSync(LABEL_WORKFLOW_PATH, 'utf8'));
  });

  registry.define(/^a human adds the swarm-intake label to an issue$/, (ctx) => {
    // Nothing to execute for real (no live GitHub label event in this test
    // environment) - the Then step below proves both paths call the SAME
    // shared writer, and exercises it directly to demonstrate the shape.
    ctx.sample = { number: 504, url: 'https://github.com/acme/repo/issues/504', title: 'Shape parity check', body: 'body text' };
  });

  registry.define(/^the same GH-N yaml shape is written as the scheduled scan$/, (ctx) => {
    const writeStep = findStepByName(ctx.labelWorkflow, 'Write backlog root item');
    assert.ok(writeStep, 'expected a "Write backlog root item" step in swarm-intake.yml');
    assert.match(
      writeStep.run,
      /github_intake_write\.sh/,
      'expected the label-triggered Write step to call the shared github_intake_write.sh script, not a duplicated inline copy'
    );

    const scanScriptSource = fs.readFileSync(SCAN_SCRIPT, 'utf8');
    assert.match(
      scanScriptSource,
      /github_intake_write\.sh/,
      'expected the scheduled scan script to call the same shared github_intake_write.sh script'
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl560-shape-'));
    fs.mkdirSync(path.join(dir, 'backlog'));
    const file = execFileSync(
      'bash',
      [WRITE_SCRIPT, String(ctx.sample.number), ctx.sample.title, ctx.sample.body, ctx.sample.url],
      { cwd: dir, encoding: 'utf8' }
    ).trim();
    const parsed = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(parsed.id, `GH-${ctx.sample.number}`);
    assert.equal(parsed.source, ctx.sample.url);
    assert.equal(parsed.title, ctx.sample.title);
    assert.equal(parsed.description.trim(), ctx.sample.body);
  });
}

module.exports = { registerSteps };
