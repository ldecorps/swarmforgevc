'use strict';

// BL-1945 (BL-114 stamp-off): step handlers for "GitHub issues that seeded
// backlog items hear back automatically". Drives the REAL
// swarmforge/scripts/issue_specced.sh / issue_done.sh against a fake `gh`
// on PATH that logs its own invocation - the exact fixture shape
// swarmforge/scripts/test/test_issue_intake_loop.sh already establishes,
// never a restatement of the comment/label/close wording.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SPECCED = path.join(SCRIPTS, 'issue_specced.sh');
const DONE = path.join(SCRIPTS, 'issue_done.sh');

const FEATURE = 'GitHub issues that seeded backlog items hear back automatically';

function installWorkingGh(fakeBin, callsLog) {
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'gh'),
    `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(callsLog)}\nexit 0\n`
  );
  fs.chmodSync(path.join(fakeBin, 'gh'), 0o755);
}

function installUnauthenticatedGh(fakeBin) {
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'gh'),
    '#!/usr/bin/env bash\nif [[ "$1" == "auth" && "$2" == "status" ]]; then\n  echo "not logged in" >&2\n  exit 1\nfi\nexit 0\n'
  );
  fs.chmodSync(path.join(fakeBin, 'gh'), 0o755);
}

function runScript(scriptPath, args, fakeBin) {
  const res = require('node:child_process').spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function ensureState(ctx) {
  if (!ctx.bl114) {
    const root = trackedTmpRoot('sfvc-bl114-');
    ctx.bl114 = {
      root,
      fakeBin: path.join(root, 'bin'),
      callsLog: path.join(root, 'gh-calls.log'),
    };
    fs.writeFileSync(ctx.bl114.callsLog, '');
  }
  return ctx.bl114;
}

const FAKE_ISSUE_URL = 'https://github.com/acme/repo/issues/42';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── issue-loop-01: draining a GH item comments and labels the issue ───
  scoped(/^a drained root item with id GH-<n> and a source issue URL$/, (ctx) => {
    const st = ensureState(ctx);
    installWorkingGh(st.fakeBin, st.callsLog);
    st.pausedPath = 'backlog/paused/BL-200-something.yaml';
  });

  scoped(/^the specced helper runs for it$/, (ctx) => {
    const st = ensureState(ctx);
    const result = runScript(SPECCED, [FAKE_ISSUE_URL, st.pausedPath], st.fakeBin);
    st.helperResult = result;
  });

  scoped(/^the issue receives a comment with the spec summary and the paused item path$/, (ctx) => {
    const st = ensureState(ctx);
    const calls = fs.readFileSync(st.callsLog, 'utf8');
    assert.match(calls, /^issue comment https:\/\/github\.com\/acme\/repo\/issues\/42 --body Specced: `backlog\/paused\/BL-200-something\.yaml` is ready in the swarm's paused backlog\.$/m);
    assert.match(st.helperResult.out, /^OK: /m);
  });

  scoped(/^the issue is labeled swarm-specced$/, (ctx) => {
    const st = ensureState(ctx);
    const calls = fs.readFileSync(st.callsLog, 'utf8');
    assert.match(calls, /^issue edit https:\/\/github\.com\/acme\/repo\/issues\/42 --add-label swarm-specced$/m);
  });

  // ── issue-loop-02: completion closes the issue with the merge commit ──
  scoped(/^a GH-<n> item that has been merged and moved to done\/$/, (ctx) => {
    const st = ensureState(ctx);
    installWorkingGh(st.fakeBin, st.callsLog);
    st.mergeCommit = 'a1b2c3d4e5';
  });

  scoped(/^the completion helper runs for it$/, (ctx) => {
    const st = ensureState(ctx);
    st.helperResult = runScript(DONE, [FAKE_ISSUE_URL, st.mergeCommit], st.fakeBin);
  });

  scoped(/^the issue receives a comment naming the merge commit$/, (ctx) => {
    const st = ensureState(ctx);
    const calls = fs.readFileSync(st.callsLog, 'utf8');
    assert.match(calls, /^issue comment https:\/\/github\.com\/acme\/repo\/issues\/42 --body Merged: `a1b2c3d4e5`\.$/m);
    assert.match(st.helperResult.out, /^OK: /m);
  });

  scoped(/^the issue is closed$/, (ctx) => {
    const st = ensureState(ctx);
    const calls = fs.readFileSync(st.callsLog, 'utf8');
    assert.match(calls, /^issue close https:\/\/github\.com\/acme\/repo\/issues\/42$/m);
  });

  // ── issue-loop-03: missing gh auth never blocks the pipeline ──────────
  scoped(/^gh auth is unavailable$/, (ctx) => {
    const st = ensureState(ctx);
    installUnauthenticatedGh(st.fakeBin);
  });

  scoped(/^either helper runs$/, (ctx) => {
    const st = ensureState(ctx);
    st.speccedResult = runScript(SPECCED, [FAKE_ISSUE_URL, 'backlog/paused/BL-200-something.yaml'], st.fakeBin);
    st.doneResult = runScript(DONE, [FAKE_ISSUE_URL, 'a1b2c3d4e5'], st.fakeBin);
  });

  scoped(/^it exits zero without touching GitHub$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.speccedResult.status, 0, `issue_specced.sh must exit 0 when gh auth is unavailable; got: ${st.speccedResult.out}`);
    assert.equal(st.doneResult.status, 0, `issue_done.sh must exit 0 when gh auth is unavailable; got: ${st.doneResult.out}`);
    const calls = fs.existsSync(st.callsLog) ? fs.readFileSync(st.callsLog, 'utf8') : '';
    assert.equal(calls.trim(), '', `no GitHub-mutating call may be made when auth is unavailable; got: ${calls}`);
  });

  scoped(/^the skip is noted in the run log$/, (ctx) => {
    const st = ensureState(ctx);
    assert.match(st.speccedResult.out, /^SKIP: /m);
    assert.match(st.doneResult.out, /^SKIP: /m);
  });
}

module.exports = { registerSteps };
