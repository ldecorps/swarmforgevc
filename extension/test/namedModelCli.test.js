'use strict';

const assert = require('node:assert/strict');
const {
  parseNamedModelArgs,
  formatPullPlan,
  formatServePlan,
  runNamedModelCli,
  usageText,
} = require('../out/tools/named-model');
const { buildNamedModelPullPlan, buildNamedModelServePlan } = require('../out/swarm/modelServing');

test('parseNamedModelArgs requires a model id for pull', () => {
  assert.throws(() => parseNamedModelArgs(['pull']), /requires a model id/);
});

test('parseNamedModelArgs accepts pull with --present and --store', () => {
  const args = parseNamedModelArgs([
    'pull',
    'qwen2.5-coder:7b-instruct',
    '--store',
    '/tmp/models',
    '--present',
    'qwen2.5-coder:7b-instruct',
  ]);
  assert.equal(args.command, 'pull');
  assert.equal(args.modelId, 'qwen2.5-coder:7b-instruct');
  assert.equal(args.modelStorePath, '/tmp/models');
  assert.deepEqual(args.presentModelIds, ['qwen2.5-coder:7b-instruct']);
});

test('runNamedModelCli pull prints a composed ollama pull without executing', () => {
  const lines = [];
  const code = runNamedModelCli(
    parseNamedModelArgs(['pull', 'llama3.1:8b', '--store', '/tmp/bl1082-cli-store']),
    { writeOut: (t) => lines.push(t) }
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ollama pull .*llama3\.1:8b/);
});

test('runNamedModelCli serve reuses a healthy endpoint', () => {
  const lines = [];
  const code = runNamedModelCli(
    parseNamedModelArgs(['serve', 'qwen2.5-coder:7b-instruct', '--healthy']),
    { writeOut: (t) => lines.push(t) }
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ready at/);
  assert.doesNotMatch(lines.join('\n'), /ollama serve/);
});

test('runNamedModelCli pull --execute invokes the composed command', () => {
  const executed = [];
  const code = runNamedModelCli(
    parseNamedModelArgs(['pull', 'llama3.1:8b', '--store', '/tmp/bl1082-cli-store', '--execute']),
    {
      writeOut: () => {},
      execCommand: (command) => executed.push(command),
    }
  );
  assert.equal(code, 0);
  assert.equal(executed.length, 1);
  assert.match(executed[0], /ollama pull .*llama3\.1:8b/);
});

test('formatPullPlan and formatServePlan mirror planner fields', () => {
  const pull = buildNamedModelPullPlan('qwen2.5-coder:7b-instruct', {
    presentModelIds: ['qwen2.5-coder:7b-instruct'],
  });
  assert.equal(formatPullPlan(pull), pull.message);

  const serve = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'missing',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.match(formatServePlan(serve), /ollama serve/);
});

test('usageText names the three operator commands', () => {
  assert.match(usageText(), /pull/);
  assert.match(usageText(), /serve/);
  assert.match(usageText(), /status/);
});
