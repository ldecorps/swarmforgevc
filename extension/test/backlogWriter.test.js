const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setAssignedTo, markDone, promoteToActive, parkToHold, reinstateFromHold, findBacklogFilePath } = require('../out/panel/backlogWriter');
const { readBacklog } = require('../out/panel/backlogReader');

function mkTmp() {
  return mkTmpDir('sfvc-backlog-writer-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeActiveItem(targetPath, filename, yaml) {
  const dir = path.join(targetPath, 'backlog', 'active');
  mkdirp(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, yaml);
  return filePath;
}

// --- setAssignedTo (BL-034 backlog-two-way-sync-04) ---

test('setAssignedTo updates only the assigned_to field, leaving every other field byte-identical', () => {
  const target = mkTmp();
  const yaml = 'id: BL-100\ntitle: some item\nstatus: active\npriority: 10\nassigned_to: coder\n\ndescription: |\n  multi\n  line\n  block\n';
  const filePath = writeActiveItem(target, 'BL-100-some-item.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-100', 'cleaner');

  assert.equal(ok, true);
  const updated = fs.readFileSync(filePath, 'utf8');
  assert.equal(updated, yaml.replace('assigned_to: coder', 'assigned_to: cleaner'));
});

test('setAssignedTo returns false when the item id does not exist in backlog/active', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
});

test('setAssignedTo does not match a file whose parsed id differs from the requested id', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-105-other.yaml', 'id: BL-105\ntitle: other\nstatus: active\nassigned_to: coder\n');

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
  const untouched = fs.readFileSync(path.join(target, 'backlog', 'active', 'BL-105-other.yaml'), 'utf8');
  assert.match(untouched, /assigned_to: coder/);
});

test('setAssignedTo returns false without throwing when backlog/active does not exist', () => {
  const target = mkTmp();

  assert.equal(setAssignedTo(target, 'BL-404', 'cleaner'), false);
});

test('setAssignedTo returns false and leaves the file untouched when it has no assigned_to line', () => {
  const target = mkTmp();
  const yaml = 'id: BL-106\ntitle: no assignee\nstatus: active\n';
  const filePath = writeActiveItem(target, 'BL-106-no-assignee.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-106', 'cleaner');

  assert.equal(ok, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), yaml);
});

test('setAssignedTo replaces only the line that begins with assigned_to, not an occurrence embedded in another key', () => {
  const target = mkTmp();
  const yaml = 'id: BL-107\ntitle: t\nstatus: active\nprevious_assigned_to: ghost\nassigned_to: coder\n';
  const filePath = writeActiveItem(target, 'BL-107-anchor.yaml', yaml);

  const ok = setAssignedTo(target, 'BL-107', 'cleaner');

  assert.equal(ok, true);
  const updated = fs.readFileSync(filePath, 'utf8');
  assert.match(updated, /^previous_assigned_to: ghost$/m);
  assert.match(updated, /^assigned_to: cleaner$/m);
});

test('setAssignedTo updates the field even when there is no space after the colon', () => {
  const target = mkTmp();
  const filePath = writeActiveItem(target, 'BL-108-nospace.yaml', 'id: BL-108\ntitle: t\nstatus: active\nassigned_to:coder\n');

  const ok = setAssignedTo(target, 'BL-108', 'cleaner');

  assert.equal(ok, true);
  assert.match(fs.readFileSync(filePath, 'utf8'), /^assigned_to: cleaner$/m);
});

test('setAssignedTo ignores non-.yaml files in backlog/active even when one parses and matches first alphabetically', () => {
  const target = mkTmp();
  const activeDir = path.join(target, 'backlog', 'active');
  mkdirp(activeDir);
  const decoyPath = path.join(activeDir, '0-decoy.txt');
  fs.writeFileSync(decoyPath, 'id: BL-109\ntitle: decoy\nstatus: active\nassigned_to: ghost\n');
  const filePath = writeActiveItem(target, 'BL-109-real.yaml', 'id: BL-109\ntitle: real\nstatus: active\nassigned_to: coder\n');

  const ok = setAssignedTo(target, 'BL-109', 'cleaner');

  assert.equal(ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'id: BL-109\ntitle: real\nstatus: active\nassigned_to: cleaner\n');
  assert.equal(fs.readFileSync(decoyPath, 'utf8'), 'id: BL-109\ntitle: decoy\nstatus: active\nassigned_to: ghost\n');
});

