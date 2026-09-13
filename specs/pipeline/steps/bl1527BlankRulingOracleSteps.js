'use strict';

// BL-1527: step handlers for "a whitespace-only ruling is blank in the
// bl1367 property oracle". Scenarios 01/04 drive the REAL property file
// under the REAL properties config, reading its own printed reach line and
// its own source's reach-floor array - never a reimplementation of either.
// Scenarios 02/03 drive the REAL shared oracle helper and the REAL compiled
// classifier/writer (extension/out/concierge/pendingApprovalReply) directly,
// the way the property file itself does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1527 A whitespace-only ruling is blank in the bl1367 property oracle';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1367ApprovalCarriesItsRuling.property.test.js';
const PROPERTY_TEST_FILE = path.join(EXTENSION_DIR, PROPERTY_TEST_REL);

const { expectedNoChoiceRulingKind } = require(
  path.join(EXTENSION_DIR, 'test', 'helpers', 'noChoiceBlankRulingOracle.js')
);
const { classifyApprovalRulingRequirement, recordApprovalReply, readRecordedRuling } = require(
  path.join(EXTENSION_DIR, 'out', 'concierge', 'pendingApprovalReply')
);

// Explicit KNOWN_VALUES for both Examples columns (engineering.prompt's
// Scenario Outline rule) - an example value this handler does not know
// throws rather than passing through unchecked.
const RULING_VALUES = {
  'a single space': ' ',
  'a single tab': '\t',
  'three spaces': '   ',
  absent: undefined,
  'the empty string': '',
  'a free-text answer': 'a free answer',
};

const KNOWN_KINDS = new Set(['ok', 'unknown-option']);

const REACH_LINE_RE = /BL-1527 reach: (\[[^\n]*\])/;
const FLOOR_ARRAY_RE = /const floor = \[([\s\S]*?)\];/;

const runProperty = lazy(() =>
  spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  })
);

function state(ctx) {
  if (!ctx.bl1527run) {
    const result = runProperty();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const reachMatch = REACH_LINE_RE.exec(output);
    ctx.bl1527run = {
      result,
      output,
      reached: reachMatch ? JSON.parse(reachMatch[1]) : null,
    };
  }
  return ctx.bl1527run;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenarios 01 & 04: drive the real property file ──────────────────────
  scoped(
    /^extension\/test\/bl1367ApprovalCarriesItsRuling\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      state(ctx);
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.status, 0, `bl1367 property file did not pass:\n${s.output.slice(-4000)}`);
  });

  scoped(/^the run reports having generated a whitespace-only ruling on a ticket posing no choice$/, (ctx) => {
    const s = state(ctx);
    assert.ok(s.reached, `no "BL-1527 reach:" line in the run's output:\n${s.output.slice(-4000)}`);
    assert.ok(
      s.reached.includes('no-options:ok-blank'),
      `run reported reaching ${JSON.stringify(s.reached)}, missing no-options:ok-blank`
    );
  });

  scoped(/^the reach floor at the end of the first test names that outcome$/, () => {
    const source = fs.readFileSync(PROPERTY_TEST_FILE, 'utf8');
    const match = FLOOR_ARRAY_RE.exec(source);
    assert.ok(match, 'could not find `const floor = [...]` in the property test source');
    assert.ok(
      match[1].includes('no-options:ok-blank'),
      `reach floor array does not name no-options:ok-blank:\n${match[1]}`
    );
  });

  // ── Scenario 02: the oracle and the classifier, asked directly ──────────
  scoped(/^a ticket declaring no ruling options$/, (ctx) => {
    ctx.bl1527 = ctx.bl1527 || {};
  });

  scoped(/^the oracle and the classifier are each asked about the ruling (.+)$/, (ctx, label) => {
    if (!(label in RULING_VALUES)) {
      throw new Error(`unknown ruling example value: "${label}"`);
    }
    const ruling = RULING_VALUES[label];
    ctx.bl1527 = ctx.bl1527 || {};
    ctx.bl1527.oracleKind = expectedNoChoiceRulingKind(ruling);
    ctx.bl1527.classifierKind = classifyApprovalRulingRequirement(undefined, ruling).kind;
  });

  scoped(/^both answer (.+)$/, (ctx, kind) => {
    if (!KNOWN_KINDS.has(kind)) {
      throw new Error(`unknown kind example value: "${kind}"`);
    }
    assert.equal(ctx.bl1527.oracleKind, kind, `oracle answered ${ctx.bl1527.oracleKind}, expected ${kind}`);
    assert.equal(
      ctx.bl1527.classifierKind,
      kind,
      `classifier answered ${ctx.bl1527.classifierKind}, expected ${kind}`
    );
  });

  // ── Scenario 03: the real writer, driven directly ────────────────────────
  scoped(/^a ticket pending human approval that declares no ruling options$/, (ctx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1527-scenario03-'));
    const activeDir = path.join(dir, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, 'BL-9527.yaml'), 'id: BL-9527\ntitle: fixture\nhuman_approval: pending\n');
    ctx.bl1527 = ctx.bl1527 || {};
    ctx.bl1527.dir = dir;
  });

  scoped(/^the human approves it through a surface that sent a whitespace-only ruling$/, (ctx) => {
    ctx.bl1527.recorded = recordApprovalReply(ctx.bl1527.dir, 'BL-9527', ' ');
  });

  scoped(/^the ticket records approval$/, (ctx) => {
    const filePath = path.join(ctx.bl1527.dir, 'backlog', 'active', 'BL-9527.yaml');
    const text = fs.readFileSync(filePath, 'utf8');
    assert.equal(ctx.bl1527.recorded, true, 'recordApprovalReply reported no change');
    assert.match(text, /^human_approval: approved$/m, `ticket did not record approval:\n${text}`);
  });

  scoped(/^the ticket records no human ruling$/, (ctx) => {
    try {
      const ruling = readRecordedRuling(ctx.bl1527.dir, 'BL-9527');
      assert.ok(!ruling, `ticket recorded a ruling: ${JSON.stringify(ruling)}`);
    } finally {
      fs.rmSync(ctx.bl1527.dir, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
