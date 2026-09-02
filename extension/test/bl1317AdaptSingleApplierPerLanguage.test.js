const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-1317 (QA bounce D1 remedy, narrowed by the 2026-09-02 spec amendment).
// Adapt has exactly ONE applier, and it is the Babashka one:
// handoff_lib.bb::record-effort-adapt!, wired at done_with_current_task.bb,
// which rewrites the seat's launch settings itself and whose climb survives
// the ticket's re-claim (seat_difficulty_lib.bb::claim-effort-decision's
// `climbed` branch).
//
// The amendment established that no TypeScript caller can exist at the adapt
// moment - the outcome signal is recorded on the Babashka side, so a TS
// decision module could only be reached by the daemon shelling into node to
// make a pure choice. The TS apply edge that used to sit here was therefore
// removed rather than left unwired (that unwired module is what QA bounced).
//
// So the gate has two halves. Nothing in TypeScript may apply Adapt at all,
// and the one Adapt applier that does exist must still be there: both write
// the SAME .swarmforge/launch/<role>.claude-settings.json effortLevel, so a
// TypeScript reaction to the same outcome would double-climb a seat on one
// signal. A comment saying so is not a gate - this is the gate.
const SRC_DIR = path.join(__dirname, '..', 'src');
const REPO_ROOT = path.join(__dirname, '..');

// switchRoleEffort is the single settings-write + respawn mechanism (BL-236).
// Only these two files may reference it: where it is defined, and the
// operator's manual dial. There is deliberately no Adapt entry - Adapt
// applies in Babashka.
const ALLOWED_EFFORT_WRITERS = [
  path.join('src', 'swarm', 'effortDial.ts'), // definition site
  path.join('src', 'panel', 'swarmPanel.ts'), // BL-236 operator dial
];

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('BL-1317: no TypeScript module beyond the dial and the operator panel calls switchRoleEffort', () => {
  const offenders = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const relative = path.relative(REPO_ROOT, file);
    if (ALLOWED_EFFORT_WRITERS.includes(relative)) {
      continue;
    }
    if (/\bswitchRoleEffort\s*\(/.test(fs.readFileSync(file, 'utf8'))) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a second Adapt applier would double-climb against handoff_lib.bb::record-effort-adapt!; found: ${JSON.stringify(offenders)}`,
  );
});

test('BL-1317: no TypeScript module applies Adapt at all', () => {
  // The amended wiring puts the whole Adapt path in Babashka. A TypeScript
  // adapt applier reappearing - under any name reached from an adapt-shaped
  // symbol - is a second reaction to the same outcome signal.
  const offenders = [];
  for (const file of listTsFiles(SRC_DIR)) {
    if (/\badaptRoleEffort\s*\(|\bdecideAdaptEffort\s*\(/.test(fs.readFileSync(file, 'utf8'))) {
      offenders.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Adapt applies in Babashka only; found TypeScript Adapt code in: ${JSON.stringify(offenders)}`,
  );
});

test('BL-1317: the one Adapt applier that does exist is the wired Babashka one', () => {
  // The negative half above passes trivially in a tree where Adapt was
  // deleted outright. This is the positive anchor: the decision, its IO edge,
  // and the pre-existing live consumer that reaches it (BL-1235).
  const SCRIPTS = path.join(REPO_ROOT, '..', 'swarmforge', 'scripts');
  const wiring = [
    [path.join(SCRIPTS, 'seat_difficulty_lib.bb'), 'adapt-effort-decision'],
    [path.join(SCRIPTS, 'handoff_lib.bb'), 'record-effort-adapt!'],
    [path.join(SCRIPTS, 'done_with_current_task.bb'), 'record-effort-adapt!'],
  ];
  for (const [file, symbol] of wiring) {
    assert.ok(
      fs.readFileSync(file, 'utf8').includes(symbol),
      `${path.basename(file)} no longer reaches ${symbol} - Adapt has no applier left`,
    );
  }
});
