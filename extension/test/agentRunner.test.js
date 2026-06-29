const assert = require('node:assert/strict');
const test = require('node:test');

const { AgentRunner } = require('../out/orchestrator/AgentRunner');

test('AgentRunner starts orchestrator and streams output', async () => {
  const runner = new AgentRunner([
    { role: 'printer', displayName: 'Printer', command: 'echo', args: ['hello-runner'] },
  ]);
  const chunks = [];
  runner.getOrchestrator().onOutput((role, chunk) => chunks.push({ role, chunk }));
  runner.start();
  await runner.getOrchestrator().waitAll();
  const text = chunks.map((c) => c.chunk).join('');
  assert.ok(text.includes('hello-runner'));
  assert.equal(chunks[0].role, 'printer');
});

test('AgentRunner getRoles returns configured roles', () => {
  const runner = new AgentRunner([
    { role: 'a', displayName: 'Agent A', command: 'echo', args: [] },
    { role: 'b', displayName: 'Agent B', command: 'echo', args: [] },
  ]);
  const roles = runner.getRoles();
  assert.equal(roles.length, 2);
  assert.equal(roles[0].role, 'a');
  assert.equal(roles[0].displayName, 'Agent A');
  assert.equal(roles[1].role, 'b');
  assert.equal(roles[1].displayName, 'Agent B');
});

test('AgentRunner stop kills agents', async () => {
  const runner = new AgentRunner([
    { role: 'sleeper', displayName: 'Sleeper', command: 'sleep', args: ['60'] },
  ]);
  const exits = [];
  runner.getOrchestrator().onAgentExit((role, code) => exits.push({ role, code }));
  runner.start();
  runner.stop();
  await runner.getOrchestrator().waitAll();
  assert.equal(exits.length, 1);
  assert.equal(exits[0].role, 'sleeper');
});
