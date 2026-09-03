'use strict';

// BL-1346: step handlers for the BL-848 stamp-off of landed hotfix
// 195de28861 (`swarm ensure`'s RC repair no longer respawns a stale-marker
// role into another role's pane on a standing pack).
//
// REVIEW parcel: every scenario runs the REAL swarm_ensure.bb against a
// throwaway root shaped like the hotfix's own RC-7b fixture, or calls the
// REAL shared BL-1020 decision the repaired path delegates to. Nothing here
// reimplements the hotfix, and nothing writes a certify or waive decision
// into backlog/hotfix-ledger.yaml: only a recorded human decision does that.
//
// The weight is where the ticket puts it: scenarios 02 and 03 - the repair
// still repairs, and the marker keeps its authority where it belongs - not
// scenario 01. A hotfix that bought silence by disabling repair would pass
// scenario 01 and be a worse bug than the one it replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REPO_ROOT,
  ENSURE,
  makeFixture,
  removeFixture,
  runEnsure,
  callSharedDecision,
} = require('./lib/bl1346RcRepairStampFixture');

const FEATURE = 'Stamp-off review of the RC-repair stale-marker hotfix';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const REVIEWED_COMMIT = '195de28861';

// The leftover marker every scenario carries: a role other than the pane's
// own, exactly the `coordinator` left over from a prior router run.
const STALE_MARKER = 'coordinator';
// The pane the pre-hotfix code respawned into: first roles.tsv row under
// full-forge, so the one it misclassified as the mono-router resident.
const SUBJECT = 'specifier';

function state(ctx) {
  if (!ctx.bl1346) ctx.bl1346 = { shape: {} };
  return ctx.bl1346;
}

