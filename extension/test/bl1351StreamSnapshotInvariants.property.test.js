'use strict';

// BL-1351's two DECLARED invariants (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`.
//
//   invariant 1  No field leaves the snapshot without an exhaustive
//                enumeration of every /events consumer showing nothing reads
//                it - a sampled sweep is not evidence.
//   invariant 2  The connect snapshot and the poll loop's rebroadcast always
//                carry the same per-item shape: a client can never observe a
//                field that only one of the two producers emits.
//
// Invariant 1 quantifies over a SWEEP, which is prose about this repo rather
// than a pure function, so it is encoded the only way it can be measured: the
// stream's retained field set is compared against what the enumerated
// consumers actually read, re-derived HERE from their source at run time. If
// a consumer grows a read of a field the stream no longer carries, this goes
// red - which is the regression the invariant exists to catch, in the only
// direction a test can catch it.
//
// Invariant 2 is a property of the shipped producers and drives them.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
} = require('../../specs/pipeline/steps/lib/bl1351StreamSnapshotFixture');
const {
  STREAM_BACKLOG_ITEM_FIELDS,
  projectBridgeStateForStream,
} = require('../out/bridge/streamSnapshot');

const SRC = path.join(__dirname, '..', 'src');

// The sweep, as data. Exactly ONE file consumes the state frame; the other
// two subscribe to /events but handle only their own named events, and that
// separation is asserted below rather than assumed - if a consumer starts
// reading the state frame, its guard here stops matching and the test says so.
const STATE_FRAME_CONSUMER = path.join(SRC, 'bridge', 'holisticUiHtml.ts');
const NAMED_EVENT_ONLY_CONSUMERS = [
  // Skips every block that is not `event: host-activity`.
  { file: path.join(SRC, 'bridge', 'bubbleHostUiHtml.ts'), guard: /block\.indexOf\('event: host-activity'\) === -1/ },
  // Returns unless the record's event is `telegram-reply`.
  { file: path.join(SRC, 'tools', 'telegramFrontDeskBotCore.ts'), guard: /record\.event !== 'telegram-reply'/ },
];

