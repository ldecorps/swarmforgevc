'use strict';

// BL-511: step handlers for "the daily briefing estimates the Telegram
// front-desk bridge's cost per day". Drives the REAL compiled
// computeTelegramBridgeCostForDay/formatTelegramBridgeCostLine
// (extension/out/metrics/telegramBridgeCost.js) for the pure-compute
// scenarios, the REAL compiled telegram-bridge-cost-line.js CLI (against a
// real fixture log file) for the "daily briefing email is composed"
// scenarios, and the REAL operator_runtime.bb reap path (via a dedicated
// bb-driven fixture runner, mirroring test_operator_runtime_tick.sh's own
// make_fixture/tick convention) for the front-desk capture-at-reap
// scenario - never a hand-rolled reimplementation of any of these.
//
// SCOPE NOTE (2026-07-18, coder, confirmed with the human before
// implementing): BL-511 assumed the always-on Operator's wakeups produce a
// `claude -p --output-format json` result with total_cost_usd. Verified
// against launch_operator.sh/operator_runtime.bb: the unrestricted Operator
// launches as a fully interactive --remote-control session with NO -p/
// --output-format json capture at all, so there is no per-wakeup cost
// result to capture today. Scenario "a Telegram-triggered Operator wakeup
// is captured with its batch event breakdown" (capture-operator-event-
// breakdown-02) is therefore DELIBERATELY left with no step handler here -
// it fails honestly ("no step handler matched") rather than faking a pass;
// a note went to the specifier flagging it for a follow-up ticket with its
// own Operator-side capture design. Every OTHER scenario is buildable
// without that capture: the pure attribution logic (computeTelegramBridge-
// CostForDay) already handles 'operator'-kind records correctly and
// forward-compatibly - scenarios 4/5 exercise it via directly-injected
// fixture records, not real capture, exactly the same posture bl465's own
// render() steps already use for synthetic board data.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { computeTelegramBridgeCostForDay, formatTelegramBridgeCostLine } = require(path.join(EXT_OUT, 'metrics', 'telegramBridgeCost'));
const { bridgeCostLogPath } = require(path.join(EXT_OUT, 'tools', 'telegram-bridge-cost-line'));
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const CAPTURE_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl511_bridge_cost_capture_acceptance_runner.sh');
const CLI = path.join(EXT_OUT, 'tools', 'telegram-bridge-cost-line.js');
const DAY = '2026-07-18';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRepoFixture() {
  const root = mkTmpDir('sfvc-bl511-acceptance-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed roles.tsv']);
  return root;
}

function runCliOnFixture(root, dayKey) {
  return execFileSync('node', [CLI, dayKey], { cwd: root, encoding: 'utf8' }).trim();
}

