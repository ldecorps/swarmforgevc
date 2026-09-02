const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-1317 (QA bounce D1 remedy). Adapt has exactly ONE applier per language.
//
// The LIVE Adapt applier is the Babashka one: handoff_lib.bb::record-effort-
// adapt!, wired at done_with_current_task.bb, which rewrites the seat's
// launch settings itself and whose climb even survives the ticket's re-claim
// (seat_difficulty_lib.bb::claim-effort-decision's `climbed` branch). It and
// the TypeScript apply edge (effortDialAdapt.ts::adaptRoleEffort) write the
// SAME .swarmforge/launch/<role>.claude-settings.json effortLevel, so a
// second automatic applier on the TypeScript side would double-climb a seat
// on one outcome signal.
//
// That is why effortDialAdapt.ts has no automatic caller and must not grow
// one: adaptRoleEffort is the apply edge reserved for an OPERATOR-driven UI
// or launch path (BL-236's manual dial in swarmPanel.ts is the precedent),
// never a second reaction to the same outcome the bb consumer already
// observes. A comment saying so is not a gate - this is the gate.
const SRC_DIR = path.join(__dirname, '..', 'src');
const REPO_ROOT = path.join(__dirname, '..');

// switchRoleEffort is the single settings-write + respawn mechanism (BL-236).
// Only these three files may reference it: where it is defined, the Adapt
// apply edge, and the operator's manual dial.
const ALLOWED_EFFORT_WRITERS = [
  path.join('src', 'swarm', 'effortDial.ts'), // definition site
  path.join('src', 'tools', 'effortDialAdapt.ts'), // Adapt apply edge
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

test('BL-1317: no TypeScript module beyond the dial, the Adapt edge and the operator panel calls switchRoleEffort', () => {
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

test('BL-1317: adaptRoleEffort is not invoked from any automatic (non-operator) path', () => {
  // adaptRoleEffort APPLIES. Anything that calls it is applying Adapt, so the
  // only admissible caller is an operator-driven surface. swarmPanel.ts is
  // the one such surface today; a call appearing anywhere else means an
  // automatic TypeScript reaction was added alongside the bb consumer.
  const ALLOWED_ADAPT_CALLERS = [
    path.join('src', 'tools', 'effortDialAdapt.ts'), // definition site
    path.join('src', 'panel', 'swarmPanel.ts'), // operator-driven surface
  ];
  const offenders = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const relative = path.relative(REPO_ROOT, file);
    if (ALLOWED_ADAPT_CALLERS.includes(relative)) {
      continue;
    }
    if (/\badaptRoleEffort\s*\(/.test(fs.readFileSync(file, 'utf8'))) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `unexpected automatic adaptRoleEffort caller(s): ${JSON.stringify(offenders)}`);
});
