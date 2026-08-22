const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appendSiblingDeferralRecordIfNew } = require('../out/metrics/siblingDeferralStore');
const { resolveBlockerClosure, computeTicketDeferralStatus, listStrandedDeferrals } = require('../out/metrics/siblingDeferralStatus');

// BL-861: the single shared lookup reconciling a recorded deferral against
// whether its blocker has since closed - the same computeTicketDeferralStatus
// backs both `status --ticket <T>` and `list`, so they can never disagree.

function mkTmp() {
  return mkTmpDir('sfvc-sibling-deferral-status-');
}

function writeTicketYaml(dir, id, extra = '') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-some-slug.yaml`), `id: ${id}\ntitle: "some ticket"\n${extra}`);
}

function deferRecord(overrides = {}) {
  return {
    ticket: 'BL-574',
    blockedBy: 'BL-681',
    action: 'defer',
    failureClass: 'integration',
    check: 'npm run test',
    commit: 'abc1234567',
    at: '2026-07-17T10:00:00.000Z',
    ...overrides,
  };
}

// ── resolveBlockerClosure ──────────────────────────────────────────────────

test('a blocker still sitting in backlog/active/ is reported open', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-681');
  assert.deepEqual(resolveBlockerClosure(target, 'BL-681'), { closed: false });
});

test('a blocker with no ticket file anywhere is reported open (never falsely releasable)', () => {
  const target = mkTmp();
  assert.deepEqual(resolveBlockerClosure(target, 'BL-681'), { closed: false });
});

test('a blocker moved to a flat backlog/done/ is reported closed, naming its path', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  const closure = resolveBlockerClosure(target, 'BL-681');
  assert.equal(closure.closed, true);
  assert.equal(closure.closedAt, path.join('backlog', 'done', 'BL-681-some-slug.yaml'));
});

test('a blocker moved to a per-milestone backlog/done/<milestone>/ is reported closed, naming the milestone path', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done', 'M8'), 'BL-681');
  const closure = resolveBlockerClosure(target, 'BL-681');
  assert.equal(closure.closed, true);
  assert.equal(closure.closedAt, path.join('backlog', 'done', 'M8', 'BL-681-some-slug.yaml'));
});

test('resolveBlockerClosure is case-insensitive on the ticket id', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  assert.equal(resolveBlockerClosure(target, 'bl-681').closed, true);
});

// ── computeTicketDeferralStatus ────────────────────────────────────────────

test('a ticket with no deferral record at all reports verify', () => {
  const target = mkTmp();
  assert.deepEqual(computeTicketDeferralStatus(target, 'BL-574'), { ticket: 'BL-574', kind: 'verify', openBlockers: [], closedBlockers: [] });
});

test('a ticket whose sole blocker is still active reports deferred, naming that blocker', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  const report = computeTicketDeferralStatus(target, 'BL-574');
  assert.equal(report.kind, 'deferred');
  assert.equal(report.openBlockers.length, 1);
  assert.equal(report.openBlockers[0].blockedBy, 'BL-681');
  assert.deepEqual(report.closedBlockers, []);
});

test('a ticket whose sole blocker has closed reports releasable, naming where it closed, with no open blockers', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  const report = computeTicketDeferralStatus(target, 'BL-574');
  assert.equal(report.kind, 'releasable');
  assert.deepEqual(report.openBlockers, []);
  assert.equal(report.closedBlockers.length, 1);
  assert.equal(report.closedBlockers[0].blockedBy, 'BL-681');
  assert.equal(report.closedBlockers[0].closedAt, path.join('backlog', 'done', 'BL-681-some-slug.yaml'));
});

test('a ticket blocked by two, one closed and one still active, stays deferred and names only the open one', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-762');
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-681' }));
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-762', check: 'npm run acceptance', at: '2026-07-17T10:00:01.000Z' }));
  const report = computeTicketDeferralStatus(target, 'BL-574');
  assert.equal(report.kind, 'deferred');
  assert.deepEqual(report.openBlockers.map((b) => b.blockedBy), ['BL-762']);
  assert.deepEqual(report.closedBlockers.map((b) => b.blockedBy), ['BL-681']);
});

test('a ticket blocked by two, both closed, reports releasable naming both', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-762');
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-681' }));
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-762', check: 'npm run acceptance', at: '2026-07-17T10:00:01.000Z' }));
  const report = computeTicketDeferralStatus(target, 'BL-574');
  assert.equal(report.kind, 'releasable');
  assert.deepEqual(report.closedBlockers.map((b) => b.blockedBy).sort(), ['BL-681', 'BL-762']);
});

test('a cleared blocker never reports releasable - clearing removes it from the deferral entirely (releasable is distinct from cleared)', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  appendSiblingDeferralRecordIfNew(target, { ticket: 'BL-574', blockedBy: 'BL-681', action: 'clear', commit: 'def4567890', at: '2026-07-18T10:00:00.000Z' });
  assert.equal(computeTicketDeferralStatus(target, 'BL-574').kind, 'verify');
});

// ── listStrandedDeferrals ──────────────────────────────────────────────────

test('list surfaces a stranded ticket without it being named in advance', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  const stranded = listStrandedDeferrals(target);
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].ticket, 'BL-574');
  assert.equal(stranded[0].kind, 'releasable');
});

test('list omits a ticket still genuinely blocked by an open sibling', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  assert.deepEqual(listStrandedDeferrals(target), []);
});

test('list omits a ticket blocked by two when only one of the two has closed', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  writeTicketYaml(path.join(target, 'backlog', 'active'), 'BL-762');
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-681' }));
  appendSiblingDeferralRecordIfNew(target, deferRecord({ blockedBy: 'BL-762', check: 'npm run acceptance', at: '2026-07-17T10:00:01.000Z' }));
  assert.deepEqual(listStrandedDeferrals(target), []);
});

test('an empty store lists no stranded deferrals', () => {
  const target = mkTmp();
  assert.deepEqual(listStrandedDeferrals(target), []);
});

// BL-861 invariant 2: status and list must never disagree - drive the SAME
// fixture through both entry points and compare their verdicts directly,
// rather than re-deriving each independently.
test('status and list agree: a releasable ticket per status appears in list, and vice versa', () => {
  const target = mkTmp();
  writeTicketYaml(path.join(target, 'backlog', 'done'), 'BL-681');
  appendSiblingDeferralRecordIfNew(target, deferRecord());
  const statusReport = computeTicketDeferralStatus(target, 'BL-574');
  const listedTickets = listStrandedDeferrals(target).map((r) => r.ticket);
  assert.equal(statusReport.kind === 'releasable', listedTickets.includes('BL-574'));
});
