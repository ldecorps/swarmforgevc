'use strict';

// BL-670: the board says WHERE a ticket is; this makes it say whether that
// role has claimed it, and since when, and how bruised the ticket is.
//
// The status and dot literals cross a language boundary - pipeline_stage_lib.bb
// writes them into ticket-stage-map.json and swarmState.ts reads them - so the
// engineering article's mirrored-constant rule applies: a TEST asserts the two
// spellings agree (BL-897), never a comment asking the next editor to remember.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  readTicketStageMap,
  normaliseTicketStageEntry,
  invertTicketStageToRoleHeldTickets,
  TICKET_STAGE_STATUS_CLAIMED,
  TICKET_STAGE_STATUS_IN_TRANSIT,
  TICKET_STAGE_STATUS_LAST_KNOWN,
  TICKET_HEALTH_DOT_GREEN,
  TICKET_HEALTH_DOT_YELLOW,
  TICKET_HEALTH_DOT_RED,
} = require('../out/swarm/swarmState');

const BB_LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'pipeline_stage_lib.bb');

function bbConstant(name) {
  const m = new RegExp(`\\(def ${name} "([^"]+)"\\)`).exec(fs.readFileSync(BB_LIB, 'utf8'));
  assert.ok(m, `${name} is not defined in pipeline_stage_lib.bb`);
  return m[1];
}

describe('BL-670 the status and dot literals agree across the language boundary', () => {
  for (const [bbName, tsValue] of [
    ['claimed-status', TICKET_STAGE_STATUS_CLAIMED],
    ['in-transit-status', TICKET_STAGE_STATUS_IN_TRANSIT],
    ['last-known-status', TICKET_STAGE_STATUS_LAST_KNOWN],
    ['health-dot-green', TICKET_HEALTH_DOT_GREEN],
    ['health-dot-yellow', TICKET_HEALTH_DOT_YELLOW],
    ['health-dot-red', TICKET_HEALTH_DOT_RED],
  ]) {
    it(`${bbName} is spelled the same on both sides`, () => {
      assert.equal(tsValue, bbConstant(bbName));
    });
  }
});

describe('BL-670 the reader normalises both map shapes', () => {
  it('carries the qualifier through when the map has one', () => {
    assert.deepEqual(
      normaliseTicketStageEntry({ stage: 'cleaner', status: 'in-transit-to', asOf: '2026-08-30T10:11:00Z', healthDot: 'yellow' }),
      { stage: 'cleaner', status: 'in-transit-to', asOf: '2026-08-30T10:11:00Z', healthDot: 'yellow' }
    );
  });

  it('reads a pre-BL-670 bare role as last-known rather than dropping it', () => {
    // The honest reading of "we know where it was and nothing more" - and a
    // swarm whose cache predates the qualifier must not render a blank board.
    assert.deepEqual(normaliseTicketStageEntry('coder'), {
      stage: 'coder',
      status: TICKET_STAGE_STATUS_LAST_KNOWN,
    });
  });

  it('defaults a stage-only entry to last-known', () => {
    assert.equal(normaliseTicketStageEntry({ stage: 'QA' }).status, TICKET_STAGE_STATUS_LAST_KNOWN);
  });

  it('pins the fallback operator: a defined-but-empty status is NOT replaced (??, not ||)', () => {
    // `entry.status ?? LAST_KNOWN` only falls back on null/undefined - an
    // explicit empty string is a distinct (if degenerate) value and passes
    // through unchanged. Pinned here so a `??` -> `||` slip (which WOULD
    // replace it) is caught; no test elsewhere exercises a defined-but-falsy
    // status.
    assert.equal(normaliseTicketStageEntry({ stage: 'QA', status: '' }).status, '');
  });

  for (const junk of ['', null, undefined, 42, {}, { status: 'claimed' }, { stage: '' }]) {
    it(`drops junk rather than fabricating a stage: ${JSON.stringify(junk)}`, () => {
      assert.equal(normaliseTicketStageEntry(junk), undefined);
    });
  }
});

describe('BL-670 the inverter takes either shape', () => {
  it('inverts qualified entries by their stage', () => {
    assert.deepEqual(
      invertTicketStageToRoleHeldTickets({
        'BL-1': { stage: 'coder', status: 'claimed' },
        'BL-2': { stage: 'coder', status: 'in-transit-to' },
        'BL-3': { stage: 'QA', status: 'last-known' },
      }),
      { coder: ['BL-1', 'BL-2'], QA: ['BL-3'] }
    );
  });

  it('still inverts a pre-BL-670 bare-role map', () => {
    assert.deepEqual(invertTicketStageToRoleHeldTickets({ 'BL-1': 'coder' }), { coder: ['BL-1'] });
  });

  it('never invents a role for an entry it cannot read', () => {
    assert.deepEqual(invertTicketStageToRoleHeldTickets({ 'BL-1': null, 'BL-2': { status: 'claimed' } }), {});
  });
});

describe('BL-670 readTicketStageMap', () => {
  it('normalises a mixed-shape file, entry by entry', () => {
    const root = mkTmpDir('bl670-map-');
    try {
      fs.mkdirSync(path.join(root, '.swarmforge', 'board'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json'),
        JSON.stringify({
          'BL-1': { stage: 'cleaner', status: 'in-transit-to', asOf: 'T', healthDot: 'green' },
          'BL-2': 'coder',
          'BL-3': null,
        })
      );

      const map = readTicketStageMap(root);

      assert.deepEqual(Object.keys(map).sort(), ['BL-1', 'BL-2']);
      assert.equal(map['BL-1'].status, TICKET_STAGE_STATUS_IN_TRANSIT);
      assert.equal(map['BL-2'].status, TICKET_STAGE_STATUS_LAST_KNOWN);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades to an empty map rather than crashing on a missing or torn file', () => {
    const root = mkTmpDir('bl670-map-');
    try {
      assert.deepEqual(readTicketStageMap(root), {});
      fs.mkdirSync(path.join(root, '.swarmforge', 'board'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json'), '{"BL-1":');
      assert.deepEqual(readTicketStageMap(root), {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
