'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const {
  parseNamedModelArgs,
  formatPullPlan,
  formatServePlan,
  runNamedModelCli,
  usageText,
  main,
} = require('../out/tools/named-model');
const { buildNamedModelPullPlan, buildNamedModelServePlan } = require('../out/swarm/modelServing');

const EXPECTED_USAGE = [
  'Usage: named-model <pull|serve|status|help> [model-id] [options]',
  '',
  '  pull <model-id>   Compose (or --execute) an ollama pull for that id',
  '  serve <model-id>  Compose (or --execute) an ollama serve when needed',
  '  status            Report loopback OpenAI-compatible endpoint health',
  '',
  'Options:',
  '  --store <path>    Host model store (default: ~/.swarmforge/models/ollama)',
  '  --repo <path>     Tracked worktree root (refuses a store inside it)',
  '  --endpoint <url>  Loopback base URL (default: http://127.0.0.1:11434)',
  '  --execute         Run the composed command instead of printing it',
  '  --present <id>    Treat <id> as already in the store (repeatable)',
  '  --healthy         Treat the endpoint as already healthy (serve reuse)',
].join('\n');

test('parseNamedModelArgs requires a model id for pull', () => {
  assert.throws(() => parseNamedModelArgs(['pull']), /requires a model id/);
});

test('parseNamedModelArgs requires a model id for serve', () => {
  assert.throws(() => parseNamedModelArgs(['serve']), /serve requires a model id/);
});

test('parseNamedModelArgs with no argv defaults to help', () => {
  const args = parseNamedModelArgs([]);
  assert.equal(args.command, 'help');
  assert.equal(args.modelId, '');
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

  const serveMissing = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'missing',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(formatServePlan(serveMissing), `${serveMissing.message}\n${serveMissing.command}`);

  const serveReady = buildNamedModelServePlan('qwen2.5-coder:7b-instruct', {
    endpointStatus: 'healthy',
    endpointUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(serveReady.shouldStartServer, false);
  assert.equal(formatServePlan(serveReady), serveReady.message);
  assert.doesNotMatch(formatServePlan(serveReady), /\n/);
});

test('usageText is the exact operator help surface', () => {
  assert.equal(usageText(), EXPECTED_USAGE);
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

test('parseNamedModelArgs --endpoint preserves prior probe status', () => {
  const args = parseNamedModelArgs([
    'status',
    '--healthy',
    '--endpoint',
    'http://127.0.0.1:11436',
  ]);
  assert.equal(args.probe.endpointStatus, 'healthy');
  assert.equal(args.probe.endpointUrl, 'http://127.0.0.1:11436');
  assert.equal(args.endpointUrl, 'http://127.0.0.1:11436');
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

test('runNamedModelCli default writeErr prints empty-message throws as Error', () => {
  const chunks = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = runNamedModelCli(parseNamedModelArgs(['help']), {
      writeOut: () => {
        throw new Error('');
      },
    });
    assert.equal(code, 1);
    assert.match(chunks.join(''), /Error/);
    assert.match(chunks.join(''), /\n$/);
  } finally {
    process.stderr.write = orig;
  }
});

test('runNamedModelCli default writeErr stringifies a null throw', () => {
  const chunks = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = runNamedModelCli(parseNamedModelArgs(['help']), {
      writeOut: () => {
        throw null;
      },
    });
    assert.equal(code, 1);
    assert.match(chunks.join(''), /null/);
  } finally {
    process.stderr.write = orig;
  }
});

test('runNamedModelCli serve forwards explicit endpointUrl even when probe differs', () => {
  const lines = [];
  const code = runNamedModelCli(
    {
      ...parseNamedModelArgs(['serve', 'qwen2.5-coder:7b-instruct']),
      endpointUrl: 'http://127.0.0.1:18080',
      probe: { endpointStatus: 'missing', endpointUrl: 'http://127.0.0.1:11434' },
    },
    { writeOut: (t) => lines.push(t) }
  );
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /OLLAMA_HOST='127\.0\.0\.1:18080'/);
  assert.doesNotMatch(lines.join('\n'), /11434/);
});

test('main returns 0 for help and 1 for parse errors', () => {
  assert.equal(main(['help']), 0);
  assert.equal(main(['pull']), 1);
});

test('main writes parse errors to stderr with the message body', () => {
  const chunks = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    assert.equal(main(['pull']), 1);
    assert.equal(chunks.join(''), 'pull requires a model id\n');
  } finally {
    process.stderr.write = orig;
  }
});

test('main stringifies a null throw from parse without optional-chain crash', () => {
  const argsMod = require('../out/tools/namedModelCliArgs');
  const origParse = argsMod.parseNamedModelArgs;
  const chunks = [];
  const origErr = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  argsMod.parseNamedModelArgs = () => {
    throw null;
  };
  try {
    assert.equal(main(['help']), 1);
    assert.equal(chunks.join(''), 'null\n');
  } finally {
    argsMod.parseNamedModelArgs = origParse;
    process.stderr.write = origErr;
  }
});

test('main with no argv uses process.argv.slice(2)', () => {
  const origArgv = process.argv;
  const chunks = [];
  const origOut = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  process.argv = ['node', 'named-model.js', 'help'];
  try {
    assert.equal(main(), 0);
    assert.equal(chunks.join('').trimEnd(), EXPECTED_USAGE);
  } finally {
    process.argv = origArgv;
    process.stdout.write = origOut;
  }
});

test('main help uses the default writeOut path', () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    assert.equal(main(['help']), 0);
    assert.equal(chunks.join('').trimEnd(), EXPECTED_USAGE);
  } finally {
    process.stdout.write = orig;
  }
});

test('main --execute uses the default execCommand with bash inherit', () => {
  const calls = [];
  const orig = childProcess.execSync;
  childProcess.execSync = (command, opts) => {
    calls.push({ command, opts });
  };
  try {
    assert.equal(
      main(['pull', 'llama3.1:8b', '--store', '/tmp/bl1082-main-exec', '--execute']),
      0
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].command, /ollama pull .*llama3\.1:8b/);
    assert.equal(calls[0].opts.stdio, 'inherit');
    assert.equal(calls[0].opts.shell, '/bin/bash');
  } finally {
    childProcess.execSync = orig;
  }
});

test('named-model re-exports stay enumerable', () => {
  const mod = require('../out/tools/named-model');
  for (const name of [
    'parseNamedModelArgs',
    'usageText',
    'formatPullPlan',
    'formatServePlan',
    'runNamedModelCli',
  ]) {
    assert.equal(Object.getOwnPropertyDescriptor(mod, name)?.enumerable, true, name);
  }
});
