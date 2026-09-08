const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  relayRulingText,
  recordRelayedRuling,
  readRecordedRuling,
  readRulingProvenance,
  readRulingOptions,
  rulingHumanApprovalText,
} = require('../out/concierge/pendingApprovalReply');

// BL-1369: an agent relays an answer the human gave in-session onto the
// ticket's human_ruling field, through the same module that already owns
// the human_ruling writer. Invariant 1: relay NEVER writes human_approval.
// Invariant 2: a recorded ruling always carries provenance. Invariant 3: a
// relay never overwrites a tapped ruling, and a later tap supersedes a relay.

// ── relayRulingText (pure text transform) ──────────────────────────────

function baseTicket(options) {
  const optionList = options.map((o) => `  - ${o}`).join('\n');
  return `id: BL-1369\ntitle: t\nhuman_approval: pending\nruling_options:\n${optionList}\n`;
}

test('BL-1369: relaying an option writes both the ruling and relayed provenance', () => {
  const raw = baseTicket(['one', 'two', 'three']);
  const result = relayRulingText(raw, 'two', 'coder', ['one', 'two', 'three']);
  assert.equal(result.kind, 'written');
  assert.match(result.text, /^human_ruling: \|\n {2}two$/m);
  assert.match(result.text, /^ruling_provenance: relayed by coder$/m);
});

test('BL-1369 invariant 1: relaying never flips human_approval from pending', () => {
  const raw = baseTicket(['one', 'two']);
  const result = relayRulingText(raw, 'one', 'coder', ['one', 'two']);
  assert.equal(result.kind, 'written');
  assert.match(result.text, /^human_approval: pending$/m);
});

test('BL-1369 invariant 3: a relay is refused when the ticket already has a tapped ruling', () => {
  // Tap first - writes a tapped ruling with tapped provenance
  const raw = baseTicket(['one', 'two', 'three']);
  const tapped = rulingHumanApprovalText(raw, 'one');
  assert.equal(tapped.changed, true);
  // Now try to relay a different option
  const result = relayRulingText(tapped.text, 'three', 'coder', ['one', 'two', 'three']);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reason, 'already-tapped');
  // The original tapped ruling is byte-identical in the returned payload
  assert.equal(result.text, tapped.text);
});

test('BL-1369: relaying an answer that matches no declared option is refused, naming the options', () => {
  const options = ['one', 'two', 'three'];
  const raw = baseTicket(options);
  const result = relayRulingText(raw, 'something else', 'coder', options);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reason, 'unknown-option');
  assert.deepEqual(result.declaredOptions, options);
  // No ruling written
  assert.equal(/^human_ruling:/m.test(result.text), false);
  assert.equal(/^ruling_provenance:/m.test(result.text), false);
});

test('BL-1369: relaying on a ticket that declares no options is refused', () => {
  const raw = 'id: BL-1370\ntitle: t\nhuman_approval: pending\n';
  const result = relayRulingText(raw, 'anything', 'coder', undefined);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reason, 'no-ruling-options');
});

test('BL-1369: relaying on a ticket with an empty options list is refused', () => {
  const raw = 'id: BL-1370\ntitle: t\nhuman_approval: pending\n';
  const result = relayRulingText(raw, 'anything', 'coder', []);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reason, 'no-ruling-options');
});

test('BL-1369: a prior relay is replaced by a later relay (same relayer field updates)', () => {
  const options = ['one', 'two', 'three'];
  const raw = baseTicket(options);
  const first = relayRulingText(raw, 'one', 'coder', options);
  assert.equal(first.kind, 'written');
  // A second relay (perhaps the human changed their mind in-session) replaces
  // the first. The new provenance is the new relayer.
  const second = relayRulingText(first.text, 'two', 'coder', options);
  assert.equal(second.kind, 'written');
  assert.match(second.text, /^human_ruling: \|\n {2}two$/m);
  assert.match(second.text, /^ruling_provenance: relayed by coder$/m);
  // And the old label is gone
  assert.equal(/^ {2}one$/m.test(second.text), false);
});

test('BL-1369: the option match is exact, not substring', () => {
  const options = ['do it', 'do it in code'];
  const raw = baseTicket(options);
  // "do it" is a different option from "do it in code" - substring must not match
  const result = relayRulingText(raw, 'do i', 'coder', options);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reason, 'unknown-option');
});

test('BL-1369: leading/trailing whitespace on the answer is trimmed for the match', () => {
  const options = ['one', 'two'];
  const raw = baseTicket(options);
  const result = relayRulingText(raw, '  two  ', 'coder', options);
  assert.equal(result.kind, 'written');
  assert.match(result.text, /^human_ruling: \|\n {2}two$/m);
});

test('BL-1369: relayer identity is sanitized (newlines stripped) before write', () => {
  // An agent passing a malicious relayer string must not inject YAML
  const options = ['one'];
  const raw = baseTicket(options);
  const result = relayRulingText(raw, 'one', 'coder\nhuman_approval: approved', options);
  assert.equal(result.kind, 'written');
  // The provenance line is single-line; the newline is stripped
  assert.match(result.text, /^ruling_provenance: relayed by coder human_approval: approved$/m);
  // And the approval was NOT flipped
  assert.match(result.text, /^human_approval: pending$/m);
});

// ── rulingHumanApprovalText now writes tapped provenance ───────────────

test('BL-1369: a tapped ruling carries tapped provenance alongside the ruling', () => {
  const raw = baseTicket(['one', 'two']);
  const result = rulingHumanApprovalText(raw, 'one');
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_ruling: \|\n {2}one$/m);
  assert.match(result.text, /^ruling_provenance: tapped$/m);
  assert.match(result.text, /^human_approval: approved$/m);
});

