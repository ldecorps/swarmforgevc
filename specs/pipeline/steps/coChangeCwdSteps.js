'use strict';

// BL-268: step handlers for the co-change-report cwd-independence feature.
// Drives the REAL compiled CLI as a subprocess against a REAL fixture git
// repo (mirrors coChangeReportCli.test.js's own end-to-end pattern) - a
// green run from the repo root is NOT proof (the whole bug was
// cwd-dependent results), so every scenario here runs the CLI from a
// SUBDIRECTORY.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI_PATH = path.join(EXT_DIR, 'out', 'tools', 'co-change-report.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-cochange-cwd-'));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
}

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, '--min-frequency=3', ...args], { cwd, encoding: 'utf8' });
}

function registerSteps(registry) {
  registry.define(
    /^a git repository whose history has commits that changed files across more than one top-level directory$/,
    (ctx) => {
      ctx.root = mkTmp();
      git(ctx.root, ['init', '-q']);
      git(ctx.root, ['config', 'user.email', 't@t']);
      git(ctx.root, ['config', 'user.name', 't']);
      commitFiles(ctx.root, { 'dirA/target.ts': '1', 'dirB/other.ts': '1' });
      commitFiles(ctx.root, { 'dirA/target.ts': '2', 'dirB/other.ts': '2' });
      commitFiles(ctx.root, { 'dirA/target.ts': '3', 'dirB/other.ts': '3' });
    }
  );

  // ── co-change-cwd-independence-01 ────────────────────────────────────
  registry.define(/^a file that has historically co-changed with files in other top-level directories$/, (ctx) => {
    ctx.targetFileRepoRelative = 'dirA/target.ts';
    ctx.targetFileCwdRelative = 'target.ts'; // when cwd is dirA/
  });

  registry.define(/^the co-change report for it runs from a repository subdirectory$/, (ctx) => {
    ctx.fromSubdir = runCli(path.join(ctx.root, 'dirA'), [ctx.targetFileCwdRelative]);
  });

  registry.define(/^the report lists the cross-directory co-changers with their co-change counts$/, (ctx) => {
    if (!/dirB\/other\.ts: 3 co-change\(s\)/.test(ctx.fromSubdir)) {
      throw new Error(`expected the cross-directory co-changer dirB/other.ts to be listed; got: ${ctx.fromSubdir}`);
    }
  });

  registry.define(/^the report is identical to running it from the repository root$/, (ctx) => {
    const fromRoot = runCli(ctx.root, [ctx.targetFileRepoRelative]);
    if (fromRoot !== ctx.fromSubdir) {
      throw new Error(`expected the subdirectory run to match the root run; root:\n${fromRoot}\nsubdir:\n${ctx.fromSubdir}`);
    }
  });

  // ── co-change-cwd-independence-02 ────────────────────────────────────
  registry.define(/^a tracked file addressed by a path relative to a repository subdirectory$/, (ctx) => {
    ctx.targetFileCwdRelative = 'target.ts';
  });

  registry.define(/^the argument resolves to its repo-relative history path and its co-changers are reported$/, (ctx) => {
    const output = ctx.fromSubdir;
    if (!/^dirA\/target\.ts:/m.test(output)) {
      throw new Error(`expected the report to key on the repo-relative path "dirA/target.ts"; got: ${output}`);
    }
    if (!/dirB\/other\.ts: 3 co-change\(s\)/.test(output)) {
      throw new Error(`expected co-changers to be reported after path resolution; got: ${output}`);
    }
  });
}

module.exports = { registerSteps };
