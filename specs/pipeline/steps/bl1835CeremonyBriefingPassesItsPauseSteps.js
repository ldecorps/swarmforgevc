'use strict';

// BL-1835: step handlers for "The closing ceremony's briefing note reaches
// the documenter through the ceremony's own pause". Drives the REAL
// swarmforge/scripts/handoff_lib.bb resolve-dequeueable-candidates (via
// lib/bl1835CeremonyBriefingPassesItsPauseCli.bb's scratch git fixture) -
// never a restatement of the pause-hold/exemption logic in JS. Each
// scenario/row builds its own fresh fixture (the CLI's own job, mirroring
// BL-1740's own CLI convention).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1835CeremonyBriefingPassesItsPauseCli.bb');
const BRIEFING_SCHEDULE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_generation_schedule_lib.bb');

// BL-1277: every registration below is scoped to THIS feature - generic
// text like "the documenter asks for its next task" is also registered,
// unscoped text in common, by other tickets' own step files for their own
// features (BL-1871, the ambulance-mode feature), and an unscoped
// registration here would make resolution depend on step-file load order.
const FEATURE = "BL-1835 The closing ceremony's briefing note reaches the documenter through the ceremony's own pause";

// The TypeScript trigger's own literal (nightClosingCeremonyLive.ts) -
// required directly, never shelled out to or re-typed, so a drift in the
// compiled function shows up here rather than in a restated string.
const { briefingInstruction } = require(path.join(EXTENSION_DIR, 'out', 'quality', 'nightClosingCeremonyLive'));

// The Babashka fallback trigger's own literal (briefing-generation-schedule-
// lib/briefing-due-instruction) - unreachable from Node directly (bb has no
// way to be imported, the same reason the production CLI shells to it),
// so a tiny one-off `bb -e` evaluates the REAL function rather than
// restating its format.
function bbBriefingInstruction(dayKey) {
  const out = execFileSync(
    'bb',
    ['-e', `(load-file "${BRIEFING_SCHEDULE_LIB}") (println (briefing-generation-schedule-lib/briefing-due-instruction "${dayKey}"))`],
    { encoding: 'utf8' }
  );
  return out.trim();
}

// BL-421/engineering.prompt Scenario Outline rule: every <parcel>/<trigger>
// example value is validated against an explicit map, never a generic
// passthrough parse of the table's prose.
const KNOWN_PARCELS = {
  'a git_handoff for BL-9001': () => 'git_handoff:BL-9001',
  'the note "produce the morning briefing for 2026-10-01"': () => 'note:produce the morning briefing for 2026-10-01',
  'the note "land documenter briefing 0123456789"': () => 'note:land documenter briefing 0123456789',
};

const KNOWN_TRIGGERS = {
  'the closing ceremony': (dayKey) => briefingInstruction(dayKey),
  'the fixed-morning fallback': (dayKey) => bbBriefingInstruction(dayKey),
};

function knownParcelSpec(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PARCELS, text)) {
    throw new Error(`BL-1835: unrecognized <parcel> example value "${text}"`);
  }
  return KNOWN_PARCELS[text]();
}

function knownTriggerMessage(text, dayKey) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_TRIGGERS, text)) {
    throw new Error(`BL-1835: unrecognized <trigger> example value "${text}"`);
  }
  return KNOWN_TRIGGERS[text](dayKey);
}

function runFixture(ctx) {
  const out = execFileSync('bb', [FIXTURE_CLI, ctx.role, ...ctx.specs], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  ctx.output = out;
  ctx.result = JSON.parse(lines[lines.length - 1]);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture project root whose control pause is active$/, (ctx) => {
    ctx.role = null;
    ctx.specs = [];
  });

  // ── the-briefing-instruction-is-served-during-a-pause-01 ────────────────
  scoped(/^the documenter's inbox holds an ordinary note queued before the pause$/, (ctx) => {
    ctx.role = 'documenter';
    ctx.specs.push('note:branch behind abc1234567: merge up');
  });

  scoped(/^the documenter's inbox holds the note "([^"]+)"$/, (ctx, message) => {
    ctx.role = 'documenter';
    ctx.specs.push(`note:${message}`);
  });

  scoped(/^the documenter asks for its next task$/, (ctx) => runFixture(ctx));

  scoped(/^it is served the note "([^"]+)"$/, (ctx, message) => {
    const entry = ctx.result.find((r) => r.message === message);
    assert.ok(entry, `expected a result entry for "${message}", got: ${JSON.stringify(ctx.result)}`);
    assert.equal(entry.served, true, `expected "${message}" to be served`);
  });

  scoped(/^the ordinary note is reported "([^"]+)" and is still in the documenter's inbox$/, (ctx, diagnostic) => {
    assert.ok(ctx.output.includes(diagnostic), `expected the diagnostic "${diagnostic}" in output, got: ${ctx.output}`);
    const entry = ctx.result[0];
    assert.equal(entry.served, false, 'expected the ordinary note (first spec) to stay held');
    assert.equal(entry.stillPresent, true, 'expected the held ordinary note to still be present');
  });

  // ── every-other-parcel-stays-held-02 ────────────────────────────────────
  // Negative lookahead excludes scenario 03's "holds the briefing
  // instruction for ... as ... composes it" phrasing - both this pattern
  // and that one would otherwise match the same step text (registry
  // resolution is first-match, not longest-match), silently stealing
  // scenario 03's Given.
  scoped(/^the (\S+)'s inbox holds (?!the briefing instruction for )(.+)$/, (ctx, role, parcelText) => {
    ctx.role = role;
    ctx.specs.push(knownParcelSpec(parcelText));
  });

  scoped(/^the (\S+) asks for its next task$/, (ctx, role) => {
    assert.equal(role, ctx.role, `expected the asking role to match the inbox's own role, got "${role}" vs "${ctx.role}"`);
    runFixture(ctx);
  });

  scoped(/^it is served nothing$/, (ctx) => {
    assert.ok(ctx.result.every((r) => r.served === false), `expected nothing served, got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^that parcel is reported "([^"]+)" and is still in the (\S+)'s inbox$/, (ctx, diagnostic, role) => {
    assert.equal(role, ctx.role, `expected the reported role to match the inbox's own role, got "${role}" vs "${ctx.role}"`);
    assert.ok(ctx.output.includes(diagnostic), `expected the diagnostic "${diagnostic}" in output, got: ${ctx.output}`);
    const entry = ctx.result[0];
    assert.equal(entry.served, false, 'expected the sole parcel to stay held');
    assert.equal(entry.stillPresent, true, 'expected the held parcel to still be present');
  });

  // ── both-triggers-instructions-pass-the-pause-03 ────────────────────────
  scoped(/^the documenter's inbox holds the briefing instruction for ([\d-]+) as (.+) composes it$/, (ctx, dayKey, triggerText) => {
    ctx.role = 'documenter';
    const message = knownTriggerMessage(triggerText, dayKey);
    ctx.specs.push(`note:${message}`);
    ctx.expectedMessage = message;
  });

  scoped(/^it is served that note$/, (ctx) => {
    const entry = ctx.result[0];
    assert.equal(entry.message, ctx.expectedMessage, 'expected the sole spec to carry the computed trigger message');
    assert.equal(entry.served, true, 'expected the briefing instruction to be served, not held');
  });
}

module.exports = { registerSteps };
