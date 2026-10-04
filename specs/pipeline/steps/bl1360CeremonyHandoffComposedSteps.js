'use strict';

// BL-1360: step handlers for "A ceremony handoff is composed, not retyped".
//
// Every scenario drives the REAL entry point - ceremony_handoff.sh, which
// invokes the REAL swarm_handoff.sh - over a disposable git fixture, via
// lib/bl1360CeremonyHandoffCli.sh. Calling the composer lib directly would
// report green for a composer that is a second way into a mailbox, which is
// precisely what invariant 1 forbids and what these scenarios exist to
// observe: scenario 03's refusal is only meaningful if the send path is the
// real one.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A ceremony handoff is composed, not retyped';
const CLI = path.join(__dirname, 'lib', 'bl1360CeremonyHandoffCli.sh');

// The Outline's own words for each ceremony, mapped to the driver mode that
// sends it. Explicit KNOWN_VALUES: a row naming a ceremony this handler does
// not know throws rather than passing through unchecked.
const CEREMONY_MODES = {
  bookkeep: 'bookkeep',
};

function run(mode) {
  const out = execFileSync('bash', [CLI, mode], { encoding: 'utf8', timeout: 180000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a role is sending a named pipeline ceremony$/, (ctx) => {
    ctx.bl1360 = {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^QA has an approved commit for a ticket$/, (ctx) => {
    ctx.bl1360.facts = 'complete';
  });

  scoped(/^a ceremony whose draft the send-time gates would refuse$/, (ctx) => {
    // A recipient the swarm does not know: the REAL send-time recipient
    // validation refuses it. Nothing about the composer is stubbed.
    ctx.bl1360.mode = 'gate-refusal';
  });

  scoped(/^a ceremony name the composer does not define$/, (ctx) => {
    ctx.bl1360.mode = 'unknown';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the (\S+) ceremony is composed$/, (ctx, name) => {
    const mode = CEREMONY_MODES[name];
    assert.ok(mode, `unknown ceremony in the Examples table: ${name}`);
    ctx.bl1360.result = run(mode);
  });

  scoped(/^the role sends the ceremony$/, (ctx) => {
    assert.ok(ctx.bl1360.mode, 'the scenario set no fixture mode');
    ctx.bl1360.result = run(ctx.bl1360.mode);
  });

  // ── Then: the priority ──────────────────────────────────────────────────
  scoped(/^the ceremony is sent at priority 00$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.ok(result.priorities.length > 0, `nothing was sent: ${JSON.stringify(result)}`);
    for (const p of result.priorities) {
      assert.equal(p, '00', `a copy was queued at priority ${p}, not 00`);
    }
    // ...and the composed draft says so too, so a role inspecting the dry run
    // sees the same priority the mailbox does.
    assert.ok(
      result.dryRunDraft.includes('\npriority: 00\n'),
      `the composed draft does not declare priority 00:\n${result.dryRunDraft}`
    );
  });

  // ── Then: the message ───────────────────────────────────────────────────
  scoped(/^the message is a single line of at most 80 characters$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.ok(result.messages.length > 0, `nothing was sent: ${JSON.stringify(result)}`);
    for (const message of result.messages) {
      assert.ok(!message.includes('\n'), `the message is not a single line: ${JSON.stringify(message)}`);
      assert.ok(
        message.length <= 80,
        `the message is ${message.length} characters: ${JSON.stringify(message)}`
      );
    }
  });

  scoped(/^the message names the ticket and the commit in full$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.ok(result.messages.length > 0, `nothing was sent: ${JSON.stringify(result)}`);
    for (const message of result.messages) {
      assert.ok(
        message.includes(result.ticket),
        `the ticket id ${result.ticket} is not in the message: ${JSON.stringify(message)}`
      );
      assert.ok(
        message.includes(result.commit),
        `the commit ${result.commit} is not in the message: ${JSON.stringify(message)}`
      );
    }
  });

  // ── Then: refusals ──────────────────────────────────────────────────────
  scoped(/^the refusal is reported to the sender unchanged$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.notEqual(result.exitCode, 0, `the refused ceremony reported success: ${JSON.stringify(result)}`);
    // The gate's OWN words, not a summary the composer invented.
    assert.ok(
      result.stderr.includes('HANDOFF INVALID'),
      `the gate's refusal did not reach the sender: ${JSON.stringify(result.stderr)}`
    );
    assert.ok(
      result.stderr.includes("Unknown recipient role 'coordinator'."),
      `the sender was not told which recipient was refused: ${JSON.stringify(result.stderr)}`
    );
  });

  scoped(/^the send is refused naming the ceremonies that are defined$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.notEqual(result.exitCode, 0, `an undefined ceremony was sent: ${JSON.stringify(result)}`);
    for (const known of ['bookkeep', 'spec-ready']) {
      assert.ok(
        result.stderr.includes(known),
        `the refusal does not offer the defined ceremony ${known}: ${JSON.stringify(result.stderr)}`
      );
    }
  });

  scoped(/^no mailbox receives the ceremony$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.equal(
      result.delivered,
      false,
      `a refused ceremony still reached a mailbox: ${JSON.stringify(result)}`
    );
    assert.equal(
      result.recipients.length,
      0,
      `a refused ceremony reached [${result.recipients.join(', ')}]`
    );
  });
}

module.exports = { registerSteps };
