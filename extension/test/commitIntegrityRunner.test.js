const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runCommitIntegrity, commitIntegrityCliPath, commitApprovalWrites } = require('../out/util/commitIntegrityRunner');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

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
  // BL-1039: the seeded repository comes from the shared fixture - one
  // seeding per RUN instead of init+config+commit per scenario. Four
  // process spawns before the behaviour under test was even reached,
  // repeated across every test in this file. Measured 190ms -> 33ms.
  copySeededRepoInto(root);
  return root;
}

// BL-1038: copies commit_integrity_cli.bb's load-file CLOSURE (11 files),
// not the whole live scripts directory - see pinnedRepoFixture.js for why.
function copyCommitIntegrityScripts(root) {
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
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

// BL-1091: Expedite rename must pathspec-commit the paused/ source deletion
// alongside the active/ destination. extras land through uniqueRelPaths.
test('BL-1091: commitApprovalWrites pathspecs destination plus rename source', async () => {
  const root = gitFixture();
  copyCommitIntegrityScripts(root);
  const pausedDir = path.join(root, 'backlog', 'paused');
  const activeDir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(pausedDir, { recursive: true });
  fs.mkdirSync(activeDir, { recursive: true });
  const pausedFile = path.join(pausedDir, 'BL-1091-fixture.yaml');
  const activeFile = path.join(activeDir, 'BL-1091-fixture.yaml');
  fs.writeFileSync(pausedFile, 'id: BL-1091\ntitle: t\nhuman_approval: pending\n');
  execFileSync('git', ['add', '-A', 'backlog'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed BL-1091'], { cwd: root });
  fs.renameSync(pausedFile, activeFile);
  fs.writeFileSync(activeFile, 'id: BL-1091\ntitle: t\nhuman_approval: approved\n');

  const ok = await commitApprovalWrites(root, 'BL-1091', 'Expedite BL-1091\n\nBy coder.', [pausedFile]);
  assert.equal(ok, true);
  const names = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(names, /backlog\/paused\/BL-1091/);
  assert.match(names, /backlog\/active\/BL-1091/);
  const status = execFileSync('git', ['status', '--porcelain', '--', 'backlog'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(status.trim(), '');
});

// uniqueRelPaths must drop empty relatives and dedupe — otherwise pathspec
// lists grow vacuous duplicates (Stryker ConditionalExpression / LogicalOperator
// on the `rel && !includes` guard).
test('BL-1091: uniqueRelPaths dedupes extras and drops empty relatives', async () => {
  const targetPath = mkTmpDir('sfvc-bl1091-unique-');
  const cliPath = commitIntegrityCliPath(targetPath);
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  const seenPath = path.join(targetPath, 'seen-paths.txt');
  fs.writeFileSync(
    cliPath,
    `#!/usr/bin/env bb
(require '[clojure.string :as str])
(let [args *command-line-args*
      paths (loop [xs args acc []]
              (cond
                (empty? xs) acc
                (= (first xs) "--path") (recur (drop 2 xs) (conj acc (second xs)))
                :else (recur (rest xs) acc)))]
  (spit ${JSON.stringify(seenPath)} (str/join "\\n" paths))
  (println "{\\"success\\":true}")
  (System/exit 0))
`
  );
  fs.mkdirSync(path.join(targetPath, 'backlog', 'active'), { recursive: true });
  const file = path.join(targetPath, 'backlog', 'active', 'BL-1091-dedupe.yaml');
  fs.writeFileSync(file, 'id: BL-1091\ntitle: t\n');
  // Same abs twice + targetPath itself (relative "") must collapse to one --path.
  const ok = await commitApprovalWrites(targetPath, 'BL-1091', 'msg', [file, targetPath]);
  assert.equal(ok, true);
  const seen = fs.readFileSync(seenPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.deepEqual(seen, ['backlog/active/BL-1091-dedupe.yaml']);
});
