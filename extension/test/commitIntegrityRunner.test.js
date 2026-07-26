const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runCommitIntegrity, commitIntegrityCliPath } = require('../out/util/commitIntegrityRunner');

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
