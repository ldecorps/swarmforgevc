'use strict';

// BL-1414: step handlers for "a repeating freshness violation is announced
// once, then digested". Every scenario drives the REAL
// daemon_log_freshness_check.sh over a real fixture root, via
// lib/bl1414FreshnessAnnounceDigestCli.sh - never the announce-transition
// decision in isolation (the same convention as bl1192/bl1240/bl1411's own
// CLI drivers: a gate/decision that is correct but not wired in produces
// nothing, and a scenario that called it directly would report green for
// exactly that).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1414 A repeating freshness violation is announced on its first tick, then digested, never every tick';
const CLI = path.join(__dirname, 'lib', 'bl1414FreshnessAnnounceDigestCli.sh');

const KNOWN_OUTLINE_CELLS = new Map([
  ['daemon B for reason stale-heartbeat', 'different-daemon-same-reason'],
  ['daemon A for reason no-heartbeat-line', 'same-daemon-different-reason'],
]);

function run(mode) {
  const out = execFileSync('bash', [CLI, mode], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a watched daemon and an announce stub that records every message$/, (ctx) => {
    ctx.bl1414 = {};
  });

  scoped(/^the digest window is 30 minutes$/, () => {
    // The CLI driver's fixtures all pin FRESHNESS_ANNOUNCE_DIGEST_SECS=1800
    // (30 minutes) directly - asserted by construction, nothing to record.
  });

  // ── 01 / 03 share this exact When text ────────────────────────────────
  scoped(/^the daemon has been fresh$/, (ctx) => {
    ctx.bl1414.mode = 'first-violation';
  });

  scoped(/^the daemon was announced stale 31 minutes ago and every tick since found it stale$/, (ctx) => {
    ctx.bl1414.mode = 'digest-after-window';
  });

  scoped(/^a tick finds it stale$/, (ctx) => {
    ctx.bl1414.result = run(ctx.bl1414.mode);
  });

  scoped(/^exactly one FRESHNESS_VIOLATION message is announced for it$/, (ctx) => {
    const { result } = ctx.bl1414;
    assert.equal(result.announceCount, 1, `expected exactly one announce, got: ${JSON.stringify(result)}`);
    assert.match(result.announces[0], /FRESHNESS_VIOLATION/, `expected a violation message, got: ${result.announces[0]}`);
  });

  // ── 02 ──────────────────────────────────────────────────────────────
  scoped(/^the daemon was announced stale on the previous tick$/, (ctx) => {
    ctx.bl1414.mode = 'repeat-suppressed';
  });

  scoped(/^5 more ticks find it stale within the digest window$/, (ctx) => {
    ctx.bl1414.result = run(ctx.bl1414.mode);
  });

  scoped(/^no further message is announced$/, (ctx) => {
    assert.equal(ctx.bl1414.result.announceCount, 0, `expected no announce, got: ${JSON.stringify(ctx.bl1414.result)}`);
  });

  scoped(/^5 more incident records are appended$/, (ctx) => {
    // 1 seeded prior restart record + 5 escalate-branch ticks = 6.
    assert.equal(ctx.bl1414.result.incidentCount, 6, `expected 6 incident records, got: ${JSON.stringify(ctx.bl1414.result)}`);
  });

  // ── 03's Then ───────────────────────────────────────────────────────
  scoped(/^exactly one digest message is announced naming the daemon, the number of suppressed ticks and its current age$/, (ctx) => {
    const { result } = ctx.bl1414;
    assert.equal(result.announceCount, 1, `expected exactly one announce, got: ${JSON.stringify(result)}`);
    const [msg] = result.announces;
    assert.match(msg, /FRESHNESS_VIOLATION digest/, `expected a digest message, got: ${msg}`);
    assert.match(msg, /daemon=handoffd/, `missing daemon: ${msg}`);
    assert.match(msg, /suppressed_ticks=\d+/, `missing suppressed count: ${msg}`);
    assert.match(msg, /age_secs=\d+/, `missing age: ${msg}`);
  });

  // ── 04 ──────────────────────────────────────────────────────────────
  scoped(/^the daemon was announced stale and is still within the digest window$/, (ctx) => {
    ctx.bl1414.mode = 'recovery-once';
  });

  scoped(/^a tick finds it fresh$/, (ctx) => {
    ctx.bl1414.result = run(ctx.bl1414.mode);
  });

  scoped(/^exactly one recovery message is announced for it$/, (ctx) => {
    const { result } = ctx.bl1414;
    assert.equal(result.announceCount, 1, `expected exactly one announce (across both ticks), got: ${JSON.stringify(result)}`);
    assert.match(result.announces[0], /FRESHNESS_RECOVERED/, `expected a recovery message, got: ${result.announces[0]}`);
  });

  scoped(/^a following fresh tick announces nothing$/, (ctx) => {
    // The CLI driver's recovery-once mode already runs a second fresh tick
    // internally; the prior Then already asserted the TOTAL stays at 1.
    assert.equal(ctx.bl1414.result.announceCount, 1, `a following fresh tick must add no announce: ${JSON.stringify(ctx.bl1414.result)}`);
  });

  // ── 05 (Scenario Outline) ───────────────────────────────────────────
  scoped(/^daemon A was announced stale for reason stale-heartbeat on the previous tick$/, (ctx) => {
    ctx.bl1414.baseline = true;
  });

  scoped(/^a tick finds (.+) in violation$/, (ctx, what) => {
    assert.ok(KNOWN_OUTLINE_CELLS.has(what), `unknown Outline cell "${what}" - known: ${[...KNOWN_OUTLINE_CELLS.keys()]}`);
    ctx.bl1414.result = run(KNOWN_OUTLINE_CELLS.get(what));
  });

  scoped(/^exactly one message is announced for that new violation$/, (ctx) => {
    const violationMessages = ctx.bl1414.result.announces.filter((m) => m.includes('FRESHNESS_VIOLATION'));
    assert.equal(
      violationMessages.length,
      1,
      `expected exactly one FRESHNESS_VIOLATION message, got: ${JSON.stringify(ctx.bl1414.result.announces)}`
    );
  });
}

module.exports = { registerSteps };
