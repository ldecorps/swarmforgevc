'use strict';

// BL-1850 declared invariants (coder first authorship - BL-654):
//   1. "Recording a seat's settings never stops its start: any failure is
//       logged, the seat starts, and the recorder takes at most 3 seconds."
//   2. "The settings record never holds a credential value: apiKey and every
//       key naming a token, secret or password are dropped before writing."
//
// Both run the REAL swarmforge/scripts/local_seat_settings_snapshot_cli.bb
// once per draw, through its seams, against a fixture under mkdtemp. Ollama
// is a stub server in a child process, nvidia-smi and qwen are stub
// scripts, and qwen's user settings come from --qwen-home.
//
// Invariant 1: each source fails in a drawn way.
// - Ollama answers, hangs, refuses the connection, returns 500, or returns
//   malformed JSON.
// - nvidia-smi answers, hangs, is missing, exits 1, or prints garbage.
// - qwen answers, hangs, or is missing.
// - The seat's settings file is valid or malformed.
// - The card is present or missing.
// - The record's directory is writable or not.
// The CLI must exit 0 within 3 s, and when anything fails it must say so
// on stderr. "The seat starts" is the launch line's own `|| true`, pinned
// by test_bl1850_seat_settings_snapshot_via_launch_script.sh.
// Reach floor: the all-hang worst case, an unwritable record, and a clean
// run all occur.
//
// Invariant 2: secrets are planted in the provider entry qwen uses (the
// workspace list, or the user list when the workspace has none) and in
// chatCompression. They sit under credential keys of every spelling the
// rule names (apiKey, API_KEY, accessToken, refresh_token, clientSecret,
// SECRET_X, password, dbPassword), at a drawn depth (0-3, inside maps and
// lists). No secret may appear in the record, and every non-credential
// value placed beside it must (the entry is not simply dropped whole).
// Collision construction: each secret's key is built from a non-credential
// sibling's name plus a credential word (`tokenizer` beside `apiTokenizer`
// would be one; here, `timeout` beside `timeoutSecret`), so a rule that
// matched only exact names would let it through.
//
// Non-vacuity:
// - With drop-credentials returning its input unchanged, invariant 2 fails
//   ("secret ... reached the record").
// - With the probe deadline raised to 10 s, invariant 1 fails on the
//   all-hang example ("took ...").
// Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const CLI = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_seat_settings_snapshot_cli.bb');
const MODEL = 'm:latest';

