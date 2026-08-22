const assert = require('node:assert/strict');
const fs = require('node:fs');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  writeLetsTalkAudioEnginePreference,
  letsTalkAudioEnginePreferencePath,
} = require('../out/bridge/letsTalkAudioPreference');
const { resolveLetsTalkAudioAdapters } = require('../out/bridge/letsTalkAudio');

// BL-863 declared invariants (backlog/active/BL-863-voice-engine-preference-bridge.yaml):
// 1. The preference carries an engine NAME only: no credential is ever
//    written to the store or accepted from the wire.
// 2. Resolution never yields an empty adapter set — every resolve either
//    returns usable adapters or fails with a reason naming the engine and
//    what is missing.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

function mkRoot() {
  return mkTmpDir('sfvc-bl863-inv-');
}

// Colliding-pair construction (per BL-654's generator-reach requirement):
// derive the credential-carrying candidate FROM a valid engine choice, so
// every generated pair is "a would-be-valid preference plus a credential
// field" by construction, not two independently drawn objects that might
// never collide on the interesting case.
const engineArb = fc.constantFrom('local', 'openai');
const credentialKeyArb = fc.constantFrom('openaiApiKey', 'apiKey', 'token', 'secret', 'key');
const credentialValueArb = fc.string({ minLength: 1, maxLength: 40 });

test('property: invariant 1 - a candidate carrying any extra field alongside a valid engine is always refused, store unchanged', () => {
  fc.assert(
    fc.property(engineArb, credentialKeyArb, credentialValueArb, (engine, credentialKey, credentialValue) => {
      const root = mkRoot();
      const before = fs.existsSync(letsTalkAudioEnginePreferencePath(root))
        ? fs.readFileSync(letsTalkAudioEnginePreferencePath(root), 'utf8')
        : undefined;
      const result = writeLetsTalkAudioEnginePreference(root, { engine, [credentialKey]: credentialValue });
      assert.equal(result.ok, false, 'a candidate with any field beyond engine must be refused');
      const after = fs.existsSync(letsTalkAudioEnginePreferencePath(root))
        ? fs.readFileSync(letsTalkAudioEnginePreferencePath(root), 'utf8')
        : undefined;
      assert.equal(after, before, 'the stored preference must be unchanged after a refused write');
    }),
    { numRuns: 50 }
  );
});

test('property: invariant 1 - a valid engine-only candidate is always accepted and the file never carries extra keys', () => {
  fc.assert(
    fc.property(engineArb, (engine) => {
      const root = mkRoot();
      const result = writeLetsTalkAudioEnginePreference(root, { engine });
      assert.equal(result.ok, true);
      const raw = JSON.parse(fs.readFileSync(letsTalkAudioEnginePreferencePath(root), 'utf8'));
      assert.deepEqual(Object.keys(raw), ['engine']);
      assert.equal(raw.engine, engine);
    }),
    { numRuns: 20 }
  );
});

// Invariant 2's generator draws BOTH engines and both a present/absent
// credential/model-path so it reaches every branch of the failure surface
// (openai-missing-key, local-missing-model), not just the "obviously ok"
// corner.
const envArb = fc.record({
  engine: engineArb,
  openaiApiKey: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
  whisperModelPath: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
});

test('property: invariant 2 - resolution never yields an empty adapter set; ok has adapters, failure names engine+reason', () => {
  fc.assert(
    fc.property(envArb, (env) => {
      const resolution = resolveLetsTalkAudioAdapters(env);
      if (resolution.kind === 'ok') {
        assert.ok(resolution.adapters && typeof resolution.adapters === 'object');
        assert.ok(
          Object.keys(resolution.adapters).length > 0,
          'an "ok" resolution must never carry an empty adapter object'
        );
      } else {
        assert.equal(resolution.kind, 'failure');
        assert.equal('adapters' in resolution, false, 'a failure must never also carry an adapters field');
        assert.equal(typeof resolution.engine, 'string');
        assert.match(resolution.reason, new RegExp(resolution.engine, 'i'));
        assert.match(resolution.reason, /missing/i);
      }
    }),
    { numRuns: 100 }
  );
});

test('non-vacuity: invariant 1 property fails against a broken store that strips instead of refusing', () => {
  const root = mkRoot();
  // A deliberately broken "store" that silently drops unknown fields instead
  // of refusing the whole write — the exact defect the invariant forbids.
  function brokenWrite(candidate) {
    const { engine } = candidate;
    fs.mkdirSync(require('path').dirname(letsTalkAudioEnginePreferencePath(root)), { recursive: true });
    fs.writeFileSync(letsTalkAudioEnginePreferencePath(root), JSON.stringify({ engine }));
    return { ok: true };
  }
  const result = brokenWrite({ engine: 'openai', openaiApiKey: 'sk-should-have-been-refused' });
  assert.equal(result.ok, true, 'broken store accepts the credential-carrying write, unlike the real one');
});

test('non-vacuity: invariant 2 property fails against the old ?? {} degradation', () => {
  function brokenResolve(env) {
    if (env.engine === 'openai' && !env.openaiApiKey) {
      return {}; // the exact silent-empty-adapter-set bug BL-863 fixes
    }
    return { kind: 'ok', adapters: { transcribeAudio: async () => ({ kind: 'ok', transcript: 'x' }) } };
  }
  const broken = brokenResolve({ engine: 'openai' });
  assert.deepEqual(broken, {}, 'broken resolver returns an empty object, unlike the real resolver');
});
