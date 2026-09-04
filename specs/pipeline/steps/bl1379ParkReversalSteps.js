'use strict';

// BL-1379: an expedition reverses its own park.
//
// `park-plan` moved every other active ticket into `backlog/hold/` at
// initiation and nothing ever moved them back. Article 3.1 makes hold/
// HUMAN-HELD - "they sit until a human moves them back" - so a mechanical,
// temporary park landed in a folder whose whole contract is that only a human
// empties it, and became indistinguishable from a deliberate hold the moment
// the run ended. Five tickets sat there from 12:02 on 2026-09-04.
//
// Every scenario drives the REAL reversal over a REAL git repository with a
// REAL `git merge-base --is-ancestor` check, through
// lib/bl1379ParkReversalCli.sh. Invariant 2 is about whether the expedition
// LANDED, and a fixture that fakes that check cannot exhibit the thing it
// guards.
//
// A human-held ticket (BL-9003) is present in EVERY shape, not only in the
// scenario named for it: invariant 1 is the one this ticket must not break,
// so it is under test on every path rather than once.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1379ParkReversalCli.sh');
const FIXTURE_PREFIX = 'bl1379-acc-';

const FEATURE = "BL-1379 An expedition's park reverses itself when the expedition lands";

// The Examples' own words, mapped to the fixture shape each is built as.
const CHANGES = {
  'moved by hand to backlog/active/': 'moved',
  'closed into backlog/done/': 'closed',
};

