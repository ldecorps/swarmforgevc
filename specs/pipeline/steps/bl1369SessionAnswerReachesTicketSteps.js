'use strict';

// BL-1369: an answer given in a session reaches the ticket.
//
// Drives the REAL compiled relay-ruling CLI and the REAL
// pendingApprovalReply module against a per-scenario fixture root
// (mkdtemp, removed in finally, swept by prefix before the run too per
// BL-971 - though the sweep here only reaps roots this handler owns,
// since this is a step-handler fixture and not a prod path).
//
// The ticket's required_wiring entry names the handler file as the
// registration: the file IS the registration, index.js names nothing
// (BL-1371 auto-discovery, repointed 2026-09-04).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const RELAY_CLI = path.join(EXTENSION_OUT, 'tools', 'relay-ruling.js');
const {
  recordApprovalReply,
  readRecordedRuling,
  readRulingProvenance,
  isTicketPendingApproval,
} = require(path.join(EXTENSION_OUT, 'concierge', 'pendingApprovalReply'));

const FEATURE = 'An answer given in a session reaches the ticket';

// BL-971: a per-handler prefix so a sweep-by-prefix only reaps THIS
// handler's abandoned fixture roots. The live prod path must NOT be swept
// by prefix (that rule deletes a live run), but a step-handler mkdtemp
// root is purely a test fixture and is safe to reap by this prefix.
const FIXTURE_PREFIX = 'sfvc-bl1369-acceptance-';

// Track fixture roots created by this handler so afterEach can reap them
// even if a scenario throws before reaching the end.
let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    rmFixtureRoot(trackedRoots.pop());
  }
});

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const activeDir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  trackedRoots.push(root);
  return root;
}