// ── recordRelayedRuling (impure driver, real fs) ───────────────────────

function mkTmp() {
  return mkTmpDir('sfvc-relay-ruling-');
}

function writeTicket(dir, subdir, fileName, content) {
  const full = path.join(dir, 'backlog', subdir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, fileName), content);
}

test('BL-1369: recordRelayedRuling writes the file and reports written', () => {
  const dir = mkTmp();
  try {
    writeTicket(dir, 'active', 'BL-1369.yaml', baseTicket(['one', 'two', 'three']));
    const result = recordRelayedRuling(dir, 'BL-1369', 'two', 'coder');
    assert.equal(result.kind, 'written');
    const yaml = fs.readFileSync(path.join(dir, 'backlog', 'active', 'BL-1369.yaml'), 'utf8');
    assert.match(yaml, /^human_ruling: \|\n {2}two$/m);
    assert.match(yaml, /^ruling_provenance: relayed by coder$/m);
    assert.match(yaml, /^human_approval: pending$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: recordRelayedRuling refuses when no ticket file', () => {
  const dir = mkTmp();
  try {
    const result = recordRelayedRuling(dir, 'BL-999', 'one', 'coder');
    assert.equal(result.kind, 'refused');
    assert.equal(result.reason, 'no-ticket-file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: recordRelayedRuling reads declared options from the ticket itself', () => {
  const dir = mkTmp();
  try {
    writeTicket(dir, 'active', 'BL-1369.yaml', baseTicket(['one', 'two', 'three']));
    // Passing an option not in the ticket's own list must be refused
    const result = recordRelayedRuling(dir, 'BL-1369', 'four', 'coder');
    assert.equal(result.kind, 'refused');
    assert.equal(result.reason, 'unknown-option');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: recordRelayedRuling refuses a relay when the ruling was already tapped', () => {
  const dir = mkTmp();
  try {
    writeTicket(dir, 'active', 'BL-1369.yaml', baseTicket(['one', 'two', 'three']));
    // First: tap
    const { recordApprovalReply } = require('../out/concierge/pendingApprovalReply');
    assert.equal(recordApprovalReply(dir, 'BL-1369', 'one'), true);
    // Then: try to relay
    const result = recordRelayedRuling(dir, 'BL-1369', 'two', 'coder');
    assert.equal(result.kind, 'refused');
    assert.equal(result.reason, 'already-tapped');
    // The file is byte-identical to after the tap
    const yaml = fs.readFileSync(path.join(dir, 'backlog', 'active', 'BL-1369.yaml'), 'utf8');
    assert.match(yaml, /^human_ruling: \|\n {2}one$/m);
    assert.match(yaml, /^ruling_provenance: tapped$/m);
    assert.match(yaml, /^human_approval: approved$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── readRulingProvenance ───────────────────────────────────────────────

test('BL-1369: readRulingProvenance returns tapped for a tapped ruling', () => {
  const dir = mkTmp();
  try {
    writeTicket(
      dir,
      'active',
      'BL-1369.yaml',
      'id: BL-1369\ntitle: t\nhuman_approval: approved\nhuman_ruling: |\n  one\nruling_provenance: tapped\n'
    );
    assert.deepEqual(readRulingProvenance(dir, 'BL-1369'), { kind: 'tapped' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: readRulingProvenance returns relayed+relayer for a relayed ruling', () => {
  const dir = mkTmp();
  try {
    writeTicket(
      dir,
      'active',
      'BL-1369.yaml',
      'id: BL-1369\ntitle: t\nhuman_approval: pending\nhuman_ruling: |\n  two\nruling_provenance: relayed by coder\n'
    );
    assert.deepEqual(readRulingProvenance(dir, 'BL-1369'), { kind: 'relayed', by: 'coder' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: readRulingProvenance returns undefined when no provenance field', () => {
  const dir = mkTmp();
  try {
    writeTicket(
      dir,
      'active',
      'BL-1369.yaml',
      'id: BL-1369\ntitle: t\nhuman_approval: approved\nhuman_ruling: |\n  one\n'
    );
    assert.equal(readRulingProvenance(dir, 'BL-1369'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1369: readRulingProvenance returns undefined when no ruling at all', () => {
  const dir = mkTmp();
  try {
    writeTicket(dir, 'active', 'BL-1369.yaml', 'id: BL-1369\ntitle: t\nhuman_approval: pending\n');
    assert.equal(readRulingProvenance(dir, 'BL-1369'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── invariant 3, other direction: tap supersedes relay ─────────────────

test('BL-1369 invariant 3 other direction: tapping after a relay replaces both fields', () => {
  const dir = mkTmp();
  try {
    writeTicket(dir, 'active', 'BL-1369.yaml', baseTicket(['one', 'two', 'three']));
    // Relay first
    const relayResult = recordRelayedRuling(dir, 'BL-1369', 'two', 'coder');
    assert.equal(relayResult.kind, 'written');
    // Then tap a different option
    const { recordApprovalReply } = require('../out/concierge/pendingApprovalReply');
    assert.equal(recordApprovalReply(dir, 'BL-1369', 'three'), true);
    const yaml = fs.readFileSync(path.join(dir, 'backlog', 'active', 'BL-1369.yaml'), 'utf8');
    assert.match(yaml, /^human_ruling: \|\n {2}three$/m);
    assert.match(yaml, /^ruling_provenance: tapped$/m);
    assert.match(yaml, /^human_approval: approved$/m);
    // The relayed label is gone
    assert.equal(/^ {2}two$/m.test(yaml), false);
    assert.equal(/^ruling_provenance: relayed by coder$/m.test(yaml), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
