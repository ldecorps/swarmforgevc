'use strict';

// BL-390: step handlers for "A topic record that did not really change does
// not mint a commit". The amplifier that turned BL-389's redelivery bug into
// 209 commits on origin/main. Drives the REAL compiled persister
// (extension/out/concierge/blTopicStore's appendMessage/commitTopicRecord/
// recordPath) against a real, disposable local git fixture repo - and a
// second local bare repo as a fixture "remote" for scenario 03, never the
// real repo or the real remote, per the ticket's own scope note.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { appendMessage, commitTopicRecord, recordPath } = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkGitRepo() {
  const target = mkTmp('sfvc-bl390-');
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return target;
}

function headOf(repo) {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

const TICKET_ID = 'BL-900';

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a ticket has a topic record$/, (ctx) => {
    ctx.target = mkGitRepo();
    ctx.silent = () => {};
    appendMessage(ctx.target, TICKET_ID, { author: 'human', type: 'inbound', text: 'hello', ts: 1 }, ctx.silent);
    ctx.filePath = recordPath(ctx.target, TICKET_ID);
    ctx.headBefore = headOf(ctx.target);
  });

  // ── a-churn-rewrite-does-not-mint-a-commit-01/03 ─────────────────────
  registry.define(/^the record is rewritten with exactly the content it already had$/, (ctx) => {
    fs.writeFileSync(ctx.filePath, fs.readFileSync(ctx.filePath, 'utf8'));
    ctx.willChange = false;
  });

  // ── a-churn-rewrite-does-not-mint-a-commit-02 ────────────────────────
  registry.define(/^the record is rewritten with a message it did not have$/, (ctx) => {
    const record = JSON.parse(fs.readFileSync(ctx.filePath, 'utf8'));
    record.messages.push({ seq: record.messages.length, ts: 2, author: 'swarm', type: 'outbound', text: 'a genuinely new message' });
    fs.writeFileSync(ctx.filePath, JSON.stringify(record));
    ctx.willChange = true;
  });

  // ── shared When (01/02/03) ───────────────────────────────────────────
  registry.define(/^the swarm persists the record$/, (ctx) => {
    ctx.committed = commitTopicRecord(ctx.target, ctx.filePath, TICKET_ID);
    ctx.headAfter = headOf(ctx.target);
  });

  // ── a-churn-rewrite-does-not-mint-a-commit-01 ────────────────────────
  registry.define(/^no commit is made$/, (ctx) => {
    if (ctx.headAfter !== ctx.headBefore) {
      throw new Error(`expected HEAD to be unchanged (no commit minted for identical content), was ${ctx.headBefore} now ${ctx.headAfter}`);
    }
    if (ctx.committed !== true) {
      throw new Error(`expected the persist call to report the record as already durable (true), got ${ctx.committed}`);
    }
  });

  // ── a-churn-rewrite-does-not-mint-a-commit-02 ────────────────────────
  registry.define(/^the record is committed$/, (ctx) => {
    if (ctx.headAfter === ctx.headBefore) {
      throw new Error('expected a NEW commit for genuinely changed content, but HEAD did not move');
    }
    if (ctx.committed !== true) {
      throw new Error(`expected the persist call to report success, got ${ctx.committed}`);
    }
  });

  // ── a-churn-rewrite-does-not-mint-a-commit-03 ────────────────────────
  registry.define(/^nothing is pushed to the remote$/, (ctx) => {
    const remote = mkTmp('sfvc-bl390-remote-');
    git(remote, ['init', '-q', '--bare']);
    git(ctx.target, ['remote', 'add', 'origin', remote]);
    git(ctx.target, ['push', '-q', 'origin', `${ctx.headBefore}:refs/heads/main`]);
    const remoteHeadBefore = execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    git(ctx.target, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    const remoteHeadAfter = execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    if (remoteHeadAfter !== remoteHeadBefore) {
      throw new Error(`expected nothing new to have been pushed to the remote, remote HEAD moved from ${remoteHeadBefore} to ${remoteHeadAfter}`);
    }
  });
}

module.exports = { registerSteps };
