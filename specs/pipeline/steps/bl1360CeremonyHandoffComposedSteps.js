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
//
// The recipient list is NOT restated here. handoff-protocol.md is parsed for
// it, the same single definition the composer is pinned to, so this handler
// cannot become the fourth copy the ticket set out to avoid (BL-897).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A ceremony handoff is composed, not retyped';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, 'lib', 'bl1360CeremonyHandoffCli.sh');
const PROTOCOL = path.join(REPO_ROOT, 'swarmforge', 'handoff-protocol.md');

// The Outline's own words for each ceremony, mapped to the driver mode that
// sends it. Explicit KNOWN_VALUES: a row naming a ceremony this handler does
// not know throws rather than passing through unchecked.
const CEREMONY_MODES = {
  'merge-up': 'merge-up',
  bookkeep: 'bookkeep',
};

/**
 * The merge-up recipients as handoff-protocol.md states them - the one
 * definition. Read rather than restated so that a change to the document
 * fails here instead of leaving two lists quietly disagreeing.
 */
function documentedMergeUpRecipients() {
  const text = fs.readFileSync(PROTOCOL, 'utf8');
  const start = text.indexOf('**QA → worktree roles:**');
  assert.notEqual(
    start,
    -1,
    'handoff-protocol.md no longer documents the QA merge-up broadcast; the recipient list is unpinned'
  );
  const section = text.slice(start, start + 600);
  const quoted = [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const list = quoted.find((q) => q.includes(',') && !q.includes(' '));
  assert.ok(list, `no comma-separated recipient list in the documented merge-up step: ${quoted.join(' | ')}`);
  return list.split(',');
}

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
  scoped(/^the merge-up ceremony is composed$/, (ctx) => {
    ctx.bl1360.result = run('merge-up');
  });

  scoped(/^the (\S+) ceremony is composed$/, (ctx, name) => {
    const mode = CEREMONY_MODES[name];
    assert.ok(mode, `unknown ceremony in the Examples table: ${name}`);
    ctx.bl1360.result = run(mode);
  });

  scoped(/^the role sends the ceremony$/, (ctx) => {
    assert.ok(ctx.bl1360.mode, 'the scenario set no fixture mode');
    ctx.bl1360.result = run(ctx.bl1360.mode);
  });

  // ── Then: the recipients ────────────────────────────────────────────────
  scoped(/^every pipeline worktree role is a recipient$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.equal(result.exitCode, 0, `the ceremony did not send: ${JSON.stringify(result)}`);
    const expected = documentedMergeUpRecipients();
    for (const role of expected) {
      assert.ok(
        result.recipients.includes(role),
        `${role} received no merge-up copy; recipients were [${result.recipients.join(', ')}]`
      );
    }
  });

  scoped(/^the specifier is not a recipient$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.ok(
      !result.recipients.includes('specifier'),
      `the specifier received the ceremony; recipients were [${result.recipients.join(', ')}]`
    );
    // The fixture gives the specifier a real roles.tsv row and a real inbox,
    // so its absence is the ceremony's definition rather than an unreachable
    // role.
    assert.ok(
      result.recipients.length > 0,
      `nothing was delivered at all, so "not a recipient" proves nothing: ${JSON.stringify(result)}`
    );
  });

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
      result.stderr.includes("Unknown recipient role 'hardender'."),
      `the sender was not told which recipient was refused: ${JSON.stringify(result.stderr)}`
    );
  });

  scoped(/^the send is refused naming the ceremonies that are defined$/, (ctx) => {
    const { result } = ctx.bl1360;
    assert.notEqual(result.exitCode, 0, `an undefined ceremony was sent: ${JSON.stringify(result)}`);
    for (const known of ['merge-up', 'bookkeep', 'spec-ready']) {
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