const STUB_SERVER = `
const http = require('http');
const fs = require('fs');
const mode = process.env.MODE;
const server = http.createServer((req, res) => {
  if (mode === 'hang') return;
  req.resume();
  req.on('end', () => {
    if (mode === 'error') { res.statusCode = 500; return res.end('boom'); }
    if (mode === 'malformed') return res.end('{not json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '9.9.9' }));
    return res.end(JSON.stringify({ parameters: 'num_ctx 1024', details: { quantization_level: 'Q4' } }));
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.env.PORT_FILE, String(server.address().port)));
`;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stub(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// Runs the CLI once; ollamaMode 'refused' starts no server.
function runOnce(dir, { ollamaMode, nvidia, qwen, workspaceSettings, userSettings, cardPresent, recordWritable }) {
  const root = path.join(dir, 'root');
  const wt = path.join(dir, 'wt');
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'bin');
  for (const d of [root, path.join(wt, '.qwen'), home, bin]) fs.mkdirSync(d, { recursive: true });
  const card = path.join(dir, 'card.md');
  if (cardPresent) fs.writeFileSync(card, 'card');
  if (workspaceSettings !== undefined) fs.writeFileSync(path.join(wt, '.qwen', 'settings.json'), workspaceSettings);
  if (userSettings !== undefined) fs.writeFileSync(path.join(home, 'settings.json'), userSettings);
  const nvidiaBody = {
    ok: 'echo "GPU, 150.00 W, 180.00 W"',
    hang: 'sleep 30',
    fail: 'exit 1',
    garbage: 'echo nonsense',
  }[nvidia];
  if (nvidiaBody) stub(path.join(bin, 'nvidia-smi'), nvidiaBody);
  const qwenBody = { ok: 'echo 0.24.7', hang: 'sleep 30' }[qwen];
  if (qwenBody) stub(path.join(bin, 'qwen'), qwenBody);
  const recordDir = path.join(root, '.swarmforge', 'local-agent', 'seat-settings');
  if (!recordWritable) {
    fs.mkdirSync(path.dirname(recordDir), { recursive: true });
    fs.writeFileSync(recordDir, 'a file where the record directory should be');
  }

  let server = null;
  let port = '1';
  if (ollamaMode !== 'refused') {
    const portFile = path.join(dir, 'port');
    server = spawn(process.execPath, ['-e', STUB_SERVER], { env: { ...process.env, MODE: ollamaMode, PORT_FILE: portFile }, stdio: 'ignore' });
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i += 1) sleepMs(25);
    port = fs.readFileSync(portFile, 'utf8').trim();
  }
  try {
    const started = Date.now();
    const res = spawnSync(
      'bb',
      [CLI, root, '--seat', 's', '--model', MODEL, '--endpoint-url', `http://127.0.0.1:${port}/v1`,
        '--card', card, '--worktree', wt, '--qwen-home', home,
        '--nvidia-smi', path.join(bin, 'nvidia-smi'), '--qwen-bin', path.join(bin, 'qwen')],
      { encoding: 'utf8', timeout: 30000 }
    );
    const recordFile = path.join(recordDir, 's.jsonl');
    const record = recordWritable && fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8') : '';
    return { status: res.status, elapsedMs: Date.now() - started, stderr: res.stderr || '', record };
  } finally {
    if (server) server.kill('SIGKILL');
  }
}

const providerSettings = JSON.stringify({ modelProviders: { openai: [{ id: MODEL, generationConfig: { contextWindowSize: 1 } }] } });