// --- markDone (BL-034 backlog-two-way-sync-03) ---

test('markDone moves the file to backlog/done/<milestone>/ when the item has a milestone', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-101-milestone-item.yaml', 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');

  const result = markDone(target, 'BL-101');

  assert.equal(result.moved, true);
  assert.equal(result.destination, path.join(target, 'backlog', 'done', 'M4', 'BL-101-milestone-item.yaml'));
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-101-milestone-item.yaml')), false);
  assert.equal(fs.existsSync(result.destination), true);
});

test('markDone moves the file to flat backlog/done/ when the item has no milestone', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-102-no-milestone.yaml', 'id: BL-102\ntitle: t\nstatus: active\n');

  const result = markDone(target, 'BL-102');

  assert.equal(result.destination, path.join(target, 'backlog', 'done', 'BL-102-no-milestone.yaml'));
});

test('markDone does not rewrite the YAML status field - the folder is authoritative', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-103-status-check.yaml', 'id: BL-103\ntitle: t\nstatus: active\nmilestone: M4\n');

  const result = markDone(target, 'BL-103');

  const content = fs.readFileSync(result.destination, 'utf8');
  assert.match(content, /^status: active$/m);
});

test('markDone result is visible as done when the backlog is re-read (folder authoritative)', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-104-visible.yaml', 'id: BL-104\ntitle: t\nstatus: active\nmilestone: M4\n');

  markDone(target, 'BL-104');

  const items = readBacklog(target);
  const item = items.find((i) => i.id === 'BL-104');
  assert.equal(item.status, 'done');
});

test('markDone returns moved false when the item id does not exist in backlog/active', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));

  const result = markDone(target, 'BL-404');

  assert.equal(result.moved, false);
});

// --- promoteToActive (BL-490's Expedite promote step, BL-1083's gate) ---

function writePausedItem(targetPath, filename, yaml) {
  const dir = path.join(targetPath, 'backlog', 'paused');
  mkdirp(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, yaml);
  return filePath;
}

// BL-1083: promoteToActive now takes its verdict from the REAL promotion-gates
// CLI, so a fixture that wants to be promoted has to carry it. The copy list is
// DERIVED from the CLI's own transitive load-file closure (BL-973) rather than
// written out here, so a new load-file edge upstream cannot silently strand
// these fixtures the way it stranded five others.
const { installPromotionGates } = require(path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'promotionGatesFixture.js'));

// A ticket every gate lets through: approved, no dependencies.
const CLEARED = (id) => `id: ${id}\ntitle: t\nhuman_approval: approved\ndepends_on: []\n`;

test('promoteToActive moves a paused item into flat backlog/active/', () => {
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-200-paused-item.yaml', CLEARED('BL-200'));

  const result = promoteToActive(target, 'BL-200');

  assert.equal(result.moved, true);
  assert.equal(result.destination, path.join(target, 'backlog', 'active', 'BL-200-paused-item.yaml'));
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-200-paused-item.yaml')), false);
  assert.equal(fs.existsSync(result.destination), true);
});

test('promoteToActive does not rewrite the YAML content - only the file moves', () => {
  const target = installPromotionGates(mkTmp());
  const yaml = CLEARED('BL-201');
  writePausedItem(target, 'BL-201-content-check.yaml', yaml);

  const result = promoteToActive(target, 'BL-201');

  assert.equal(fs.readFileSync(result.destination, 'utf8'), yaml);
});

test('promoteToActive result is visible as active when the backlog is re-read', () => {
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-202-visible.yaml', CLEARED('BL-202'));

  promoteToActive(target, 'BL-202');

  const items = readBacklog(target);
  const item = items.find((i) => i.id === 'BL-202');
  assert.equal(item.status, 'active');
});