function writeFixtureTicket(root, options, overrides = {}) {
  const {
    id = 'BL-1369',
    humanApproval = 'pending',
    existingRuling = undefined,
    existingProvenance = undefined,
  } = overrides;
  const optionList = options.map((o) => `  - ${o}`).join('\n');
  let body = `id: ${id}\ntitle: t\nhuman_approval: ${humanApproval}\n`;
  if (existingRuling) {
    body += `human_ruling: |\n  ${existingRuling}\n`;
  }
  if (existingProvenance) {
    body += `ruling_provenance: ${existingProvenance}\n`;
  }
  if (options.length > 0) {
    body += `ruling_options:\n${optionList}\n`;
  }
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}.yaml`), body);
}

function rmFixtureRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; the BL-971 sweep handles stragglers.
  }
}

function runRelayCli(root, ticketId, option, relayer) {
  const out = execFileSync(
    'node',
    [RELAY_CLI, '--target', root, '--ticket', ticketId, '--option', option, '--relayer', relayer],
    { encoding: 'utf8' }
  );
  return JSON.parse(out);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a ticket that declares ruling options$/, (ctx) => {
    ctx.bl1369 = ctx.bl1369 || {};
    ctx.bl1369.root = mkFixtureRoot();
    ctx.bl1369.options = ['one', 'two', 'three'];
    ctx.bl1369.ticketId = 'BL-1369';
    writeFixtureTicket(ctx.bl1369.root, ctx.bl1369.options);
  });

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^the human answered one of the options in an agent session$/, (ctx) => {
    // Pick the middle option so it is unambiguously one of the declared ones
    // and not the first/last by position (a handler that always chose "one"
    // could hide an off-by-one in the match).
    ctx.bl1369.chosenOption = ctx.bl1369.options[1];
  });

  scoped(/^the human answered with something matching no declared option$/, (ctx) => {
    ctx.bl1369.chosenOption = 'something else entirely';
  });

  scoped(/^the ticket is pending approval$/, (ctx) => {
    assert.equal(
      isTicketPendingApproval(ctx.bl1369.root, ctx.bl1369.ticketId),
      true,
      'expected the ticket to be pending approval'
    );
  });

  scoped(/^the ticket already records a human ruling from a tap$/, (ctx) => {
    // Tap option 0 via the REAL recordApprovalReply (the same path a bot
    // callback uses), so the ruling + provenance are what the live tap
    // would have written.
    const tapped = ctx.bl1369.options[0];
    assert.equal(recordApprovalReply(ctx.bl1369.root, ctx.bl1369.ticketId, tapped), true);
    ctx.bl1369.tappedOption = tapped;
  });

  scoped(/^the ticket records a relayed human ruling$/, (ctx) => {
    // Relay option 0 first, so the ticket is in the "relayed" state.
    const relayer = 'coder';
    const option = ctx.bl1369.options[0];
    const result = runRelayCli(ctx.bl1369.root, ctx.bl1369.ticketId, option, relayer);
    assert.equal(result.kind, 'written');
    ctx.bl1369.relayedOption = option;
    ctx.bl1369.relayer = relayer;
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the answer is relayed to the ticket$/, (ctx) => {
    const relayer = 'coder';
    ctx.bl1369.relayer = relayer;
    ctx.bl1369.relayResult = runRelayCli(
      ctx.bl1369.root,
      ctx.bl1369.ticketId,
      ctx.bl1369.chosenOption,
      relayer
    );
  });

  scoped(/^the human taps a different option on the ask$/, (ctx) => {
    // Pick the option AFTER the one that was relayed, so "different" is real.
    const relayedIndex = ctx.bl1369.options.indexOf(ctx.bl1369.relayedOption);
    const tapIndex = (relayedIndex + 1) % ctx.bl1369.options.length;
    const tapped = ctx.bl1369.options[tapIndex];
    ctx.bl1369.tappedOption = tapped;
    assert.equal(recordApprovalReply(ctx.bl1369.root, ctx.bl1369.ticketId, tapped), true);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the ticket records that option as the human ruling$/, (ctx) => {
    const recorded = readRecordedRuling(ctx.bl1369.root, ctx.bl1369.ticketId);
    const expected = ctx.bl1369.tappedOption || ctx.bl1369.chosenOption;
    assert.equal(recorded, expected);
  });

  // Scenario 05 names the tapped option explicitly - same assertion, different wording.
  scoped(/^the ticket records the tapped option as the human ruling$/, (ctx) => {
    const recorded = readRecordedRuling(ctx.bl1369.root, ctx.bl1369.ticketId);
    assert.equal(recorded, ctx.bl1369.tappedOption);
  });

  scoped(/^the ruling records that it was relayed and by whom$/, (ctx) => {
    const provenance = readRulingProvenance(ctx.bl1369.root, ctx.bl1369.ticketId);
    assert.deepEqual(provenance, { kind: 'relayed', by: ctx.bl1369.relayer });
  });

  scoped(/^the ticket is still pending approval$/, (ctx) => {
    assert.equal(
      isTicketPendingApproval(ctx.bl1369.root, ctx.bl1369.ticketId),
      true,
      'the relay must not have flipped human_approval'
    );
  });

  scoped(/^the relay is refused$/, (ctx) => {
    assert.equal(ctx.bl1369.relayResult.kind, 'refused');
  });

  scoped(/^the recorded human ruling is unchanged$/, (ctx) => {
    const recorded = readRecordedRuling(ctx.bl1369.root, ctx.bl1369.ticketId);
    // The tapped ruling (scenario 03) or the relayed ruling (no other
    // scenario reaches this Then) must be what was recorded BEFORE the
    // refused relay.
    const expected = ctx.bl1369.tappedOption || ctx.bl1369.relayedOption;
    assert.equal(recorded, expected);
  });

  scoped(/^the relay is refused naming the declared options$/, (ctx) => {
    assert.equal(ctx.bl1369.relayResult.kind, 'refused');
    assert.equal(ctx.bl1369.relayResult.reason, 'unknown-option');
    assert.deepEqual(ctx.bl1369.relayResult.declaredOptions, ctx.bl1369.options);
  });

  scoped(/^the ticket records no human ruling$/, (ctx) => {
    const recorded = readRecordedRuling(ctx.bl1369.root, ctx.bl1369.ticketId);
    assert.equal(recorded, undefined);
  });
}

module.exports = { registerSteps };
