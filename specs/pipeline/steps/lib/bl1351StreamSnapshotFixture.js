'use strict';

// BL-1351: the fixture the "/events carries only what consumers read" feature
// drives. A REAL bridge (startBridge, the shipped server) over a throwaway
// target whose backlog holds 1223 items, each with the long description and
// notes bodies that made the live frame 6.7 MB.
//
// The fixture never reads the real backlog/ (a size assertion that moves with
// this repo is not a gate), builds its items in a temp dir removed in a
// finally, and sweeps its own prefix before the run (BL-971 - a killed run
// traps nothing).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const FIXTURE_PREFIX = 'bl1351-acceptance-';
const STALE_AFTER_MS = 10 * 60 * 1000;

const TOKEN = 'bl1351-test-token';
const DONE_ITEMS = 1200;
const PAUSED_ITEMS = 20;
const ACTIVE_ITEMS = 3;
// Long enough that the pre-fix frame is far over budget: 1223 items x ~5 KB of
// prose is the ~6.7 MB the live measurement saw.
const LONG_BODY = 'prose that nothing on the stream ever displays. '.repeat(60);

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}

function ticketYaml(id, folder) {
  return [
    `id: ${id}`,
    `title: "a ticket in ${folder}"`,
    'milestone: M8',
    'epic: swarm-reliability',
    'type: defect',
    'priority: 30',
    'human_approval: approved',
    `description: |`,
    `  ${LONG_BODY}`,
    `notes: |`,
    `  ${LONG_BODY}`,
    `acceptance: specs/features/whatever-${id}.feature`,
    `approval_context: |`,
    `  ${LONG_BODY}`,
    '',
  ].join('\n');
}

function makeFixture() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const write = (folder, id) => {
    const dir = path.join(root, 'backlog', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.yaml`), ticketYaml(id, folder));
  };
  for (let i = 0; i < DONE_ITEMS; i += 1) write(path.join('done', 'M8'), `BL-${9000 + i}`);
  for (let i = 0; i < PAUSED_ITEMS; i += 1) write('paused', `BL-${8000 + i}`);
  const activeIds = [];
  for (let i = 0; i < ACTIVE_ITEMS; i += 1) {
    const id = `BL-${7000 + i}`;
    write('active', id);
    activeIds.push(id);
  }
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  return { root, activeIds, runLogPath: path.join(root, 'runs.jsonl') };
}

function removeFixture(fx) {
  if (fx) fs.rmSync(fx.root, { recursive: true, force: true });
}

// Rewrites one active ticket's title, which is what the poll loop's
// change-detection notices - a real backlog commit's observable effect.
function touchActiveItem(fx, id, newTitle) {
  const file = path.join(fx.root, 'backlog', 'active', `${id}.yaml`);
  const text = fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, `title: "${newTitle}"`);
  fs.writeFileSync(file, text);
}

async function startFixtureBridge(fx) {
  const { startBridge } = require(path.join(EXT_OUT, 'bridge', 'bridgeServer'));
  return startBridge(fx.root, fx.runLogPath, TOKEN, { pollIntervalMs: 20 });
}

// Connects to the real /events route and reads frames as they arrive. Returns
// a reader whose `next()` resolves with the next complete `data:` snapshot
// frame (comments and named events are skipped - a keepalive is not a
// snapshot).
async function connectEvents(handle) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${handle.port}/events`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pending = [];

  function drain() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end === -1) return;
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith('data: ')) pending.push(block.slice('data: '.length));
    }
  }

  return {
    async next(timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        drain();
        if (pending.length) return pending.shift();
        if (Date.now() > deadline) throw new Error('no snapshot frame arrived before the deadline');
        const { done, value } = await reader.read();
        if (done) throw new Error('the stream closed before a snapshot arrived');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close() {
      controller.abort();
    },
  };
}

module.exports = {
  REPO_ROOT,
  TOKEN,
  DONE_ITEMS,
  PAUSED_ITEMS,
  ACTIVE_ITEMS,
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
  sweepStaleFixtures,
};