// The per-item fields readBacklogFolders can put on an item - the population
// the sweep had to rule on, read from the reader's own type so a new field
// cannot be added to the backlog and silently escape this check.
function backlogItemFields() {
  const source = fs.readFileSync(path.join(SRC, 'panel', 'backlogReader.ts'), 'utf8');
  const block = source.slice(source.indexOf('export interface BacklogItem {'));
  const body = block.slice(0, block.indexOf('\n}'));
  return [...body.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
}

test('BL-1351/BL-654 invariant 1: nothing a state-frame consumer reads was dropped from the stream', () => {
  // Derived from what the projection ACTUALLY emits, never from the declared
  // constant alone: a projection that quietly stops emitting a declared field
  // would otherwise be measured against the declaration and pass.
  const [emitted] = projectBridgeStateForStream({
    pipeline: [],
    agents: [],
    runLog: [],
    backlog: { active: [{ id: 'BL-1', title: 't' }] },
  }).backlog.active;
  const carried = new Set(Object.keys(emitted));
  assert.deepEqual([...carried].sort(), [...STREAM_BACKLOG_ITEM_FIELDS].sort(), 'the projection and its declared field set disagree');
  const dropped = backlogItemFields().filter((f) => !carried.has(f));
  assert.ok(dropped.length > 0, 'nothing was dropped - this invariant would be vacuous');

  // The other /events subscribers are named-event-only by construction: each
  // one's own guard is asserted, so "they do not read the state frame" is a
  // measured claim rather than a note in a comment.
  for (const { file, guard } of NAMED_EVENT_ONLY_CONSUMERS) {
    assert.match(
      fs.readFileSync(file, 'utf8'),
      guard,
      `${path.basename(file)} no longer filters to its own named event - it may now read the state frame, so the sweep must be redone`,
    );
  }

  // The state-frame consumer must not read ANY dropped field. This is the
  // direction that matters: a field removed from the stream while something
  // still renders it is the silent, invisible UI regression invariant 1
  // exists to prevent.
  //
  // Scoped to where that consumer touches backlog ITEMS - `stage.status` and
  // `agent.status` elsewhere in the same file are reads of the pipeline and
  // agent sections, which this ticket does not narrow. The single entry point
  // is asserted first, so the scoping cannot silently miss a second one.
  const wholeFile = fs.readFileSync(STATE_FRAME_CONSUMER, 'utf8');
  assert.match(
    wholeFile,
    /renderBacklogBoard\(state\.backlog,/,
    'the state frame\'s backlog now reaches somewhere other than renderBacklogBoard - the sweep must be redone',
  );
  const boardStart = wholeFile.indexOf('function renderBacklogBoard(');
  const consumer = wholeFile.slice(boardStart, wholeFile.indexOf('\n  function ', boardStart + 1));
  // The backlog item is bound as `item` there; every read of a per-item field
  // is `item.<field>`, and reads off other objects in the same function
  // (`a.swarm` off an assignment, for one) are not this ticket's fields.
  assert.match(consumer, /\(backlog\.active \|\| \[\]\)\.forEach\(function \(item\)/, 'the backlog item is no longer bound as `item` - the field scan below would go blind');
  for (const field of dropped) {
    assert.doesNotMatch(
      consumer,
      new RegExp(`\\bitem\\.${field}\\b`),
      `${field} was dropped from the stream but ${path.basename(STATE_FRAME_CONSUMER)} reads it`,
    );
  }

  // ...and every field the stream still carries is one that consumer really
  // reads, so the projection cannot quietly grow back into the 6.7 MB frame.
  for (const field of carried) {
    assert.match(
      consumer,
      new RegExp(`item\\.${field}\\b`),
      `the stream carries ${field} that no state-frame consumer reads - the sweep and the projection disagree`,
    );
  }
});

test('BL-1351/BL-654 invariant 2: both producers emit the same per-item shape, whatever the backlog holds', async () => {
  // Generated backlog shapes, projected through the SHIPPED projection: the
  // shape a client sees must not depend on which folders happen to be
  // populated or how many items they hold.
  const item = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `BL-${s.replace(/[^A-Za-z0-9]/g, '') || '1'}`),
    title: fc.string({ maxLength: 20 }),
    description: fc.string({ maxLength: 200 }),
    notes: fc.string({ maxLength: 200 }),
    epic: fc.string({ maxLength: 10 }),
  });
  fc.assert(
    fc.property(
      fc.record({
        active: fc.array(item, { maxLength: 4 }),
        paused: fc.array(item, { maxLength: 4 }),
        hold: fc.array(item, { maxLength: 4 }),
        done: fc.array(item, { maxLength: 6 }),
      }),
      (backlog) => {
        const projected = projectBridgeStateForStream({ pipeline: [], agents: [], runLog: [], backlog });
        for (const [folder, items] of Object.entries(projected.backlog)) {
          assert.equal(items.length, backlog[folder].length, `${folder} lost items`);
          for (const projectedItem of items) {
            assert.deepEqual(Object.keys(projectedItem).sort(), [...STREAM_BACKLOG_ITEM_FIELDS].sort());
          }
        }
        return true;
      },
    ),
    { numRuns: 25 },
  );

  // ...and end to end against the REAL server: the connect frame and a poll
  // loop rebroadcast, taken from one live stream, carry identical shapes.
  const fx = makeFixture();
  const handle = await startFixtureBridge(fx);
  let events;
  try {
    events = await connectEvents(handle);
    const connect = JSON.parse(await events.next());
    const newTitle = `changed ${Date.now()}`;
    touchActiveItem(fx, fx.activeIds[0], newTitle);
    let frame = null;
    for (let attempt = 0; attempt < 6 && !(frame || '').includes(newTitle); attempt += 1) {
      frame = await events.next();
    }
    assert.ok(frame, 'the poll loop never rebroadcast');
    const rebroadcast = JSON.parse(frame);
    const shapeOf = (snapshot) =>
      Object.fromEntries(
        Object.entries(snapshot.backlog).map(([folder, items]) => [
          folder,
          [...new Set(items.flatMap((i) => Object.keys(i)))].sort(),
        ]),
      );
    assert.deepEqual(shapeOf(rebroadcast), shapeOf(connect), 'the two producers disagree on the per-item shape');
  } finally {
    if (events) events.close();
    handle.stop();
    removeFixture(fx);
  }
}, 120000);