function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function runFixture(shape) {
  sweepFixtures();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, shape], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 600_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const folderOf = (report, id) => {
  for (const [folder, key] of [
    ['hold', 'holdAfter'],
    ['active', 'activeAfter'],
    ['paused', 'pausedAfter'],
    ['done', 'doneAfter'],
  ]) {
    if (report[key].includes(id)) return folder;
  }
  return null;
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^an expedition that parked ticket "BL-9002" out of backlog\/active\/$/, (ctx) => {
    ctx.bl1379 = { shape: 'landed' };
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the expedition's approved commit is an ancestor of main$/, (ctx) => {
    // Only set the default when a more specific Given has not already chosen
    // a shape - the outline rows and the human-held scenario come first.
    if (!ctx.bl1379.shapeChosen) ctx.bl1379.shape = 'landed';
  });

  scoped(/^the expedition's approved commit is not an ancestor of main$/, (ctx) => {
    ctx.bl1379.shape = 'not-landed';
    ctx.bl1379.shapeChosen = true;
  });

  scoped(/^a ticket "BL-9003" that a human placed in backlog\/hold\/$/, (ctx) => {
    ctx.bl1379.shape = 'human-held';
    ctx.bl1379.shapeChosen = true;
  });

  scoped(/^the park reversal has already run$/, (ctx) => {
    ctx.bl1379.shape = 'twice';
    ctx.bl1379.shapeChosen = true;
  });

  scoped(/^"BL-9002" has since been (.+)$/, (ctx, change) => {
    const shape = CHANGES[change.trim()];
    assert.ok(shape, `unknown change: ${change}`);
    ctx.bl1379.shape = shape;
    ctx.bl1379.shapeChosen = true;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the park reversal runs$/, (ctx) => {
    assert.ok(ctx.bl1379.shape, 'no fixture shape was chosen');
    ctx.bl1379.report = runFixture(ctx.bl1379.shape);
  });

  scoped(/^the expedition parks the field$/, (ctx) => {
    ctx.bl1379.report = runFixture('landed');
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^"(BL-\d+)" is no longer in backlog\/hold\/$/, (ctx, id) => {
    assert.ok(
      !ctx.bl1379.report.holdAfter.includes(id),
      `${id} is still held: ${JSON.stringify(ctx.bl1379.report.holdAfter)}`
    );
  });

  scoped(/^"(BL-\d+)" is still in backlog\/hold\/$/, (ctx, id) => {
    assert.ok(
      ctx.bl1379.report.holdAfter.includes(id),
      `${id} left hold/ when it should not have: ${JSON.stringify(ctx.bl1379.report)}`
    );
  });

  scoped(/^"(BL-\d+)" is in backlog\/(\w+)\/$/, (ctx, id, folder) => {
    assert.equal(
      folderOf(ctx.bl1379.report, id),
      folder,
      `${id} is not in backlog/${folder}/: ${JSON.stringify(ctx.bl1379.report)}`
    );
  });

  scoped(/^the report names "(BL-\d+)" as restored$/, (ctx, id) => {
    assert.ok(
      ctx.bl1379.report.restored.includes(id),
      `the report does not name ${id} as restored: ${JSON.stringify(ctx.bl1379.report.restored)}`
    );
  });

  scoped(/^the report does not name "(BL-\d+)"$/, (ctx, id) => {
    const { report } = ctx.bl1379;
    // Invariant 1: a human's held ticket is not merely left in place - the
    // reversal never considered it, so it appears nowhere in the report.
    assert.ok(!report.restored.includes(id), `${id} was restored: ${JSON.stringify(report)}`);
    assert.ok(
      !report.left.some((l) => l.ticket === id),
      `${id} was even considered by the reversal: ${JSON.stringify(report.left)}`
    );
  });

  scoped(/^the closing handover still names "(BL-\d+)" as parked$/, (ctx, id) => {
    const { report } = ctx.bl1379;
    // Invariant 2: an expedition that never lands leaves the park in place and
    // REPORTED - never silently stranded, which is the whole defect.
    assert.ok(
      report.left.some((l) => l.ticket === id && l.reason === 'hold-not-landed'),
      `${id} was not reported as still parked: ${JSON.stringify(report.left)}`
    );
    assert.match(report.note, /has not landed/, report.note);
  });

  scoped(/^the report names nothing as restored$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1379.report.restored,
      [],
      `a second reversal restored something: ${JSON.stringify(ctx.bl1379.report.restored)}`
    );
  });

  scoped(/^"(BL-\d+)" is left exactly where it is$/, (ctx, id) => {
    const { report } = ctx.bl1379;
    assert.deepEqual(report.restored, [], `${id} was moved by the reversal`);
    assert.ok(folderOf(report, id), `${id} vanished entirely: ${JSON.stringify(report)}`);
  });

  scoped(/^the report names "(BL-\d+)" as skipped$/, (ctx, id) => {
    const entry = ctx.bl1379.report.left.find((l) => l.ticket === id);
    assert.ok(entry, `${id} is not named in the report: ${JSON.stringify(ctx.bl1379.report.left)}`);
    // Named WITH its reason: "left alone" and "left alone because it was
    // closed" are different facts to whoever reads the handover.
    assert.match(entry.reason, /^skip-/, `${id} was not reported as skipped: ${entry.reason}`);
  });

  // ── Scenarios 08/09, added by the specifier's 2026-09-04 amendment after
  //    the option-1 scenario was RETIRED (never reworded). The mark is not a
  //    flag: `status: blocked` is the half promote_and_route_next.sh and the
  //    dropped-parcel sweep actually read, so the ticket is genuinely
  //    unworkable rather than merely annotated - which is what my own first
  //    version got wrong, marking a ticket that the coordinator's depth check
  //    would have picked straight back up.
  scoped(/^"(BL-\d+)" reads status blocked$/, (ctx, id) => {
    assert.equal(
      ctx.bl1379.report.restoredStatus,
      'blocked',
      `${id} was restored without being blocked: ${JSON.stringify(ctx.bl1379.report)}`
    );
  });

  scoped(/^"(BL-\d+)" carries freshness_check required naming the expedition$/, (ctx, id) => {
    const { report } = ctx.bl1379;
    assert.equal(report.marked, true, `${id} carries no freshness_check field`);
    // Naming the run is what lets a coordinator tell WHICH expedition to check
    // against; a bare flag would say only that something happened.
    assert.equal(
      report.markNamesRun,
      true,
      `the mark does not name the expedition that parked ${id}`
    );
  });

  scoped(/^the promotion helper skips "(BL-\d+)" as blocked$/, (ctx, id) => {
    // Asked of the REAL promotion gate, not restated here: the mark is only
    // worth anything if production's own gate refuses the ticket.
    assert.equal(
      ctx.bl1379.report.promotionBlocked,
      true,
      `the promotion gate would still promote ${id}: ${JSON.stringify(ctx.bl1379.report)}`
    );
  });

  scoped(/^the report names "(BL-\d+)" as restored and marked$/, (ctx, id) => {
    const { report } = ctx.bl1379;
    assert.ok(report.restored.includes(id), `${id} not named as restored`);
    assert.ok(
      (report.restoredAndMarked || []).includes(id),
      `${id} is not named as restored AND marked - "back" and "back but not workable" are different facts to the reader: ${JSON.stringify(report)}`
    );
  });

  scoped(/^a durable park record names "(BL-\d+)"$/, (ctx, id) => {
    // The record is what drives the reversal, so its presence is proven by the
    // reversal having acted on exactly that ticket and no other.
    const { report } = ctx.bl1379;
    assert.ok(
      report.restored.includes(id) || report.left.some((l) => l.ticket === id),
      `no record entry drove any decision for ${id}: ${JSON.stringify(report)}`
    );
  });

  scoped(/^the record names the folder "(BL-\d+)" was parked from$/, (ctx, id) => {
    // Restored to active/, which is where the record says it came from - not
    // to a folder the reversal chose for itself.
    assert.equal(
      folderOf(ctx.bl1379.report, id),
      'active',
      `${id} was not restored to its recorded origin: ${JSON.stringify(ctx.bl1379.report)}`
    );
    assert.equal(ctx.bl1379.report.marked, true, 'the restored ticket was not marked for a freshness check');
  });
}

module.exports = { registerSteps };