function teardown(ctx) {
  const st = state(ctx);
  removeFixture(st.fx);
  st.fx = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a leftover resident marker naming a role other than the pane's own$/, (ctx) => {
    state(ctx).shape = { marker: STALE_MARKER };
  });

  // ── Givens: the three pack shapes ────────────────────────────────────
  scoped(/^a standing pack whose panes are correctly staffed$/, (ctx) => {
    const st = state(ctx);
    st.shape = { ...st.shape, rotation: '', staffing: {} };
  });

  scoped(/^a standing pack with one pane down$/, (ctx) => {
    const st = state(ctx);
    // "Down" as the RC repair sees it: the pane is there, running claude
    // with no --remote-control flag at all, which is the state the repair
    // exists to fix by respawning the launch script.
    st.shape = { ...st.shape, rotation: '', staffing: { [SUBJECT]: 'degraded' } };
  });

  scoped(/^a rotation-router pack whose resident pane is down$/, (ctx) => {
    const st = state(ctx);
    st.shape = { ...st.shape, rotation: 'router', staffing: { [SUBJECT]: 'degraded' } };
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the RC repair runs$/, (ctx) => {
    const st = state(ctx);
    st.fx = makeFixture(st.shape);
    st.run = runEnsure(st.fx);
  });

  scoped(/^the RC repair resolves which role a pane should run$/, (ctx) => {
    state(ctx).resolving = true;
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^no pane is respawned$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.run.respawns.trim(), '', `a correctly-staffed pane was respawned: ${st.run.respawns}`);
    // And the run is not silent about the pane the stale marker used to
    // capture: it read healthy, against its OWN role's script.
    assert.match(
      st.run.out,
      new RegExp(`^rc:${SUBJECT}: HEALTHY$`, 'm'),
      `the ${SUBJECT}'s RC was not read against its own launch script: ${st.run.out}`,
    );
    teardown(ctx);
  });

  scoped(/^that pane is respawned with the role its pack assigns it$/, (ctx) => {
    const st = state(ctx);
    const respawns = st.run.respawns.trim();
    // The half that matters most: the repair still repairs.
    assert.ok(respawns.length > 0, 'a genuinely degraded pane was left unrepaired - the repair stopped repairing');
    assert.match(respawns, new RegExp(`respawn-pane -k -t swarmforge-${SUBJECT}`), `the wrong pane was respawned: ${respawns}`);
    // ...with its OWN role's script, never the stale marker's.
    assert.match(respawns, new RegExp(`launch/${SUBJECT}\\.sh`), `the pane was not respawned with its own role: ${respawns}`);
    assert.ok(
      !respawns.includes(`launch/${STALE_MARKER}.sh`),
      `the stale marker's role was respawned into another pane: ${respawns}`,
    );
    teardown(ctx);
  });

  scoped(/^the resident is respawned as the role the marker names$/, (ctx) => {
    const st = state(ctx);
    const respawns = st.run.respawns.trim();
    // The authority removed is exactly the non-router case: on a rotation
    // -router pack the marker still governs, and a rotated resident is
    // repaired back to the role it is actually running.
    assert.ok(respawns.length > 0, 'the router pack resident was left unrepaired');
    assert.match(respawns, new RegExp(`respawn-pane -k -t swarmforge-${SUBJECT}`), `the wrong pane was respawned: ${respawns}`);
    assert.match(respawns, new RegExp(`launch/${STALE_MARKER}\\.sh`), `the marker no longer governs a router pack: ${respawns}`);
    teardown(ctx);
  });

  scoped(/^it resolves through the shared resident-role decision, not a local rule$/, () => {
    // Executed: the shared BL-1020 decision itself, on the two inputs the
    // RC path hands it. The marker is honoured only under rotation-router.
    const [standing, router] = callSharedDecision(
      `(emit (mono-router-lib/resolve-resident-role
               {:rotation-router? false :recorded-role "${STALE_MARKER}" :home-role "${SUBJECT}"}))
       (emit (mono-router-lib/resolve-resident-role
               {:rotation-router? true :recorded-role "${STALE_MARKER}" :home-role "${SUBJECT}"}))`,
    );
    assert.equal(standing.role, SUBJECT, 'the shared decision now lets a stale marker rename a standing pane');
    assert.equal(standing['honour-marker?'], false, 'the shared decision honours the marker on a standing pack');
    assert.equal(router.role, STALE_MARKER, 'the shared decision no longer honours the marker on a router pack');

    // And the RC path delegates to it rather than keeping its own rule: the
    // landed rc-launch-role calls resolve-resident-role and reads the marker
    // only as that call's input.
    const source = fs.readFileSync(ENSURE, 'utf8');
    const fn = source.slice(source.indexOf('(defn rc-launch-role'));
    const body = fn.slice(0, fn.indexOf('\n(defn '));
    assert.match(body, /mono-router-lib\/resolve-resident-role/, 'the RC path no longer uses the shared resident-role decision');
    assert.match(body, /:rotation-router\? \(rotation-router-mode\?\)/, 'the shared decision is no longer told which pack this is');
    // No local rule left beside it: the marker is not read into a role
    // anywhere in this function except as the shared decision's input.
    const markerReads = body.match(/read-mono-router-active-role-marker/g) || [];
    assert.equal(markerReads.length, 1, `rc-launch-role reads the marker ${markerReads.length} times - a local rule is back`);
  });

  // ── Scenario 05: the certification decision stays human ──────────────
  scoped(/^the review parcel completes$/, (ctx) => {
    state(ctx).ledger = fs.readFileSync(LEDGER, 'utf8');
  });

  scoped(/^the ledger row for the reviewed commit still reads "pending"$/, (ctx) => {
    const ledger = state(ctx).ledger;
    const start = ledger.indexOf(`- commit: ${REVIEWED_COMMIT}`);
    assert.ok(start >= 0, `no ledger row for ${REVIEWED_COMMIT}`);
    const rest = ledger.slice(start + 1);
    const end = rest.indexOf('\n- commit:');
    const row = end === -1 ? rest : rest.slice(0, end);
    // "pending" is the row's UNDECIDED state, not one literal spelling: the
    // row legitimately moves through stamp-open while the parcel travels.
    assert.doesNotMatch(row, /state:\s*(certified|waived)\b/, `a decided state appears on the row:\n${row}`);
    assert.match(row, /human_decision: null/, `a decision was written without a human:\n${row}`);
    assert.match(row, /decided_at: null/, `a decision timestamp was written without a human:\n${row}`);
  });
}

module.exports = { registerSteps };
