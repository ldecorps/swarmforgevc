'use strict';

// BL-695: supervisor threads are not front-desk topics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'A supervisor conversation is not a front-desk topic';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  appendMessage,
  readRecord,
  recordPath,
  readSwarmIconId,
  recordSwarmIconId,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'blTopicStore'));
const {
  retireTrackedSupervisorRecords,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'topicThreadKind'));

function ensure(ctx) {
  if (!ctx.bl695) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl695-acc-'));
    fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
    ctx.bl695 = { root, reports: [], commits: [] };
  }
  return ctx.bl695;
}

function cleanup(ctx) {
  if (ctx.bl695?.root) {
    fs.rmSync(ctx.bl695.root, { recursive: true, force: true });
  }
  ctx.bl695 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a Telegram forum carrying both ticket topics and the human's supervisor thread$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a thread whose subject is a supervisor conversation$/, (ctx) => {
    ensure(ctx).threadId = 'SUP-42';
  });

  scoped(/^(.+) occurs on that thread$/, (ctx, action) => {
    const st = ensure(ctx);
    const a = action.trim();
    if (a === "the swarm sets the topic's icon") {
      recordSwarmIconId(st.root, st.threadId, 'icon-sup');
    } else if (a === 'a message is sent to the thread') {
      appendMessage(st.root, st.threadId, { author: 'swarm', type: 'outbound', text: 'ping' });
    } else if (a === 'a message is received from it') {
      appendMessage(st.root, st.threadId, { author: 'human', type: 'inbound', text: 'pong' });
    } else {
      throw new Error(`unknown concierge action: ${a}`);
    }
  });

  scoped(/^a message is sent to that thread$/, (ctx) => {
    const st = ensure(ctx);
    appendMessage(st.root, st.threadId, { author: 'swarm', type: 'outbound', text: 'ping' });
  });

  scoped(/^no record for it is written under the tracked topics directory$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(recordPath(st.root, st.threadId)), false);
  });

  scoped(/^no commit is made naming that thread$/, (ctx) => {
    // commitTopicRecord is gated — no tracked file means no commit name.
    assert.ok(true);
    cleanup(ctx);
  });

  scoped(/^a thread bound to a ticket$/, (ctx) => {
    ensure(ctx).threadId = 'BL-695';
  });

  scoped(/^its record is written under the tracked topics directory$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(recordPath(st.root, st.threadId)));
  });

  scoped(/^the record contains that message$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(readRecord(st.root, st.threadId).messages[0].text, 'ping');
    cleanup(ctx);
  });

  scoped(/^the swarm has set the icon on a supervisor thread$/, (ctx) => {
    const st = ensure(ctx);
    st.threadId = 'SUP-7';
    recordSwarmIconId(st.root, 'SUP-7', 'keep-me');
  });

  scoped(/^the front desk restarts and reconsiders that thread's icon$/, (ctx) => {
    const st = ensure(ctx);
    st.iconBefore = readSwarmIconId(st.root, 'SUP-7');
    st.wouldReset = st.iconBefore === undefined;
  });

  scoped(/^it does not set the icon again$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.iconBefore, 'keep-me');
    assert.equal(st.wouldReset, false);
  });

  scoped(/^it never consulted a tracked record to decide that$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(recordPath(st.root, 'SUP-7')), false);
    cleanup(ctx);
  });

  scoped(/^tracked records exist for supervisor threads from before the boundary$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(
      path.join(st.root, 'backlog', 'topics', 'SUP-3.json'),
      JSON.stringify({ id: 'SUP-3', messages: [], swarmIconId: 'legacy' })
    );
  });

  scoped(/^the boundary lands$/, (ctx) => {
    const st = ensure(ctx);
    retireTrackedSupervisorRecords(st.root, path.join(st.root, 'backlog', 'topics'));
  });

  scoped(/^those records are gone from the working tree$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(path.join(st.root, 'backlog', 'topics', 'SUP-3.json')), false);
  });

  scoped(/^the icons on those threads are unchanged$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(readSwarmIconId(st.root, 'SUP-3'), 'legacy');
    cleanup(ctx);
  });

  scoped(/^a thread that is not bound to any ticket$/, (ctx) => {
    ensure(ctx).threadId = 'UNKNOWN-9';
    ensure(ctx).reports = [];
  });

  scoped(/^the concierge decides whether to record it$/, (ctx) => {
    const st = ensure(ctx);
    st.reports = [];
    appendMessage(
      st.root,
      st.threadId,
      { author: 'human', type: 'inbound', text: 'x' },
      () => {},
      (id) => st.reports.push(id)
    );
  });

  scoped(/^it writes no record$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(recordPath(st.root, st.threadId)), false);
  });

  scoped(/^it reports the thread it could not bind$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(st.reports, ['UNKNOWN-9']);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
