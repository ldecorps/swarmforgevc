'use strict';

// BL-1716's one declared invariant: "A land replay never fails because of
// a scratch worktree or branch left by a dead earlier run, and never
// removes one whose owning run is alive or unknown."
//
// stale-scratch-decision (land_step_lib.bb) is the pure core of this
// invariant - exhaustively enumerated here, never fc-sampled (this
// session's own precedent for a state space this small: 1 + 2 + 2 = 5
// meaningful combinations, once :record's presence gates whether
// :owner-alive?/:age-past-bound? are even read).

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'land_step_lib.bb');

function bbEval(expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${LIB}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function decide({ exists, hasRecord, ownerAlive, agePastBound }) {
  const record = hasRecord ? '{:pid 111 :start-ms 222}' : 'nil';
  const edn = `{:exists? ${exists} :record ${record} :owner-alive? ${ownerAlive} :age-past-bound? ${agePastBound}}`;
  return bbEval(`(println (land-step-lib/stale-scratch-decision ${edn}))`);
}

test('invariant: no leftover -> always proceed (nothing to reap)', () => {
  const raw = decide({ exists: false, hasRecord: false, ownerAlive: false, agePastBound: false });
  assert.match(raw, /:action :proceed/, `expected :proceed for no leftover, got: ${raw}`);
});

test('invariant: a record present and its owner alive -> always refuse, naming the owner pid, regardless of age-past-bound', () => {
  const reach = new Set();
  for (const agePastBound of [true, false]) {
    reach.add(agePastBound);
    const raw = decide({ exists: true, hasRecord: true, ownerAlive: true, agePastBound });
    assert.match(raw, /:action :refuse/, `expected :refuse for a live owner, got: ${raw}`);
    assert.match(raw, /:owner-pid 111/, `expected the refusal to name the recorded owner pid, got: ${raw}`);
  }
  assert.equal(reach.size, 2, 'reach floor: expected both age-past-bound? values constructed');
});

test('invariant: a record present but its owner NOT alive -> always proceed (dead, safe to clear), regardless of age-past-bound', () => {
  const reach = new Set();
  for (const agePastBound of [true, false]) {
    reach.add(agePastBound);
    const raw = decide({ exists: true, hasRecord: true, ownerAlive: false, agePastBound });
    assert.match(raw, /:action :proceed/, `expected :proceed for a dead recorded owner, got: ${raw}`);
  }
  assert.equal(reach.size, 2, 'reach floor: expected both age-past-bound? values constructed');
});

test('invariant: no record, past the age bound -> proceed (dead by age); no record, still young -> refuse with an unestablished owner (never nil-owner-pid confused with a named one)', () => {
  const past = decide({ exists: true, hasRecord: false, ownerAlive: false, agePastBound: true });
  assert.match(past, /:action :proceed/, `expected :proceed once past the age bound, got: ${past}`);

  const young = decide({ exists: true, hasRecord: false, ownerAlive: false, agePastBound: false });
  assert.match(young, /:action :refuse/, `expected :refuse while still young with no record, got: ${young}`);
  assert.match(young, /:owner-pid nil/, `expected an unestablished (nil) owner pid, got: ${young}`);
});