test('promoteToActive returns moved false when the item id does not exist in backlog/paused', () => {
  const target = installPromotionGates(mkTmp());
  mkdirp(path.join(target, 'backlog', 'paused'));

  const result = promoteToActive(target, 'BL-404');

  assert.equal(result.moved, false);
});

test('promoteToActive returns moved false without throwing when backlog/paused does not exist', () => {
  const target = mkTmp();

  const result = promoteToActive(target, 'BL-404');

  assert.equal(result.moved, false);
});

// --- BL-1083: every promotion takes its verdict from the shared gates ---

test('BL-1083: a ticket whose depends_on is not landed is refused, and stays paused', () => {
  const target = installPromotionGates(mkTmp());
  // The live incident, reduced: BL-1078 declared depends_on: [BL-713] with
  // BL-713 still active rather than in backlog/done/.
  writeActiveItem(target, 'BL-713-dep.yaml', 'id: BL-713\ntitle: dep\n');
  writePausedItem(
    target,
    'BL-1078-needs-dep.yaml',
    'id: BL-1078\ntitle: t\nhuman_approval: approved\ndepends_on: [BL-713]\n'
  );

  const result = promoteToActive(target, 'BL-1078');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'depends_on');
  assert.match(result.refusal.reason, /BL-713/);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-1078-needs-dep.yaml')), true);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-1078-needs-dep.yaml')), false);
});

test('BL-1083: a ticket in backlog/hold/ is refused by the hold gate, not silently ignored', () => {
  const target = installPromotionGates(mkTmp());
  const holdDir = path.join(target, 'backlog', 'hold');
  mkdirp(holdDir);
  fs.writeFileSync(path.join(holdDir, 'BL-300-held.yaml'), CLEARED('BL-300'));

  const result = promoteToActive(target, 'BL-300');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'hold marker');
  assert.equal(fs.existsSync(path.join(holdDir, 'BL-300-held.yaml')), true);
});

test('BL-1083: the depth cap refuses when active is already at the cap', () => {
  const target = installPromotionGates(mkTmp(), { maxDepth: 1 });
  writeActiveItem(target, 'BL-301-occupant.yaml', 'id: BL-301\ntitle: t\n');
  writePausedItem(target, 'BL-302-wants-in.yaml', CLEARED('BL-302'));

  const result = promoteToActive(target, 'BL-302');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'active_backlog_max_depth');
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-302-wants-in.yaml')), true);
});

test('BL-1083: a refusal names its own gate, never a generic one', () => {
  // Each refusal must be actionable on its own terms: an operator told only
  // "refused" cannot tell an unlanded dependency from a full queue.
  const depTarget = installPromotionGates(mkTmp());
  writePausedItem(depTarget, 'BL-310-dep.yaml', 'id: BL-310\ntitle: t\nhuman_approval: approved\ndepends_on: [BL-999]\n');
  const capTarget = installPromotionGates(mkTmp(), { maxDepth: 1 });
  writeActiveItem(capTarget, 'BL-311-occupant.yaml', 'id: BL-311\ntitle: t\n');
  writePausedItem(capTarget, 'BL-312-wants-in.yaml', CLEARED('BL-312'));

  const depRefusal = promoteToActive(depTarget, 'BL-310').refusal;
  const capRefusal = promoteToActive(capTarget, 'BL-312').refusal;

  assert.notEqual(depRefusal.gate, capRefusal.gate);
  assert.equal(depRefusal.gate, 'depends_on');
  assert.equal(capRefusal.gate, 'active_backlog_max_depth');
});

test('BL-1083: a ticket awaiting approval is refused for human_approval, so Expedite must record approval first', () => {
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-320-pending.yaml', 'id: BL-320\ntitle: t\nhuman_approval: pending\ndepends_on: []\n');

  const result = promoteToActive(target, 'BL-320');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'human_approval');
});

test('BL-1083: an approved ticket no gate refuses is still promoted - the verb is not dead', () => {
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-321-clear.yaml', CLEARED('BL-321'));

  const result = promoteToActive(target, 'BL-321');

  assert.equal(result.moved, true);
  assert.equal(result.refusal, undefined);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-321-clear.yaml')), true);
});