function registerSteps(registry) {
  // ── capture-frontdesk-before-reap-01 ───────────────────────────────────
  registry.define(/^a front-desk Telegram-reply invocation that reports an exact total cost and model$/, (ctx) => {
    ctx.resultJson = { is_error: false, result: 'BL-1 is targeted for this week.', total_cost_usd: 0.0456, model: 'claude-opus-4-8' };
  });

  registry.define(/^the invocation is reaped$/, (ctx) => {
    const out = execFileSync('bash', [CAPTURE_RUNNER, JSON.stringify(ctx.resultJson)], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    ctx.resultFileState = lines[0];
    ctx.capturedLogLines = lines.slice(1);
  });

  // NOTE: the feature file wraps this step's text across two physical
  // lines ("...is appended\n  to the durable...bridge-cost log"). The
  // acceptance parser (specs/pipeline/generate.js) does not join a
  // wrapped continuation line into the step's resolved text - it is
  // silently dropped, confirmed against the generated JSON IR - so the
  // regex below matches only the FIRST line, exactly what
  // registry.resolve() actually receives. This is a pre-existing parser
  // limitation, not a defect in this step definition; flagged separately
  // to the specifier as a systemic follow-up (affects any wrapped step
  // across the whole feature corpus, not just this one).
  registry.define(/^a record carrying that exact cost, the model, and the front-desk kind is appended$/, (ctx) => {
    if (ctx.capturedLogLines[0] === 'NO_LOG') {
      throw new Error('expected a bridge-cost log record, got none');
    }
    const record = JSON.parse(ctx.capturedLogLines[0]);
    if (record.kind !== 'front-desk' || record.model !== 'claude-opus-4-8' || record.total_cost_usd !== 0.0456) {
      throw new Error(`expected a front-desk record with cost 0.0456 and model claude-opus-4-8, got: ${JSON.stringify(record)}`);
    }
  });

  registry.define(/^the record is written before the invocation's result file is deleted$/, (ctx) => {
    // The append happens earlier in reap-finished-front-desk-operator!'s own
    // body than the delete (a code-ordering guarantee) - proven here by both
    // post-conditions holding after one synchronous reap call: the record
    // landed AND the result file it was read from is gone.
    if (ctx.resultFileState !== 'RESULT_FILE_DELETED') {
      throw new Error(`expected the result file to be deleted after reap, got: ${ctx.resultFileState}`);
    }
    if (ctx.capturedLogLines[0] === 'NO_LOG') {
      throw new Error('expected the bridge-cost record to exist alongside the deleted result file, got none');
    }
  });

  // ── frontdesk-attributed-fully-03 / operator-prorated-by-share-04 /
  //    unknown-cost-not-invented-06 (shared "computed" step) ────────────────
  registry.define(/^a recorded front-desk invocation for a day$/, (ctx) => {
    ctx.dayKey = DAY;
    // Extra telegram_events/total_events fields prove the kind-based branch
    // (front-desk always counts fully), never an accidental read of them.
    ctx.records = [{ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.05, telegram_events: 0, total_events: 99 }];
  });

  // NOTE: same wrapped-continuation-line parser limitation as scenario 1's
  // Then step above - this step's text also wraps ("...batch held
  // <telegram> Telegram\n  events out of <total> total events"), so the
  // resolved text the parser hands registry.resolve() is truncated to
  // "...batch held <telegram> Telegram" and the <total> placeholder is
  // silently dropped along with it (confirmed against the generated JSON
  // IR: this step's own "parameters" array is exactly ["telegram"], never
  // "total"). `total` is therefore reconstructed from `telegram` via an
  // explicit KNOWN_VALUES-style lookup - safe and unambiguous because this
  // feature's own 3-row Examples table pairs each telegram value with
  // exactly one total (engineering.prompt's Scenario Outline rule already
  // requires this kind of explicit lookup over a passthrough, so this is
  // the same discipline, applied to reconstruct a value the parser lost
  // rather than to validate one it delivered).
  const KNOWN_OPERATOR_BATCH_TOTALS = { 3: 3, 1: 4, 0: 5 };

  registry.define(/^a recorded Operator invocation for a day whose batch held (\d+) Telegram$/, (ctx, telegram) => {
    const telegramEvents = Number(telegram);
    if (!Object.prototype.hasOwnProperty.call(KNOWN_OPERATOR_BATCH_TOTALS, telegramEvents)) {
      throw new Error(`operator-prorated-by-share-04: unrecognized <telegram> example value "${telegram}"`);
    }
    ctx.dayKey = DAY;
    ctx.records = [
      {
        ts: `${DAY}T09:05:00Z`,
        kind: 'operator',
        model: 'claude-opus-4-8',
        total_cost_usd: 0.09,
        telegram_events: telegramEvents,
        total_events: KNOWN_OPERATOR_BATCH_TOTALS[telegramEvents],
      },
    ];
  });

  registry.define(/^a recorded bridge invocation that reports no total cost and whose model is unpriced$/, (ctx) => {
    ctx.dayKey = DAY;
    ctx.records = [{ ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'some-unpriced-model', total_cost_usd: null }];
  });

  registry.define(/^the day's Telegram-bridge cost is computed$/, (ctx) => {
    ctx.summary = computeTelegramBridgeCostForDay(ctx.records, ctx.dayKey);
  });

  registry.define(/^its whole cost counts as bridge cost regardless of any batch event breakdown$/, (ctx) => {
    const expected = ctx.records[0].total_cost_usd;
    if (Math.abs(ctx.summary.totalUsd - expected) > 1e-9) {
      throw new Error(`expected the front-desk record's whole cost ${expected} counted, got totalUsd=${ctx.summary.totalUsd}`);
    }
  });

  // engineering.prompt's Scenario Outline rule: every Examples: value
  // validated against an explicit KNOWN_VALUES lookup, never a passthrough.
  const KNOWN_ATTRIBUTED_FRACTIONS = { 'the full cost': 1, 'a quarter': 0.25, none: 0 };

  registry.define(/^"?([^"]+)"? of that invocation's cost is attributed to the bridge$/, (ctx, attributed) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_ATTRIBUTED_FRACTIONS, attributed)) {
      throw new Error(`operator-prorated-by-share-04: unrecognized <attributed> example value "${attributed}"`);
    }
    const expected = ctx.records[0].total_cost_usd * KNOWN_ATTRIBUTED_FRACTIONS[attributed];
    if (Math.abs(ctx.summary.operatorAttributedUsd - expected) > 1e-9) {
      throw new Error(`expected ${attributed} (~${expected}) attributed, got ${ctx.summary.operatorAttributedUsd}`);
    }
  });

  registry.define(/^that invocation is treated as unknown cost and excluded from the total$/, (ctx) => {
    if (ctx.summary.totalUsd !== 0 || ctx.summary.unknownCount !== 1) {
      throw new Error(`expected the unknown-cost invocation excluded (totalUsd=0, unknownCount=1), got: ${JSON.stringify(ctx.summary)}`);
    }
  });

  registry.define(/^it is never counted as a zero-dollar invocation$/, (ctx) => {
    // Structural proof, not a numeric coincidence: unknownCount is a
    // DISTINCT counter a "silently coerce to $0 and sum" implementation
    // would never populate - its presence is what proves exclusion, since
    // "excluded" and "summed as 0" are numerically indistinguishable from
    // totalUsd alone.
    if (ctx.summary.unknownCount !== 1) {
      throw new Error(`expected the invocation counted as unknown (not silently zeroed), got unknownCount=${ctx.summary.unknownCount}`);
    }
  });

  // ── briefing-line-total-and-breakdown-05 / line-omitted-when-nothing-to-
  //    show-07 (drives the REAL compiled CLI against a real fixture log) ───
  registry.define(/^a day with recorded front-desk and Telegram-triggered Operator invocations$/, (ctx) => {
    ctx.root = mkRepoFixture();
    ctx.dayKey = DAY;
    const logPath = bridgeCostLogPath(ctx.root);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      [
        { ts: `${DAY}T09:00:00Z`, kind: 'front-desk', model: 'claude-opus-4-8', total_cost_usd: 0.04 },
        { ts: `${DAY}T09:05:00Z`, kind: 'operator', model: 'claude-opus-4-8', total_cost_usd: 0.08, telegram_events: 1, total_events: 4 },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n'
    );
  });

  const KNOWN_LOG_STATES = {
    'has no records for the day': (ctx) => {
      ctx.root = mkRepoFixture();
      const logPath = bridgeCostLogPath(ctx.root);
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, JSON.stringify({ ts: '2026-07-01T09:00:00Z', kind: 'front-desk', total_cost_usd: 0.04 }) + '\n');
    },
    'is absent': (ctx) => {
      ctx.root = mkRepoFixture();
    },
    'is unreadable': (ctx) => {
      ctx.root = mkRepoFixture();
      const logPath = bridgeCostLogPath(ctx.root);
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '{{{ not valid json at all');
    },
  };

  registry.define(/^the bridge-cost log "?([^"]+)"?$/, (ctx, logState) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_LOG_STATES, logState)) {
      throw new Error(`line-omitted-when-nothing-to-show-07: unrecognized <log_state> example value "${logState}"`);
    }
    ctx.dayKey = DAY;
    KNOWN_LOG_STATES[logState](ctx);
  });

  registry.define(/^the daily briefing email is composed$/, (ctx) => {
    // The CLI IS the integration point BL-511 adds to the briefing email
    // (handoffd.bb's telegram-bridge-cost-briefing-line shells to this exact
    // compiled CLI, unchanged, and briefing_email_lib.bb's own
    // append-content-block wiring for a blank/nil block - proven separately
    // in briefing_email_test_runner.bb - is pre-existing, unmodified
    // machinery this ticket does not touch).
    ctx.briefingLine = runCliOnFixture(ctx.root, ctx.dayKey);
  });

  registry.define(/^it shows one line with the day's total estimated Telegram-bridge cost$/, (ctx) => {
    if (!/^Telegram bridge cost: \$\d+\.\d{2} today/.test(ctx.briefingLine)) {
      throw new Error(`expected a "Telegram bridge cost: $X.XX today" line, got: "${ctx.briefingLine}"`);
    }
  });

  registry.define(/^the line breaks the total into the front-desk call count and the Operator-attributed share$/, (ctx) => {
    if (!/\d+ front-desk calls?/.test(ctx.briefingLine) || !/Operator \$\d+\.\d{2} attributed/.test(ctx.briefingLine)) {
      throw new Error(`expected a front-desk-count + Operator-attributed breakdown, got: "${ctx.briefingLine}"`);
    }
  });

  registry.define(/^the Telegram-bridge cost line is omitted and the rest of the briefing is unaffected$/, (ctx) => {
    // "unaffected" at this layer: the CLI degrades to empty stdout, exit 0 -
    // never throws, never partial output - which is exactly what lets
    // briefing_email_lib.bb's append-content-block (a blank block is
    // skipped) leave every OTHER section untouched, proven separately.
    if (ctx.briefingLine !== '') {
      throw new Error(`expected the line omitted (empty), got: "${ctx.briefingLine}"`);
    }
  });
}

module.exports = { registerSteps };
