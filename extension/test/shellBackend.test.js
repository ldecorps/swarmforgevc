const assert = require('node:assert/strict');
const test = require('node:test');

const { ShellBackend } = require('../out/orchestrator/ShellBackend');

test('ShellBackend streams stdout through onData', async () => {
  const chunks = [];
  const proc = new ShellBackend('echo', ['hello world']);
  proc.onData((chunk) => chunks.push(chunk));
  await new Promise((resolve) => proc.onExit(resolve));
  assert.ok(chunks.join('').includes('hello world'));
});

test('ShellBackend reports exit code via onExit', async () => {
  const proc = new ShellBackend('sh', ['-c', 'exit 42']);
  const code = await new Promise((resolve) => proc.onExit(resolve));
  assert.equal(code, 42);
});

test('ShellBackend kill terminates the process', async () => {
  const proc = new ShellBackend('sleep', ['60']);
  let exitCode;
  const done = new Promise((resolve) => proc.onExit((code) => { exitCode = code; resolve(); }));
  proc.kill();
  await done;
  assert.ok(exitCode !== 0 || exitCode === null);
});

test('ShellBackend write sends data to stdin', async () => {
  const chunks = [];
  const proc = new ShellBackend('cat', []);
  proc.onData((chunk) => chunks.push(chunk));
  proc.write('ping\n');
  proc.write('\x04'); // EOF (Ctrl-D)
  await new Promise((resolve) => proc.onExit(resolve));
  assert.ok(chunks.join('').includes('ping'));
});
