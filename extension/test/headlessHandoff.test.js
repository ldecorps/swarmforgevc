const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SwarmOrchestrator } = require('../out/orchestrator/SwarmOrchestrator');
const { MessageBus } = require('../out/orchestrator/MessageBus');

const AGENT_A = path.join(__dirname, '../src/orchestrator/headless/agentA.js');
const AGENT_B = path.join(__dirname, '../src/orchestrator/headless/agentB.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarmforge-handoff-'));
}

test('two agents exchange a handoff via MessageBus', async () => {
  const targetPath = makeTmpDir();
  try {
    const orch = new SwarmOrchestrator();
    const outputs = [];
    const exits = [];
    orch.onOutput((role, chunk) => outputs.push({ role, chunk }));
    orch.onAgentExit((role, code) => exits.push({ role, code }));

    // Agent B starts first so it is ready to poll when A writes the message.
    orch.add({ role: 'agent-b', command: 'node', args: [AGENT_B, targetPath] });
    orch.add({ role: 'agent-a', command: 'node', args: [AGENT_A, targetPath] });
    orch.start();
    await orch.waitAll();

    // Both agents should exit successfully.
    const aExit = exits.find((e) => e.role === 'agent-a');
    const bExit = exits.find((e) => e.role === 'agent-b');
    assert.ok(aExit, 'agent-a should have exited');
    assert.ok(bExit, 'agent-b should have exited');
    assert.equal(aExit.code, 0, 'agent-a should exit with code 0');
    assert.equal(bExit.code, 0, 'agent-b should exit with code 0');

    // The message should be acked in the bus.
    const bus = new MessageBus(targetPath);
    const pending = bus.readFor('agent-b');
    assert.equal(pending.length, 0, 'no pending messages should remain for agent-b');

    // Verify output contains expected strings.
    const text = outputs.map((o) => o.chunk).join('');
    assert.ok(text.includes('agent-a: wrote handoff'), `agent-a output missing: ${text}`);
    assert.ok(text.includes('agent-b: acked handoff'), `agent-b output missing: ${text}`);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});
