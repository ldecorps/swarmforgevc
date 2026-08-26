const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseExpediteProgressRaw,
  parseActiveTicketYaml,
  formatExpediteUpdate,
  formatSwarmUpdate,
  formatUpdateMessage,
  collectUpdateSnapshot,
  readExpediteProgress,
  readActiveTickets,
} = require('../out/tools/telegramCursorBridgeUpdate');
const { beginActiveRun, endActiveRun } = require('../out/bridge/cursorBridgeRunTracker');

function mkRoot() {
  const root = mkTmpDir('sf-update-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('parseExpediteProgressRaw accepts expedite progress.json shape', () => {
  assert.deepEqual(
    parseExpediteProgressRaw({
      ticket: 'BL-696',
      stage: 'specifier',
      status: 'running',
      detail: 'stage 1/7',
      line: '[BL-696] 📝 specifier — running\nstage 1/7',
      'updated-at-ms': 1000,
    }),
    {
      ticket: 'BL-696',
      stage: 'specifier',
      status: 'running',
      detail: 'stage 1/7',
      line: '[BL-696] 📝 specifier — running\nstage 1/7',
      updatedAtMs: 1000,
    }
  );
  assert.equal(parseExpediteProgressRaw(null), undefined);
});

test('parseActiveTicketYaml extracts id role and title', () => {
  const yaml = ['id: BL-696', 'title: "Console Mini App"', 'assigned_to: specifier', ''].join('\n');
  assert.deepEqual(parseActiveTicketYaml(yaml), {
    id: 'BL-696',
    assignedTo: 'specifier',
    title: 'Console Mini App',
  });
});

test('formatUpdateMessage summarizes agent, expedite, and swarm work', () => {
  const text = formatUpdateMessage({
    agentRun: { prompt: 'fix the notifier', startedAtMs: 1_000, progressLines: ['🔧 edit'] },
    bridgeBusy: true,
    expedite: {
      ticket: 'BL-696',
      line: '[BL-696] 📝 specifier — running\nstage 1/7',
      updatedAtMs: 30_000,
    },
    redeployPid: 42,
    activeTickets: [{ id: 'BL-696', assignedTo: 'specifier', title: 'Lets Talk' }],
    nowMs: 61_000,
  });
  assert.match(text, /Agent run in progress/);
  assert.match(text, /fix the notifier/);
  assert.match(text, /Expedite BL-696/);
  assert.match(text, /specifier — running/);
  assert.match(text, /Redeploy running \(pid 42\)/);
  assert.match(text, /Swarm: working/);
  assert.match(text, /BL-696 @ specifier/);
});

test('formatUpdateMessage reports swarm sleeping when backlog is empty', () => {
  const text = formatUpdateMessage({ bridgeBusy: false, activeTickets: [], nowMs: 1 });
  assert.match(text, /Cursor agent: idle/);
  assert.match(text, /Swarm: sleeping/);
  assert.doesNotMatch(text, /Expedite|Redeploy|Agent run in progress|Swarm: working/);
});

test('formatExpediteUpdate and formatSwarmUpdate cover fallbacks', () => {
  assert.match(
    formatExpediteUpdate({ ticket: 'BL-1', stage: 'coder', status: 'running', detail: 'stage 2/7' }, 10_000),
    /coder — running/
  );
  assert.equal(formatSwarmUpdate([]), 'Swarm: sleeping');
  assert.match(
    formatSwarmUpdate([
      { id: 'BL-1', assignedTo: 'coder' },
      { id: 'BL-2' },
      { id: 'BL-3' },
      { id: 'BL-4' },
      { id: 'BL-5' },
      { id: 'BL-6' },
    ]),
    /and 1 more/
  );
});

test('collectUpdateSnapshot reads expedite progress and active tickets from disk', () => {
  const root = mkRoot();
  const progressDir = path.join(root, '.swarmforge', 'expedite', 'BL-696');
  fs.mkdirSync(progressDir, { recursive: true });
  fs.writeFileSync(
    path.join(progressDir, 'progress.json'),
    JSON.stringify({
      ticket: 'BL-696',
      stage: 'specifier',
      status: 'running',
      detail: 'stage 1/7',
      line: '[BL-696] specifier running',
      'updated-at-ms': Date.now(),
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'expedite-bridge.lock'),
    `${JSON.stringify({ ticket: 'BL-696', pid: process.pid })}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-696-test.yaml'),
    'id: BL-696\ntitle: "Lets Talk"\nassigned_to: specifier\n',
    'utf8'
  );
  beginActiveRun('ship it');
  try {
    const snapshot = collectUpdateSnapshot(root, false);
    assert.equal(snapshot.expedite?.ticket, 'BL-696');
    assert.equal(snapshot.activeTickets[0]?.id, 'BL-696');
    assert.ok(snapshot.agentRun);
    assert.match(formatUpdateMessage(snapshot), /Expedite BL-696/);
    assert.equal(readExpediteProgress(root)?.stage, 'specifier');
    assert.equal(readActiveTickets(root).length, 1);
  } finally {
    endActiveRun();
  }
});
