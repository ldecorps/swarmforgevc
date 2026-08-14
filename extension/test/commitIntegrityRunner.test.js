const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runCommitIntegrity, commitIntegrityCliPath, commitApprovalWrites } = require('../out/util/commitIntegrityRunner');

// runCommitIntegrity is the exec+parse shared by commitExpediteWrites
// (telegram-front-desk-bot.ts, BL-490/BL-538) and commitEpicReorderWrites
// (bridgeServer.ts, BL-572). Both consumers' own tests only ever exercise it
// with a REAL commit_integrity_cli.bb, which either fully succeeds (exit 0,
// {"success":true}) or fails to even run (missing bb/CLI, non-zero exit) -
// never the shape where the CLI process exits 0 but its own JSON says
// success:false. commit_integrity_cli.bb documents "exits non-zero whenever
// :success is false", so that shape should never occur from the REAL CLI -
// but runCommitIntegrity's `result.success === true` check is what turns
// that external contract into an internal guarantee, and nothing pins it
// directly. A fake, minimal .bb standing in for the real CLI drives exactly
// that shape without needing the real commit-with-integrity! machinery.
function mkTargetWithFakeCli(stdoutLine, exitCode) {
  const targetPath = mkTmpDir('sfvc-commit-integrity-runner-');
  const cliPath = commitIntegrityCliPath(targetPath);
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(
    cliPath,
    `#!/usr/bin/env bb\n(println ${JSON.stringify(stdoutLine)})\n(System/exit ${exitCode})\n`
  );
  return targetPath;
}

test('runCommitIntegrity: the CLI exits 0 but its own JSON says success:false - returns false, not true', async () => {
  const targetPath = mkTargetWithFakeCli('{"success":false,"reason":"contract violation"}', 0);
  const result = await runCommitIntegrity(targetPath, ['backlog/paused/BL-1.yaml'], 'msg');
  assert.equal(result, false);
});

test('runCommitIntegrity: the CLI exits 0 with success:true - returns true', async () => {
  const targetPath = mkTargetWithFakeCli('{"success":true}', 0);
  const result = await runCommitIntegrity(targetPath, ['backlog/paused/BL-1.yaml'], 'msg');
  assert.equal(result, true);
});

test('runCommitIntegrity: a non-zero exit degrades to false even when stdout carries valid JSON', async () => {
  const targetPath = mkTargetWithFakeCli('{"success":true}', 1);
  const result = await runCommitIntegrity(targetPath, ['backlog/paused/BL-1.yaml'], 'msg');
  assert.equal(result, false);
});

test('runCommitIntegrity: a missing commit_integrity_cli.bb degrades to false, never throws', async () => {
  const targetPath = mkTmpDir('sfvc-commit-integrity-runner-missing-');
  const result = await runCommitIntegrity(targetPath, ['backlog/paused/BL-1.yaml'], 'msg');
  assert.equal(result, false);
});

// ── commitApprovalWrites (BL-892): shared by every automated
//    human_approval writer (Expedite, paused-pager Approve, Telegram
//    Approve/Reject/Amend) - locates the ticket's CURRENT file via
//    findBacklogFilePath, then pathspec-commits it through the REAL
//    commit_integrity_cli.bb, exactly like commitExpediteWrites/
//    commitEpicReorderWrites already do. ─────────────────────────────────

function gitFixture() {
  const root = mkTmpDir('sfvc-commit-approval-writes-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: root });
  return root;
}

function copyCommitIntegrityScripts(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const repoScriptsDir = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  for (const name of fs.readdirSync(repoScriptsDir)) {
    if (name.endsWith('.bb')) {
      fs.copyFileSync(path.join(repoScriptsDir, name), path.join(scriptsDir, name));
    }
  }
}

test('commitApprovalWrites: commits an active ticket file through the real commit-integrity helper, with the given message', async () => {
  const root = gitFixture();
  copyCommitIntegrityScripts(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-892-fixture.yaml'), 'id: BL-892\ntitle: t\nhuman_approval: approved\n');

  const ok = await commitApprovalWrites(root, 'BL-892', 'Approve BL-892: record human_approval\n\nBy coder.');

  assert.equal(ok, true);
  const log = execFileSync('git', ['log', '-1', '--format=%s', '--', 'backlog/active/BL-892-fixture.yaml'], { cwd: root, encoding: 'utf8' });
  assert.match(log, /Approve BL-892/);
  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], { cwd: root, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'expected backlog/ clean - the edit is now committed');
});

test('commitApprovalWrites: also finds and commits a PAUSED ticket file (not just active/)', async () => {
  const root = gitFixture();
  copyCommitIntegrityScripts(root);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-892-fixture.yaml'), 'id: BL-892\ntitle: t\nhuman_approval: rejected\n');

  const ok = await commitApprovalWrites(root, 'BL-892', 'Reject BL-892: record human_approval\n\nBy coder.');

  assert.equal(ok, true);
  const log = execFileSync('git', ['log', '-1', '--format=%s', '--', 'backlog/paused/BL-892-fixture.yaml'], { cwd: root, encoding: 'utf8' });
  assert.match(log, /Reject BL-892/);
});

test('commitApprovalWrites: returns false (never throws) when the ticket file cannot be found', async () => {
  const root = gitFixture();
  copyCommitIntegrityScripts(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });

  assert.equal(await commitApprovalWrites(root, 'BL-404', 'msg'), false);
});

test('commitApprovalWrites: returns false (never throws) when the commit-integrity CLI is missing entirely', async () => {
  const root = gitFixture();
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-892-fixture.yaml'), 'id: BL-892\ntitle: t\n');

  assert.equal(await commitApprovalWrites(root, 'BL-892', 'msg'), false);
});
