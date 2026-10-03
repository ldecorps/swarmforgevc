'use strict';

// BL-1850: step handlers for "A local-model seat records the settings it
// starts with". Every scenario runs the REAL
// swarmforge/scripts/local_seat_settings_snapshot_cli.bb against a fixture
// root under a tracked mkdtemp (BL-1636), through the CLI's own seams:
// - Ollama is a stub HTTP server in a child process on an ephemeral port
//   (the CLI is run with spawnSync, which blocks this process, so the stub
//   cannot live in it). For "not answering" it accepts and never replies.
// - nvidia-smi and qwen are stub scripts named by --nvidia-smi and --qwen-bin.
// - qwen's user settings come from --qwen-home inside the fixture; the
//   seat's own settings are the fixture worktree's .qwen/settings.json.
// Nothing reads the operator's ~/.qwen, the live Ollama or the real GPU.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1850 A local-model seat records the settings it starts with';
const CLI = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'local_seat_settings_snapshot_cli.bb');
const SEAT = 'coder@iq3';
const MODEL = 'ista-iq3s-coder:latest';

const STUB_SERVER = `
const http = require('http');
const fs = require('fs');
const spec = JSON.parse(process.env.BL1850_SPEC);
const server = http.createServer((req, res) => {
  if (spec.hang) return;
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: spec.version }));
    if (req.url === '/api/show') {
      return res.end(JSON.stringify({
        parameters: 'num_ctx ' + spec.numCtx + '\\nnum_predict ' + spec.numPredict + '\\ntemperature 0.3',
        details: { quantization_level: 'IQ3_S' },
      }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.env.BL1850_PORT_FILE, String(server.address().port)));
`;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fixture(ctx) {
  if (ctx.bl1850) return ctx.bl1850;
  const dir = trackedTmpRoot('sfvc-bl1850-');
  const fx = {
    dir,
    root: path.join(dir, 'root'),
    worktree: path.join(dir, 'worktree'),
    qwenHome: path.join(dir, 'qwen-home'),
    bin: path.join(dir, 'bin'),
    card: path.join(dir, 'card.md'),
    // The settings each start runs with; the scenarios change them.
    ollama: { version: '0.32.15', numCtx: 49152, numPredict: 4096, hang: false },
    gpu: { limitW: 150, defaultW: 180, hang: false },
    provider: { contextWindowSize: 49152, think: false, apiKey: null },
    cardBytes: 3735,
  };
  for (const d of [fx.root, fx.worktree, fx.qwenHome, fx.bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(fx.bin, 'qwen'), '#!/bin/sh\necho 0.24.7\n', { mode: 0o755 });
  ctx.bl1850 = fx;
  return fx;
}

function writeInputs(fx) {
  fs.writeFileSync(fx.card, 'x'.repeat(fx.cardBytes));
  const g = fx.gpu;
  fs.writeFileSync(
    path.join(fx.bin, 'nvidia-smi'),
    `#!/bin/sh\n${g.hang ? 'sleep 30\n' : ''}echo "NVIDIA Fixture GPU, ${g.limitW}.00 W, ${g.defaultW}.00 W"\n`,
    { mode: 0o755 }
  );
  const entry = {
    id: MODEL,
    name: `[Local Ollama] ${MODEL}`,
    baseUrl: 'http://127.0.0.1:11434/v1',
    envKey: 'OLLAMA_API_KEY',
    generationConfig: { contextWindowSize: fx.provider.contextWindowSize, extra_body: { think: fx.provider.think } },
  };
  if (fx.provider.apiKey) entry.apiKey = fx.provider.apiKey;
  fs.mkdirSync(path.join(fx.worktree, '.qwen'), { recursive: true });
  fs.writeFileSync(path.join(fx.worktree, '.qwen', 'settings.json'), JSON.stringify({ modelProviders: { openai: [entry] } }));
}

function recordFile(fx) {
  return path.join(fx.root, '.swarmforge', 'local-agent', 'seat-settings', `${SEAT}.jsonl`);
}

function rows(fx) {
  const file = recordFile(fx);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// One start: the Ollama stub up for the length of the run, then down.
function runSnapshot(fx) {
  writeInputs(fx);
  const portFile = path.join(fx.dir, `port-${Date.now()}-${Math.random()}`);
  const server = spawn(process.execPath, ['-e', STUB_SERVER], {
    env: { ...process.env, BL1850_SPEC: JSON.stringify(fx.ollama), BL1850_PORT_FILE: portFile },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i += 1) sleepMs(25);
    assert.ok(fs.existsSync(portFile), 'the Ollama stub never started');
    const port = fs.readFileSync(portFile, 'utf8').trim();
    const started = Date.now();
    const res = spawnSync(
      'bb',
      [
        CLI, fx.root,
        '--seat', SEAT,
        '--model', MODEL,
        '--endpoint-url', `http://127.0.0.1:${port}/v1`,
        '--card', fx.card,
        '--worktree', fx.worktree,
        '--qwen-home', fx.qwenHome,
        '--nvidia-smi', path.join(fx.bin, 'nvidia-smi'),
        '--qwen-bin', path.join(fx.bin, 'qwen'),
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    fx.last = { status: res.status, elapsedMs: Date.now() - started, out: `${res.stdout || ''}${res.stderr || ''}` };
  } finally {
    server.kill('SIGKILL');
  }
}

// KNOWN_VALUES for the Outlines.
const CHANGES = {
  'nothing changed': () => {},
  'num_ctx 40960': (fx) => {
    fx.ollama.numCtx = 40960;
  },
  'one byte added to the card': (fx) => {
    fx.cardBytes += 1;
  },
  'a lower GPU power limit': (fx) => {
    fx.gpu.limitW -= 10;
  },
};
const FINGERPRINTS = { 'the same as': true, 'different from': false };
const SILENT = {
  Ollama: (fx) => {
    fx.ollama.hang = true;
  },
  'nvidia-smi': (fx) => {
    fx.gpu.hang = true;
  },
};
const FIELDS = { 'Ollama settings': 'ollama', 'GPU settings': 'gpu' };

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^Ollama 0\.32\.15 serves "ista-iq3s-coder:latest" with num_ctx 49152 and num_predict 4096$/, (ctx) => {
    fixture(ctx);
  });

  scoped(/^the seat's qwen settings give that model contextWindowSize 49152 and think false$/, (ctx) => {
    const fx = fixture(ctx);
    assert.deepEqual([fx.provider.contextWindowSize, fx.provider.think], [49152, false]);
  });

  scoped(/^the seat's card is a 3735-byte file$/, (ctx) => {
    assert.equal(fixture(ctx).cardBytes, 3735);
  });

  scoped(/^the GPU reports a 150 W power limit against a 180 W default$/, (ctx) => {
    const fx = fixture(ctx);
    assert.deepEqual([fx.gpu.limitW, fx.gpu.defaultW], [150, 180]);
  });

  scoped(/^the settings snapshot runs for the seat "coder@iq3"$/, (ctx) => {
    const fx = fixture(ctx);
    fx.rowsBefore = rows(fx).length;
    runSnapshot(fx);
  });

  scoped(/^one row is appended to the settings record of "coder@iq3"$/, (ctx) => {
    const fx = fixture(ctx);
    assert.equal(fx.last.status, 0, fx.last.out);
    assert.equal(rows(fx).length, fx.rowsBefore + 1, fx.last.out);
  });

  scoped(/^the row carries num_ctx 49152, num_predict 4096, Ollama 0\.32\.15, contextWindowSize 49152, think false and the card's sha256$/, (ctx) => {
    const fx = fixture(ctx);
    const row = rows(fx).pop();
    assert.equal(row.ollama.parameters.num_ctx, 49152, JSON.stringify(row));
    assert.equal(row.ollama.parameters.num_predict, 4096);
    assert.equal(row.ollama.version, '0.32.15');
    assert.equal(row.qwen.provider.generationConfig.contextWindowSize, 49152);
    assert.equal(row.qwen.provider.generationConfig.extra_body.think, false);
    const sha = require('node:crypto').createHash('sha256').update(fs.readFileSync(fx.card)).digest('hex');
    assert.deepEqual([row.card.bytes, row.card.sha256], [3735, sha]);
  });

  scoped(/^the row carries the GPU power limit 150 W and its default 180 W$/, (ctx) => {
    const row = rows(fixture(ctx)).pop();
    assert.deepEqual([row.gpu.powerLimitW, row.gpu.defaultPowerLimitW], [150, 180], JSON.stringify(row.gpu));
  });

  scoped(/^the seat's first start is already recorded$/, (ctx) => {
    const fx = fixture(ctx);
    runSnapshot(fx);
    assert.equal(rows(fx).length, 1, fx.last.out);
  });

  scoped(/^the seat starts again with (.+)$/, (ctx, change) => {
    const apply = CHANGES[change];
    assert.ok(apply, `unknown <change> token: ${change}`);
    const fx = fixture(ctx);
    apply(fx);
    runSnapshot(fx);
  });

  scoped(/^the new row's fingerprint is (the same as|different from) the first row's$/, (ctx, relation) => {
    const same = FINGERPRINTS[relation];
    const [first, second] = rows(fixture(ctx));
    assert.ok(first && second, 'expected two rows');
    assert.equal(first.fingerprint === second.fingerprint, same, `${first.fingerprint} vs ${second.fingerprint}`);
  });

  scoped(/^the seat's qwen provider entry carries an apiKey value "([^"]+)"$/, (ctx, key) => {
    fixture(ctx).provider.apiKey = key;
    ctx.bl1850.secret = key;
  });

  scoped(/^no row in the settings record contains "([^"]+)"$/, (ctx, key) => {
    const fx = fixture(ctx);
    assert.ok(rows(fx).length >= 1, fx.last.out);
    assert.ok(!fs.readFileSync(recordFile(fx), 'utf8').includes(key), 'the credential reached the record');
  });

  scoped(/^(Ollama|nvidia-smi) is not answering$/, (ctx, source) => {
    SILENT[source](fixture(ctx));
  });

  scoped(/^it exits 0 within 3 seconds$/, (ctx) => {
    const { status, elapsedMs, out } = fixture(ctx).last;
    assert.equal(status, 0, out);
    assert.ok(elapsedMs <= 3000, `took ${elapsedMs} ms`);
  });

  scoped(/^the appended row marks the (Ollama settings|GPU settings) unknown$/, (ctx, fields) => {
    const key = FIELDS[fields];
    const row = rows(fixture(ctx)).pop();
    assert.equal(row[key], 'unknown', JSON.stringify(row));
  });
}

module.exports = { registerSteps };
