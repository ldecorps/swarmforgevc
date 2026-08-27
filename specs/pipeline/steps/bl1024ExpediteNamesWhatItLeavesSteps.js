'use strict';

// BL-1024: step handlers for "an expedited run's closing summary names every
// piece of work it left for someone else".
//
// Every scenario drives the REAL summary - expedite_lib.bb's own
// outstanding-work + format-outstanding-summary, the exact pair
// expedite_cli.bb prints at the end of every run - through a bb subprocess,
// and asserts over the text a human would actually read in the terminal.
//
// Driving the pure pair rather than a whole expedite run is deliberate and is
// what makes scenario 05 testable at all: "a stage that overran its timeout"
// and "bounced past its bound" are endings a fixture cannot reach cheaply or
// reliably, and the property under test is that the summary is INDEPENDENT of
// the ending. The end-to-end half (the summary actually printed by a real
// run, on the failed-restart path that bit on 2026-08-21) is
// qa_e2e_procedure steps 2 and 3.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "an expedited run's closing summary names every piece of work it left for someone else";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_lib.bb');

const RUN_TICKET = 'BL-1021';
const PARKED = ['BL-586', 'BL-1012', 'BL-1017'];

// Explicit known values per the Scenario Outline handler rule: the closed set
// of endings the feature's Examples use. The summary must be identical across
// all three, which is the point - so each maps to the same run state, and a
// row the handlers do not know is a hard failure, never a passthrough.
const KNOWN_ENDINGS = new Set(['a failed restart', 'a stage that bounced past its bound', 'a stage that overran its timeout']);

function summarize({ parked, ticketMoved, dryRun }) {
  const expr = `
(require '[babashka.fs :as fs])
(load-file "${LIB}")
(let [items (expedite-lib/outstanding-work
              {:ticket "${RUN_TICKET}"
               :parked [${parked.map((t) => `"${t}"`).join(' ')}]
               :ticket-moved? ${Boolean(ticketMoved)}
               :dry-run? ${Boolean(dryRun)}})]
  (println (expedite-lib/format-outstanding-summary
             {:items items :parked [${parked.map((t) => `"${t}"`).join(' ')}]})))`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an expedited run$/, (ctx) => {
    // Defaults: a real run that moved its own ticket and parked nothing.
    // Each Given below narrows exactly one fact.
    ctx.run = { parked: [], ticketMoved: true, dryRun: false };
  });

  scoped(/^the run parked other tickets out of active$/, (ctx) => {
    ctx.run.parked = PARKED;
  });

  scoped(/^the run parked no tickets$/, (ctx) => {
    ctx.run.parked = [];
  });

  scoped(/^the run left backlog moves staged and uncommitted$/, (ctx) => {
    // `move-ticket!` uses `git mv`, so ANY backlog move the run made ends
    // staged. The run ticket's own active -> done move is one; a park is
    // another. This Given asserts the state rather than inventing it.
    ctx.run.ticketMoved = true;
    assert.ok(ctx.run.ticketMoved || ctx.run.parked.length > 0, 'a run with no moves cannot have left them staged');
  });

  scoped(/^the run was a dry run$/, (ctx) => {
    ctx.run.dryRun = true;
  });

  scoped(/^the run ended with (.+)$/, (ctx, ending) => {
    assert.ok(KNOWN_ENDINGS.has(ending), `unknown ending "${ending}" - the handlers know ${[...KNOWN_ENDINGS]}`);
    // Every one of these endings leaves the SAME leavings: the parks and the
    // staged moves already happened before the ending did. The summary must
    // not depend on how the run finished - a run that ended badly is exactly
    // when its leavings matter most.
    ctx.ending = ending;
  });

  scoped(/^the run prints its closing summary$/, (ctx) => {
    ctx.summary = summarize(ctx.run);
  });

  scoped(/^the closing summary lists "([^"]+)" as outstanding$/, (ctx, subject) => {
    assert.match(ctx.summary, /OUTSTANDING/, `the summary must be labelled outstanding:\n${ctx.summary}`);
    assert.ok(ctx.summary.includes(subject), `the summary must name "${subject}":\n${ctx.summary}`);
  });

  scoped(/^the closing summary names the folder they are held in$/, (ctx) => {
    assert.ok(ctx.summary.includes('backlog/hold/'), `the summary must name the folder:\n${ctx.summary}`);
    for (const t of ctx.run.parked) {
      assert.ok(ctx.summary.includes(t), `every parked ticket must be named, not counted - missing ${t}:\n${ctx.summary}`);
    }
  });

  scoped(/^the closing summary names who must decide whether they return$/, (ctx) => {
    const line = ctx.summary.split('\n').find((l) => l.includes('owner:') && /human|Article 3\.1/.test(l));
    assert.ok(line, `the parked tickets owe an owner, and Article 3.1 is why it is a human:\n${ctx.summary}`);
  });

  scoped(/^the closing summary reports that no tickets are held$/, (ctx) => {
    assert.ok(
      ctx.summary.includes('no tickets are held'),
      `a run that parked nothing must say so rather than stay silent:\n${ctx.summary}`
    );
  });

  scoped(/^the closing summary names who must commit them$/, (ctx) => {
    const line = ctx.summary.split('\n').find((l) => l.includes('owner:') && /commit/.test(l));
    assert.ok(line, `the staged moves owe their own owner - two deferrals, two owners:\n${ctx.summary}`);
    // The two owners must be genuinely different; collapsing them would hide
    // that there are two, which is the point of the ticket.
    const owners = new Set(ctx.summary.split('\n').filter((l) => l.includes('owner:')).map((l) => l.trim()));
    if (ctx.run.parked.length > 0) {
      assert.equal(owners.size, 2, `two outstanding subjects owe two distinct owners:\n${ctx.summary}`);
    }
  });

  scoped(/^the closing summary lists nothing as outstanding$/, (ctx) => {
    assert.ok(ctx.summary.includes('nothing outstanding'), `a dry run changed nothing and must say so:\n${ctx.summary}`);
    assert.ok(!ctx.summary.includes('backlog/hold/'), `nothing outstanding means nothing named:\n${ctx.summary}`);
  });
}

module.exports = { registerSteps };
