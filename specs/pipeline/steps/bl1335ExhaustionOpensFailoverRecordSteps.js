'use strict';

// BL-1335: step handlers for promoting token-exhaustion evidence into a
// failover record.
//
// Scenario 04 is the one that matters most and it drives the REAL consumer -
// `outage_failover_cli.bb evaluate` - against the record the REAL promoter
// wrote. The whole defect was two halves that both ran and read different
// files, so a test that asserted on a store of its own would be green over
// exactly the gap the ticket exists to close.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMOTION_LIB = path.join(SCRIPTS, 'exhaustion_failover_promotion_lib.bb');
const FAILOVER_CLI = path.join(SCRIPTS, 'outage_failover_cli.bb');
const FIXTURE_PREFIX = 'bl1335-acceptance-';
const SEAT = 'documenter';
const PROVIDER = 'anthropic';
const MODEL = 'claude-opus-5';
const RESET_AT = '2026-09-08T00:00Z';
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // Another scenario tidying its own root is not this sweep's business.
    }
  }
}
sweepStaleFixtures();

const EVIDENCE_TEXT = {
  exhaustion: `Token Plan weekly quota exhausted, resets at ${RESET_AT}`,
  'a transient network error': 'connection reset by peer while streaming',
  'an authentication rejection': '401 Unauthorized: invalid api key',
  'malformed model output': 'model returned malformed JSON, retrying',
};

function state(ctx) {
  if (!ctx.bl1335) ctx.bl1335 = {};
  return ctx.bl1335;
}

function root(ctx) {
  const st = state(ctx);
  if (!st.root) {
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    fs.mkdirSync(path.join(st.root, '.swarmforge', 'telemetry'), { recursive: true });
    st.recordsFile = path.join(st.root, '.swarmforge', 'telemetry', 'provider-outages.jsonl');
    st.openRecords = [];
  }
  return st.root;
}

function decide(ctx, nowMs) {
  const st = state(ctx);
  const program = `
(require '[cheshire.core :as json])
(load-file "${PROMOTION_LIB}")
(println (json/generate-string (exhaustion-failover-promotion-lib/promotion-decision
  {:evidence {:text ${JSON.stringify(st.text)}}
   :records (json/parse-string ${JSON.stringify(JSON.stringify(st.openRecords))} true)
   :seat "${SEAT}" :provider "${PROVIDER}" :model "${MODEL}"
   :now-ms ${nowMs}})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function readRecords(ctx) {
  const st = state(ctx);
  if (!fs.existsSync(st.recordsFile)) return [];
  return fs
    .readFileSync(st.recordsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const FEATURE = 'BL-1335 exhaustion evidence is promoted into the outage record BL-669 acts on';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the swarm is recording provider-outage evidence from live panes$/, (ctx) => {
    root(ctx);
  });

  scoped(/^the outage failover consumer is running against the failover record store$/, (ctx) => {
    const st = state(ctx);
    assert.ok(fs.existsSync(FAILOVER_CLI), 'the failover consumer this promotion feeds does not exist');
    st.consumerReady = true;
  });

  scoped(/^evidence that a seat's provider has exhausted its plan period quota$/, (ctx) => {
    root(ctx);
    state(ctx).text = EVIDENCE_TEXT.exhaustion;
  });

  scoped(/^evidence that a seat's provider returned "?([^"]+)"?$/, (ctx, failure) => {
    root(ctx);
    const text = EVIDENCE_TEXT[failure.trim()];
    assert.ok(text, `unknown failure kind: ${failure}`);
    state(ctx).text = text;
  });

  scoped(/^a failover record is already open for that seat's provider and model$/, (ctx) => {
    const st = state(ctx);
    st.openRecords = [
      {
        id: `${PROVIDER}/${MODEL}/1`,
        provider: PROVIDER,
        model: MODEL,
        'affected-seats': [SEAT],
        'started-at-ms': 1,
        'ended-at-utc': null,
      },
    ];
  });

  scoped(/^the Model Steward has a certified substitute eligible for that seat$/, (ctx) => {
    const st = state(ctx);
    const stewardDir = path.join(st.root, '.swarmforge', 'model-steward');
    fs.mkdirSync(stewardDir, { recursive: true });
    // The registry shape the consumer's own loader reads.
    // The registry shape the consumer's own loader reads: a role_matrix keyed
    // by role, plus a certification entry, so `certified-candidates` sees a
    // real certified substitute rather than an empty list.
    fs.writeFileSync(
      path.join(stewardDir, 'registry.json'),
      JSON.stringify({
        role_matrix: {
          [SEAT]: [{ provider: 'anthropic', model: 'claude-sonnet-5', score: 9 }],
        },
        models: {
          'anthropic/claude-sonnet-5': { provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified' },
        },
      }),
    );
    st.stewardDir = stewardDir;
  });

  scoped(/^the exhaustion classifier reads that evidence$/, (ctx) => {
    const st = state(ctx);
    const decision = decide(ctx, 1788400000000);
    st.decision = decision;
    // The promoter's own IO edge, applied here exactly as handoffd does it.
    if (decision.action === 'promote') {
      fs.appendFileSync(st.recordsFile, `${JSON.stringify(decision.record)}\n`);
    }
  });

  scoped(/^the failover consumer evaluates that seat at an idle boundary$/, (ctx) => {
    const st = state(ctx);
    // Promote first, exactly as the tick does, then hand the REAL consumer the
    // file the REAL promoter wrote.
    const startedAtMs = Date.now() - 60 * 60 * 1000; // sustained past the threshold
    const decision = decide(ctx, startedAtMs);
    assert.equal(decision.action, 'promote', `the promoter opened nothing: ${JSON.stringify(decision)}`);
    fs.appendFileSync(st.recordsFile, `${JSON.stringify(decision.record)}\n`);

    const r = spawnSync('bb', [FAILOVER_CLI, 'evaluate', '--seat', SEAT], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OUTAGE_FAILOVER_RECORDS_FILE: st.recordsFile,
        MODEL_STEWARD_STATE_DIR: st.stewardDir,
      },
    });
    st.consumerOut = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^one failover record is opened for that seat's provider and model$/, (ctx) => {
    const records = readRecords(ctx);
    assert.equal(records.length, 1, `expected exactly one record, got ${JSON.stringify(records)}`);
    assert.equal(records[0].provider, PROVIDER);
    assert.equal(records[0].model, MODEL);
    assert.deepEqual(records[0]['affected-seats'], [SEAT]);
  });

  scoped(/^the record carries the period reset time the evidence reported$/, (ctx) => {
    const records = readRecords(ctx);
    assert.equal(records[0]['period-reset-at'], RESET_AT, `the reset time was lost: ${JSON.stringify(records[0])}`);
    fs.rmSync(state(ctx).root, { recursive: true, force: true });
  });

  scoped(/^no failover record is opened$/, (ctx) => {
    const st = state(ctx);
    assert.notEqual(st.decision.action, 'promote', `a record was opened: ${JSON.stringify(st.decision)}`);
    assert.deepEqual(readRecords(ctx), [], 'a record reached the store');
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^it proposes the certified substitute for that seat$/, (ctx) => {
    const st = state(ctx);
    assert.ok(
      st.consumerOut.includes('claude-sonnet-5'),
      `the live consumer did not propose the certified substitute off the promoted record:\n${st.consumerOut}`,
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
