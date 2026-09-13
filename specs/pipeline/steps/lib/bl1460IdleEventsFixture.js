'use strict';

// BL-1460: fixture for "an idle /events connection receives one snapshot,
// at connect, however many poll ticks elapse". A REAL bridge (startBridge,
// the shipped server) over a throwaway target with one active ticket whose
// title the fixture can rewrite - the same observable effect a real backlog
// commit produces (precedent: bl1351StreamSnapshotFixture's touchActiveItem).
//
// Sweeps its own prefix before the run (BL-971 - a killed run traps
// nothing) and removes its own root in a finally.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const FIXTURE_PREFIX = 'bl1460-idle-events-';
const STALE_AFTER_MS = 10 * 60 * 1000;

const TOKEN = 'bl1460-test-token';
const ACTIVE_ID = 'BL-7460';
const DEFAULT_POLL_MS = 20;
const DEFAULT_KEEPALIVE_MS = 15;

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

function ticketYaml(title) {
  return [
    `id: ${ACTIVE_ID}`,
    `title: "${title}"`,
    'milestone: M8',
    'epic: swarm-reliability',
    'type: defect',
    'priority: 30',
    'human_approval: approved',
    'description: |',
    '  fixture ticket',
    `acceptance: specs/features/whatever-${ACTIVE_ID}.feature`,
    '',
  ].join('\n');
}

function makeFixture() {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ACTIVE_ID}.yaml`), ticketYaml('a fixture ticket'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  return { root, activeId: ACTIVE_ID, runLogPath: path.join(root, 'runs.jsonl') };
}

function removeFixture(fx) {
  if (fx) fs.rmSync(fx.root, { recursive: true, force: true });
}

// Rewrites the active ticket's title - the poll loop's change-detection
// notices this, same as a real backlog commit would.
function touchActiveItem(fx, newTitle) {
  const file = path.join(fx.root, 'backlog', 'active', `${fx.activeId}.yaml`);
  const text = fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, `title: "${newTitle}"`);
  fs.writeFileSync(file, text);
}

async function startFixtureBridge(fx, opts = {}) {
  const { startBridge } = require(path.join(EXT_OUT, 'bridge', 'bridgeServer'));
  return startBridge(fx.root, fx.runLogPath, TOKEN, {
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
    keepaliveIntervalMs: opts.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_MS,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Connects to the real /events route and classifies every frame as it
// arrives (a background pump, not read-on-demand) so a caller can wait for
// a frame COUNT rather than guessing how long a fixed sleep needs to be.
async function connectEvents(handle) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${handle.port}/events`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buffer = '';

  const pumped = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end === -1) break;
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith('data: ')) {
            frames.push({ kind: 'data', payload: block.slice('data: '.length) });
          } else if (block.startsWith(':')) {
            frames.push({ kind: 'keepalive', payload: block });
          } else if (block.length > 0) {
            frames.push({ kind: 'other', payload: block });
          }
        }
      }
    } catch {
      // Aborted by close() - expected, not a fixture failure.
    }
  })();

  function countOf(kind) {
    return frames.filter((f) => f.kind === kind).length;
  }

  return {
    frames,
    countOf,
    async waitForCount(kind, count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (countOf(kind) < count) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${count} "${kind}" frame(s); saw ${countOf(kind)}`);
        }
        await sleep(5);
      }
    },
    async settle(ms) {
      await sleep(ms);
    },
    async close() {
      controller.abort();
      await pumped;
    },
  };
}

module.exports = {
  REPO_ROOT,
  TOKEN,
  ACTIVE_ID,
  DEFAULT_POLL_MS,
  DEFAULT_KEEPALIVE_MS,
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
  sweepStaleFixtures,
  sleep,
};
