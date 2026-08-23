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

test('parseNamedModelArgs rejects unknown flags and missing flag values', () => {
  assert.throws(() => parseNamedModelArgs(['pull', 'm', '--nope']), /Unknown flag/);
  assert.throws(() => parseNamedModelArgs(['pull', 'm', '--store']), /--store requires a value/);
  assert.throws(() => parseNamedModelArgs(['pull', 'm', '--repo', '--execute']), /--repo requires a value/);
});

test('parseNamedModelArgs rejects unknown commands', () => {
  assert.throws(() => parseNamedModelArgs(['explode', 'm']), /Unknown command/);
});

test('parseNamedModelArgs accepts --repo --endpoint --execute and --healthy', () => {
  const args = parseNamedModelArgs([
    'serve',
    'qwen2.5-coder:7b-instruct',
    '--repo',
    '/tmp/repo',
    '--endpoint',
    'http://127.0.0.1:11435',
    '--execute',
    '--healthy',
  ]);
  assert.equal(args.repoRoot, '/tmp/repo');
  assert.equal(args.endpointUrl, 'http://127.0.0.1:11435');
  assert.equal(args.execute, true);
  assert.equal(args.probe.endpointStatus, 'healthy');
  assert.equal(args.probe.endpointUrl, 'http://127.0.0.1:11435');
});

test('runNamedModelCli help and status cover ready and not-ready exits', () => {
  const helpLines = [];
  assert.equal(runNamedModelCli(parseNamedModelArgs(['help']), { writeOut: (t) => helpLines.push(t) }), 0);
  assert.match(helpLines.join('\n'), /Usage:/);

  const missing = [];
  assert.equal(
    runNamedModelCli(parseNamedModelArgs(['status']), { writeOut: (t) => missing.push(t) }),
    1
  );
  assert.match(missing.join('\n'), /not ready/i);

  const ready = [];
  assert.equal(
    runNamedModelCli(parseNamedModelArgs(['status', '--healthy']), { writeOut: (t) => ready.push(t) }),
    0
  );
  assert.match(ready.join('\n'), /^ready at /);
});

test('runNamedModelCli serve --execute invokes ollama serve when missing', () => {
  const executed = [];
  const code = runNamedModelCli(
    parseNamedModelArgs(['serve', 'llama3.1:8b', '--execute']),
    {
      writeOut: () => {},
      execCommand: (command) => executed.push(command),
    }
  );
  assert.equal(code, 0);
  assert.equal(executed.length, 1);
  assert.match(executed[0], /ollama serve/);
});

test('runNamedModelCli reports planner errors on stderr and exits 1', () => {
  const errs = [];
  const code = runNamedModelCli(
    {
      ...parseNamedModelArgs(['pull', 'ghost:0b']),
      availableModelIds: ['qwen2.5-coder:7b-instruct'],
    },
    { writeOut: () => {}, writeErr: (t) => errs.push(t) }
  );
  assert.equal(code, 1);
  assert.match(errs.join('\n'), /ghost:0b/);
});

test('runNamedModelCli --execute without execCommand dep fails loudly', () => {
  const errs = [];
  const code = runNamedModelCli(parseNamedModelArgs(['pull', 'llama3.1:8b', '--execute']), {
    writeOut: () => {},
    writeErr: (t) => errs.push(t),
  });
  assert.equal(code, 1);
  assert.match(errs.join('\n'), /no execCommand/);
});

test('main returns 0 for help and 1 for parse errors', () => {
  const { main } = require('../out/tools/named-model');
  assert.equal(main(['help']), 0);
  assert.equal(main(['pull']), 1);
});