test('BL-1083: the gates failing closed - an unreachable CLI refuses rather than promoting ungated', () => {
  // A gate that fails open is not a gate. This fixture has a paused ticket and
  // NO swarmforge/scripts at all.
  const target = mkTmp();
  writePausedItem(target, 'BL-330-ungated.yaml', CLEARED('BL-330'));

  const result = promoteToActive(target, 'BL-330');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'promotion_gates');
  assert.match(result.refusal.reason, /could not be consulted/);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-330-ungated.yaml')), true);
});

test('BL-1083: an unrecognised verdict from the gate CLI refuses rather than guessing', () => {
  // The CLI is reached and exits cleanly, but prints something that is
  // neither ALLOW, NOT_FOUND, nor REFUSE|... - a contract break the mover
  // cannot interpret, so it refuses rather than treating unknown as allow.
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-331-garbage.yaml', CLEARED('BL-331'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(println "GARBAGE")\n(System/exit 0)\n');

  const result = promoteToActive(target, 'BL-331');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'promotion_gates');
  assert.match(result.refusal.reason, /unrecognised verdict/);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-331-garbage.yaml')), true);
});

test('BL-1083: the gate CLI exiting with an unexpected code refuses rather than promoting ungated', () => {
  // Neither exit 1 (NOT_FOUND) nor exit 2 (REFUSE) - a crash. A gate that
  // fails open on a crash is not a gate.
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-332-crash.yaml', CLEARED('BL-332'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(System/exit 42)\n');

  const result = promoteToActive(target, 'BL-332');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'promotion_gates');
  assert.match(result.refusal.reason, /could not be consulted/);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-332-crash.yaml')), true);
});

test('BL-1083: an ALLOW verdict is recognised even when the CLI pads its line with whitespace', () => {
  // parseGateVerdict trims each stdout line before matching ALLOW/NOT_FOUND/
  // REFUSE| - a robustness property the fixture's own clean output never
  // otherwise exercises.
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-342-padded.yaml', CLEARED('BL-342'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(println "  ALLOW  ")\n(System/exit 0)\n');

  const result = promoteToActive(target, 'BL-342');

  assert.equal(result.moved, true, 'a padded ALLOW line must still be recognised as ALLOW, not fall through to unrecognised');
});

test('BL-1083: a REFUSE reason containing its own pipe character survives verbatim', () => {
  // REFUSE|<gate>|<reason> is split on '|' and the reason half rejoined the
  // same way - a reason that itself contains a literal '|' must come back
  // whole, not truncated at the first embedded pipe.
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-343-pipe-reason.yaml', CLEARED('BL-343'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(println "REFUSE|some_gate|reason with a | pipe inside")\n(System/exit 2)\n');

  const result = promoteToActive(target, 'BL-343');

  assert.equal(result.refusal.gate, 'some_gate');
  assert.equal(result.refusal.reason, 'reason with a | pipe inside');
});