test(
  'BL-1850/BL-654 invariant 1: the recorder never holds a start - exit 0 within 3 s, every failure logged',
  () => {
    const reach = { allHang: 0, unwritable: 0, clean: 0 };
    const draw = fc.record({
      ollamaMode: fc.constantFrom('ok', 'hang', 'refused', 'error', 'malformed'),
      nvidia: fc.constantFrom('ok', 'hang', 'missing', 'fail', 'garbage'),
      qwen: fc.constantFrom('ok', 'hang', 'missing'),
      workspaceSettings: fc.constantFrom(providerSettings, '{malformed'),
      cardPresent: fc.boolean(),
      recordWritable: fc.boolean(),
    });
    const examples = [
      [{ ollamaMode: 'hang', nvidia: 'hang', qwen: 'hang', workspaceSettings: '{malformed', cardPresent: false, recordWritable: true }],
      [{ ollamaMode: 'ok', nvidia: 'ok', qwen: 'ok', workspaceSettings: providerSettings, cardPresent: true, recordWritable: false }],
      [{ ollamaMode: 'ok', nvidia: 'ok', qwen: 'ok', workspaceSettings: providerSettings, cardPresent: true, recordWritable: true }],
      // One failure at a time, so no other source's log can stand in for it.
      ...['fail', 'garbage', 'missing'].map((nvidia) => [{ ollamaMode: 'ok', nvidia, qwen: 'ok', workspaceSettings: providerSettings, cardPresent: true, recordWritable: true }]),
      ...['error', 'malformed', 'refused'].map((ollamaMode) => [{ ollamaMode, nvidia: 'ok', qwen: 'ok', workspaceSettings: providerSettings, cardPresent: true, recordWritable: true }]),
      [{ ollamaMode: 'ok', nvidia: 'ok', qwen: 'missing', workspaceSettings: providerSettings, cardPresent: true, recordWritable: true }],
    ];
    fc.assert(
      fc.property(draw, (d) => {
        const r = runOnce(mkTmpDir('sfvc-bl1850-inv1-'), d);
        assert.equal(r.status, 0, `${JSON.stringify(d)}\n${r.stderr}`);
        assert.ok(r.elapsedMs <= 3000, `took ${r.elapsedMs} ms: ${JSON.stringify(d)}`);
        const failed =
          d.ollamaMode !== 'ok' || d.nvidia !== 'ok' || d.qwen !== 'ok' ||
          d.workspaceSettings !== providerSettings || !d.cardPresent || !d.recordWritable;
        if (failed) assert.match(r.stderr, /local-seat-settings-snapshot:/, `a failure was not logged: ${JSON.stringify(d)}`);
        else {
          assert.equal(r.record.trim().split('\n').length, 1, r.stderr);
          reach.clean += 1;
        }
        if (d.ollamaMode === 'hang' && d.nvidia === 'hang' && d.qwen === 'hang') reach.allHang += 1;
        if (!d.recordWritable) reach.unwritable += 1;
      }),
      { numRuns: 10, examples }
    );
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

// Invariant 2: a credential key is always a non-credential sibling's name
// plus a credential word, so every secret has a near-miss neighbour.
const CREDENTIAL_SUFFIXES = ['ApiKey', '_API_KEY', 'AccessToken', '_refresh_token', 'ClientSecret', 'SECRET', 'Password', '_password'];
const BARE_CREDENTIALS = ['apiKey', 'api_key', 'APIKEY', 'token', 'secret', 'password'];

function nest(depth, inner) {
  let v = inner;
  for (let i = 0; i < depth; i += 1) v = i % 2 ? [v] : { level: v };
  return v;
}

test('BL-1850/BL-654 invariant 2: no credential value reaches the record, and every non-credential value does', () => {
  const secretPlacement = fc.record({
    base: fc.constantFrom('timeout', 'baseUrl', 'name', 'header'),
    credential: fc.oneof(fc.constantFrom(...CREDENTIAL_SUFFIXES), fc.constantFrom(...BARE_CREDENTIALS).map((b) => `=${b}`)),
    depth: fc.integer({ min: 0, max: 3 }),
    secret: fc.stringMatching(/^sk-[a-z0-9]{12,20}$/),
  });
  const draw = fc.record({
    where: fc.constantFrom('workspace', 'user', 'compression'),
    placements: fc.array(secretPlacement, { minLength: 1, maxLength: 3 }),
  });
  fc.assert(
    fc.property(draw, ({ where, placements }) => {
      const entry = { id: MODEL, generationConfig: { contextWindowSize: 7 } };
      const compression = { contextPercentageThreshold: 0.7 };
      const keep = [];
      placements.forEach((p, i) => {
        const key = p.credential.startsWith('=') ? p.credential.slice(1) : `${p.base}${p.credential}`;
        const sibling = `${p.base}${i}`;
        const keepValue = `keep-${i}-${p.secret.slice(3, 9)}`;
        keep.push(keepValue);
        const holder = nest(p.depth, { [key]: p.secret, [sibling]: keepValue });
        if (where === 'compression') compression[`slot${i}`] = holder;
        else entry[`slot${i}`] = holder;
      });
      const settings = JSON.stringify({ modelProviders: { openai: [entry] }, chatCompression: compression });
      const r = runOnce(mkTmpDir('sfvc-bl1850-inv2-'), {
        ollamaMode: 'refused',
        nvidia: 'missing',
        qwen: 'missing',
        workspaceSettings: where === 'user' ? undefined : settings,
        userSettings: where === 'user' ? settings : undefined,
        cardPresent: true,
        recordWritable: true,
      });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.record.length > 0, `no row written: ${r.stderr}`);
      for (const p of placements) assert.ok(!r.record.includes(p.secret), `secret ${p.secret} reached the record: ${r.record}`);
      for (const v of keep) assert.ok(r.record.includes(v), `non-credential value ${v} was dropped: ${r.record}`);
    }),
    { numRuns: 12 }
  );
}, SUBPROCESS_HEAVY_TIMEOUT_MS);
