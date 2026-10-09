'use strict';

// BL-2071: step handlers for "A local seat forwards only a ticket whose
// acceptance feature passes". Every scenario drives the REAL send path -
// swarm_handoff.bb and local_seat_phase_cli.bb's `pass`, over a real git
// fixture, via lib/bl2071LocalSeatAcceptanceGateCli.sh - never the gate lib
// in isolation. A gate that decides correctly and is not wired into both
// callers refuses nothing, and a scenario that called the decision
// function directly would report green for exactly that gap.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A local seat forwards only a ticket whose acceptance feature passes';
const CLI = path.join(__dirname, 'lib', 'bl2071LocalSeatAcceptanceGateCli.sh');

function run(action, state) {
  const out = execFileSync('bash', [CLI, action, state], { encoding: 'utf8', timeout: 180000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const STATE_FOR = {
  'both scenarios pass': 'pass',
  'one scenario fails': 'fail',
  'one step has no handler': 'no-handler',
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a local coder seat holding ticket BL-9071, whose acceptance feature has two scenarios$/, (ctx) => {
    ctx.bl2071 = {};
  });

  scoped(/^at the commit the seat forwards, (both scenarios pass|one scenario fails|one step has no handler)$/, (ctx, state) => {
    ctx.bl2071.state = STATE_FOR[state];
  });

  scoped(/^the seat sends its git_handoff for BL-9071$/, (ctx) => {
    const st = ctx.bl2071;
    assert.ok(st.state, 'the scenario set no fixture state');
    st.result = run('send', st.state);
  });

  scoped(/^the handoff is queued$/, (ctx) => {
    const { result } = ctx.bl2071;
    assert.equal(result.exitCode, 0, `expected the handoff queued, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, true, `expected delivery, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the handoff is refused, naming the failing scenario$/, (ctx) => {
    const { result } = ctx.bl2071;
    assert.notEqual(result.exitCode, 0, `expected the handoff refused, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, false, `expected no delivery on refusal, got: ${JSON.stringify(result)}`);
    assert.ok(result.stderr.includes('not ok 2 - marker B'), `the refusal does not name the failing scenario: ${result.stderr}`);
  });

  scoped(/^the handoff is refused, naming the step$/, (ctx) => {
    const { result } = ctx.bl2071;
    assert.notEqual(result.exitCode, 0, `expected the handoff refused, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, false, `expected no delivery on refusal, got: ${JSON.stringify(result)}`);
    assert.ok(
      result.stderr.includes('the bl2071 fixture step nobody implemented runs'),
      `the refusal does not name the step: ${result.stderr}`
    );
  });

  // ── scenario 02 ───────────────────────────────────────────────────────

  scoped(/^at the seat's HEAD, one scenario fails$/, (ctx) => {
    ctx.bl2071 = { state: 'fail' };
  });

  scoped(/^the seat runs local_seat_phase_cli\.bb pass BL-9071$/, (ctx) => {
    ctx.bl2071.result = run('phase-pass', ctx.bl2071.state);
  });

  scoped(/^the phase record stays at assert$/, (ctx) => {
    const { result } = ctx.bl2071;
    assert.notEqual(result.exitCode, 0, `expected pass refused, got: ${JSON.stringify(result)}`);
    assert.equal(result.phase, 'assert', `expected the phase record to stay at assert, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the output names the failing scenario$/, (ctx) => {
    const { result } = ctx.bl2071;
    assert.ok(result.stderr.includes('not ok 2 - marker B'), `the output does not name the failing scenario: ${result.stderr}`);
  });

  // ── scenario 03 ───────────────────────────────────────────────────────

  scoped(/^a cloud coder seat holding BL-9071$/, (ctx) => {
    ctx.bl2071 = { state: 'cloud' };
  });

  scoped(/^no acceptance run is made for the send$/, (ctx) => {
    const { result } = ctx.bl2071;
    // A cloud seat's send is unaffected by the gate (BL-2060-style
    // regression check, in miniature): the fixture's own marker B names
    // "fail" even in cloud mode (bl2071LocalSeatAcceptanceGateCli.sh), so
    // a check that ran at all would refuse. Delivery proves none ran.
    assert.equal(result.exitCode, 0, `expected the cloud seat's send to proceed, got: ${JSON.stringify(result)}`);
    assert.equal(result.delivered, true, `expected delivery, got: ${JSON.stringify(result)}`);
    assert.ok(!result.stderr.includes('BL-2071:'), `a cloud seat's send should carry no BL-2071 gate output: ${result.stderr}`);
  });
}

module.exports = { registerSteps };