test('BL-1083: a CLI that exits cleanly with no stdout at all names it "(no output)", not an empty reason', () => {
  const target = installPromotionGates(mkTmp());
  writePausedItem(target, 'BL-344-blank.yaml', CLEARED('BL-344'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(System/exit 0)\n');

  const result = promoteToActive(target, 'BL-344');

  assert.equal(result.moved, false);
  assert.equal(result.refusal.gate, 'promotion_gates');
  assert.match(result.refusal.reason, /\(no output\)/);
});

test('BL-1083: a NOT_FOUND verdict from the gate CLI is a hard stop, never overridden by a paused file that happens to exist', () => {
  // If the NOT_FOUND branch (parseGateVerdict's own, or promoteToActive's
  // check of it) were ever disabled, this would fall through to the ALLOW
  // path and promote the very file the gate just said did not exist. The
  // gate's verdict must win regardless of what the filesystem shows.
  const target = installPromotionGates(mkTmp());
  const filePath = writePausedItem(target, 'BL-345-notfound-verdict.yaml', CLEARED('BL-345'));
  const cliPath = path.join(target, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
  fs.writeFileSync(cliPath, '(println "NOT_FOUND")\n(System/exit 1)\n');

  const result = promoteToActive(target, 'BL-345');

  assert.equal(result.moved, false);
  assert.equal(fs.existsSync(filePath), true, 'the ticket must stay exactly where it was');
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-345-notfound-verdict.yaml')), false);
});

test('BL-1083: an ALLOW verdict for a file the mover cannot itself re-locate by id promotes nothing, and never crashes', () => {
  // The gate CLI locates its candidate by FILENAME glob; the mover
  // independently re-locates by the YAML's own parsed id before it will move
  // anything. A file named for one id but whose own `id:` field names
  // another is exactly the gap between those two lookups - the gate can
  // still evaluate and ALLOW it (evaluate never reads the requested id), but
  // the mover's own re-lookup must refuse to promote a file it cannot
  // confirm by content, not fall back to "the gate found it, so move it".
  const target = installPromotionGates(mkTmp());
  const filePath = writePausedItem(target, 'BL-346-mismatch.yaml', CLEARED('BL-999'));

  const result = promoteToActive(target, 'BL-346');

  assert.equal(result.moved, false);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-346-mismatch.yaml')), false);
});

test('promoteToActive skips promotion when the item is already active (scenario 05: no redundant promotion)', () => {
  const target = installPromotionGates(mkTmp());
  writeActiveItem(target, 'BL-203-already-active.yaml', 'id: BL-203\ntitle: t\nstatus: active\n');

  const result = promoteToActive(target, 'BL-203');

  assert.equal(result.moved, false);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-203-already-active.yaml')), true);
});

// --- parkToHold / reinstateFromHold (BL-698) ---

test('BL-698: parkToHold moves active ticket into backlog/hold/', () => {
  const target = mkTmp();
  writeActiveItem(target, 'BL-697-hold.yaml', 'id: BL-697\ntitle: t\n');
  const result = parkToHold(target, 'BL-697');
  assert.equal(result.moved, true);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'hold', 'BL-697-hold.yaml')), true);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'active', 'BL-697-hold.yaml')), false);
});

test('BL-698: reinstateFromHold restores hold ticket to paused/', () => {
  const target = mkTmp();
  const holdDir = path.join(target, 'backlog', 'hold');
  mkdirp(holdDir);
  fs.writeFileSync(path.join(holdDir, 'BL-697-hold.yaml'), 'id: BL-697\ntitle: t\n');
  const result = reinstateFromHold(target, 'BL-697');
  assert.equal(result.moved, true);
  assert.equal(fs.existsSync(path.join(target, 'backlog', 'paused', 'BL-697-hold.yaml')), true);
});

// --- findBacklogFilePath (BL-490-VIOLATION: locates a ticket's CURRENT file
// regardless of which live folder it sits in, so a durable-commit caller can
// resolve the right repo-relative path after a promote/approve write) ---

test('findBacklogFilePath finds an item in backlog/active', () => {
  const target = mkTmp();
  const filePath = writeActiveItem(target, 'BL-300-active.yaml', 'id: BL-300\ntitle: t\n');

  assert.equal(findBacklogFilePath(target, 'BL-300'), filePath);
});

test('findBacklogFilePath finds an item in backlog/paused when not in active', () => {
  const target = mkTmp();
  const dir = path.join(target, 'backlog', 'paused');
  mkdirp(dir);
  const filePath = path.join(dir, 'BL-301-paused.yaml');
  fs.writeFileSync(filePath, 'id: BL-301\ntitle: t\n');

  assert.equal(findBacklogFilePath(target, 'BL-301'), filePath);
});

test('findBacklogFilePath prefers active over paused when (implausibly) both exist', () => {
  const target = mkTmp();
  const activePath = writeActiveItem(target, 'BL-302-both.yaml', 'id: BL-302\ntitle: active copy\n');
  const pausedDir = path.join(target, 'backlog', 'paused');
  mkdirp(pausedDir);
  fs.writeFileSync(path.join(pausedDir, 'BL-302-both.yaml'), 'id: BL-302\ntitle: paused copy\n');

  assert.equal(findBacklogFilePath(target, 'BL-302'), activePath);
});

test('findBacklogFilePath returns null when the item exists in neither folder', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'backlog', 'active'));

  assert.equal(findBacklogFilePath(target, 'BL-404'), null);
});
