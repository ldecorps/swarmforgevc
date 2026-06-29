const assert = require('node:assert/strict');
const test = require('node:test');

const { SwarmOrchestrator } = require('../out/orchestrator/SwarmOrchestrator');

test('SwarmOrchestrator streams output from a spawned agent', async () => {
  const orch = new SwarmOrchestrator();
  const outputs = [];
  orch.onOutput((role, chunk) => outputs.push({ role, chunk }));
  orch.add({ role: 'agent-a', command: 'echo', args: ['hello from a'] });
  orch.start();
  await orch.waitAll();
  const text = outputs.map((o) => o.chunk).join('');
  assert.ok(text.includes('hello from a'), `expected output to include "hello from a", got: ${text}`);
});

test('SwarmOrchestrator labels output with role name', async () => {
  const orch = new SwarmOrchestrator();
  const outputs = [];
  orch.onOutput((role, chunk) => outputs.push({ role, chunk }));
  orch.add({ role: 'my-role', command: 'echo', args: ['x'] });
  orch.start();
  await orch.waitAll();
  assert.ok(outputs.every((o) => o.role === 'my-role'));
});

test('SwarmOrchestrator reports agent exit with role and code', async () => {
  const orch = new SwarmOrchestrator();
  const exits = [];
  orch.onAgentExit((role, code) => exits.push({ role, code }));
  orch.add({ role: 'agent-a', command: 'sh', args: ['-c', 'exit 0'] });
  orch.start();
  await orch.waitAll();
  assert.equal(exits.length, 1);
  assert.equal(exits[0].role, 'agent-a');
  assert.equal(exits[0].code, 0);
});

test('SwarmOrchestrator waitAll resolves when all agents exit', async () => {
  const orch = new SwarmOrchestrator();
  orch.add({ role: 'a', command: 'sh', args: ['-c', 'exit 0'] });
  orch.add({ role: 'b', command: 'sh', args: ['-c', 'exit 0'] });
  orch.start();
  await orch.waitAll();
  // reaching here without timeout is the assertion
});

test('SwarmOrchestrator stop kills running agents', async () => {
  const orch = new SwarmOrchestrator();
  const exits = [];
  orch.onAgentExit((role, code) => exits.push({ role, code }));
  orch.add({ role: 'sleeper', command: 'sleep', args: ['60'] });
  orch.start();
  orch.stop();
  await orch.waitAll();
  assert.equal(exits.length, 1);
  assert.equal(exits[0].role, 'sleeper');
});

test('SwarmOrchestrator streams output from multiple agents', async () => {
  const orch = new SwarmOrchestrator();
  const outputs = [];
  orch.onOutput((role, chunk) => outputs.push({ role, chunk }));
  orch.add({ role: 'a', command: 'echo', args: ['from-a'] });
  orch.add({ role: 'b', command: 'echo', args: ['from-b'] });
  orch.start();
  await orch.waitAll();
  const roles = new Set(outputs.map((o) => o.role));
  assert.ok(roles.has('a'));
  assert.ok(roles.has('b'));
  const text = outputs.map((o) => o.chunk).join('');
  assert.ok(text.includes('from-a'));
  assert.ok(text.includes('from-b'));
});
