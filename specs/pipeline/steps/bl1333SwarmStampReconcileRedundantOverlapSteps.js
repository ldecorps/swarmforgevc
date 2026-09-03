'use strict';

// BL-1333: step handlers for the BL-848 stamp-off of landed commits
// f57795b6d2 (handoffd.bb wiring: the READ-ONLY redundancy proof and the
// single drop site) and d5739d84cc (the pure decision half, blocking-overlap
// in master_main_reconcile_lib.bb).
//
// REVIEW parcel: every scenario drives the LANDED code - the real daemon's
// own --reconcile-sweep-once tick against a real git fixture with a real
// bare origin, or the landed private vars called directly after loading the
// real handoffd.bb. Nothing here reimplements the hotfix, and nothing here
// writes a certify or waive decision into backlog/hotfix-ledger.yaml: only a
// recorded human decision does that (BL-848).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REPO_ROOT,
  HANDOFFD,
  makeFixture,
  removeFixture,
  landOnOrigin,
  fetchOrigin,
  runReconcileTick,
  callLandedFns,
  status,
  git,
  write,
} = require('./lib/bl1333ReconcileStampFixture');

const FEATURE = 'Stamp-off review of the reconcile redundant-overlap hotfix';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const REVIEWED_COMMITS = ['f57795b6d2', 'd5739d84cc'];

// Scenario Outline cells are validated against these explicit values rather
// than passed through - an unrecognised cell is a red, never a silent pass
// (engineering.prompt, Acceptance Pipeline).
const KNOWN_RELATIONS = new Set(['matches', 'differs']);
const KNOWN_OUTCOMES = new Set(['dropped and no longer blocks', 'left as found and still blocks']);

// The path the incoming merge carries AND the working tree is dirty on -
// the overlap the hotfix is about. `redundant` holds origin's exact bytes;
// `divergent` holds something else.
const REDUNDANT_PATH = 'dup.txt';
const DIVERGENT_PATH = 'shared.txt';
const UNRELATED_PATH = 'unrelated.txt';
const INCOMING = { [REDUNDANT_PATH]: 'landed by QA\n', [DIVERGENT_PATH]: 'incoming\n' };

function state(ctx) {
  if (!ctx.bl1333) ctx.bl1333 = { shape: {} };
  return ctx.bl1333;
}

// Builds the fixture the scenario's Givens described, once. Every shape is
// the same real repo: a bare origin one commit ahead on both overlap paths,
// and a working tree dirtied per `shape`.
function ensureFixture(ctx) {
  const st = state(ctx);
  if (st.fx) return st.fx;
  const shape = st.shape;
  const fx = makeFixture();
  st.fx = fx;
  if (shape.localCommit) {
    write(fx.root, 'local.txt', 'local bookkeeping\n');
    git(fx.root, 'add', 'local.txt');
    git(fx.root, 'commit', '-q', '-m', 'local-only commit');
    st.localSha = git(fx.root, 'rev-parse', 'HEAD').trim();
  }
  landOnOrigin(fx, INCOMING);
  if (shape.redundant !== false) write(fx.root, REDUNDANT_PATH, INCOMING[REDUNDANT_PATH]);
  if (shape.divergent) write(fx.root, DIVERGENT_PATH, 'a local edit origin does not carry\n');
  if (shape.unrelatedDirt) write(fx.root, UNRELATED_PATH, 'uncommitted work the merge never carries\n');
  fetchOrigin(fx.root);
  st.statusBefore = status(fx.root);
  return fx;
}

function tick(ctx) {
  const st = state(ctx);
  const fx = ensureFixture(ctx);
  st.tick = runReconcileTick(fx);
  assert.equal(st.tick.status, 0, `the reconcile tick failed: ${st.tick.out.slice(-800)}`);
  return st.tick;
}

function teardown(ctx) {
  const st = state(ctx);
  removeFixture(st.fx);
  st.fx = null;
}

function reconciled(st) {
  return /master-main-reconcile reconciled/.test(st.tick.log);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  // Records the shape only; the (real git, real daemon) fixture is built
  // lazily by the first step that needs it, so a scenario's own Givens can
  // still refine it and scenario 07 pays nothing for a repo it never uses.
  scoped(/^the reconcile is blocked by a dirty overlap between the master checkout and origin\/main$/, (ctx) => {
    state(ctx).shape = { redundant: true, divergent: true };
  });

  // ── Scenario 01: the proof writes nothing ────────────────────────────
  scoped(/^the redundancy proof runs against the overlapping paths$/, (ctx) => {
    const st = state(ctx);
    const fx = ensureFixture(ctx);
    st.statusBeforeProof = status(fx.root);
    // The LANDED private var itself, alone - not a sweep that happens to
    // call it. "Running the proof alone changes nothing" is only proved by
    // running the proof alone.
    const [proven] = callLandedFns(
      fx,
      `(emit (vec (sort (#'handoffd/master-main-reconcile-redundant-paths! ["${REDUNDANT_PATH}" "${DIVERGENT_PATH}" "${UNRELATED_PATH}"]))))`,
    );
    st.proven = proven;
  });

  scoped(/^the working tree is byte-identical to what it was before the proof ran$/, (ctx) => {
    const st = state(ctx);
    // The proof having produced a real answer is what makes the unchanged
    // tree evidence rather than a no-op: it read every path and proved one.
    assert.deepEqual(st.proven, [REDUNDANT_PATH], `the proof did not run over the overlap: ${JSON.stringify(st.proven)}`);
    assert.equal(status(st.fx.root), st.statusBeforeProof, 'the redundancy proof changed the working tree');
    teardown(ctx);
  });

  // ── Scenario 02 (outline): dropped only when content already matches ──
  scoped(/^an overlapping path whose working-tree content "(.+)" origin\/main's content at that path$/, (ctx, relation) => {
    const st = state(ctx);
    assert.ok(KNOWN_RELATIONS.has(relation), `unknown relation cell: ${relation}`);
    st.relation = relation;
    st.shape = relation === 'matches'
      ? { redundant: true, divergent: false }
      : { redundant: false, divergent: true };
    st.subject = relation === 'matches' ? REDUNDANT_PATH : DIVERGENT_PATH;
  });

  scoped(/^an overlapping path whose redundancy cannot be established$/, (ctx) => {
    // Both halves on purpose: one path the proof CAN establish and one it
    // cannot, so "named the still-blocking one and not the other" is a real
    // distinction rather than a list of everything.
    const st = state(ctx);
    st.shape = { redundant: true, divergent: true };
    st.subject = DIVERGENT_PATH;
  });

  scoped(/^uncommitted work on a path the incoming merge does not carry$/, (ctx) => {
    const st = state(ctx);
    st.shape = { redundant: true, divergent: false, unrelatedDirt: true };
    st.subject = UNRELATED_PATH;
  });

  scoped(/^an overlapping path the proof established as redundant$/, (ctx) => {
    const st = state(ctx);
    st.shape = { redundant: true, divergent: false, localCommit: true };
    st.subject = REDUNDANT_PATH;
  });

  scoped(/^the reconcile sweep runs$/, (ctx) => {
    tick(ctx);
  });

  scoped(/^that path is "(.+)"$/, (ctx, outcome) => {
    const st = state(ctx);
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome cell: ${outcome}`);
    const dirty = status(st.fx.root);
    if (outcome === 'dropped and no longer blocks') {
      assert.ok(reconciled(st), `the reconcile did not complete: ${st.tick.log}`);
      assert.match(st.tick.log, new RegExp(`redundant-overlap-discarded [^\\n]*${st.subject}`));
      assert.ok(!dirty.includes(st.subject), `the dropped path is still dirty: ${dirty}`);
      assert.equal(
        fs.readFileSync(path.join(st.fx.root, st.subject), 'utf8'),
        INCOMING[st.subject],
        'the merge did not reproduce the content the drop discarded',
      );
    } else {
      assert.ok(!reconciled(st), `the reconcile completed over an unproven path: ${st.tick.log}`);
      assert.match(st.tick.log, /master-main-reconcile dirty-blocked/);
      assert.ok(dirty.includes(st.subject), `the unproven path was not left as found: ${dirty}`);
      assert.equal(fs.readFileSync(path.join(st.fx.root, st.subject), 'utf8'), 'a local edit origin does not carry\n');
    }
    teardown(ctx);
  });

  // ── Scenario 03: an unproven path keeps the block, and is named ───────
  scoped(/^the reconcile is still blocked$/, (ctx) => {
    const st = state(ctx);
    assert.ok(!reconciled(st), `the reconcile completed while a path was unproven: ${st.tick.log}`);
    assert.match(st.tick.log, /master-main-reconcile dirty-blocked/);
  });

  scoped(/^the main-sync deadlock alert names that path and no path that was dropped$/, (ctx) => {
    const st = state(ctx);
    // Two readings of the same claim, both against landed code.
    //
    // (a) The block message the tick actually surfaced to the coordinator -
    //     built by the landed sweep! from blocking-overlap - names the
    //     still-blocking path and not the proven-redundant one.
    const surfaced = st.tick.log.split('\n').filter((l) => l.includes('master-main-reconcile-surfaced')).join('\n');
    assert.ok(surfaced.includes(DIVERGENT_PATH), `the surfaced block does not name the blocking path: ${surfaced}`);
    assert.ok(!surfaced.includes(REDUNDANT_PATH), `the surfaced block names a proven-redundant path: ${surfaced}`);

    // (b) The operator alert body for the same state, composed the way the
    //     landed trip block composes it: the real formatter over the real
    //     blocking-overlap of the real landed adapters.
    const [computed] = callLandedFns(
      st.fx,
      `(let [dirty (#'handoffd/master-main-reconcile-dirty-paths!)
             mc (#'handoffd/master-main-reconcile-merge-changed-paths!)
             overlap (master-main-reconcile-lib/overlapping-paths dirty mc)
             proven (#'handoffd/master-main-reconcile-redundant-paths! overlap)
             blocking (vec (sort (master-main-reconcile-lib/blocking-overlap dirty mc proven)))]
         (emit {:proven (vec (sort proven))
                :blocking blocking
                :alert (master-main-reconcile-lib/deadlock-alert-text
                        {:ahead 0 :behind 1 :reason "dirty" :overlapping-paths blocking})}))`,
    );
    assert.deepEqual(computed.proven, [REDUNDANT_PATH], 'the proof no longer establishes the redundant path');
    assert.deepEqual(computed.blocking, [DIVERGENT_PATH], 'the blocking overlap is not the overlap minus the proven set');
    assert.ok(computed.alert.includes(DIVERGENT_PATH), `the alert omits the blocking path: ${computed.alert}`);
    assert.ok(!computed.alert.includes(REDUNDANT_PATH), `the alert names a dropped path: ${computed.alert}`);

    // And the composition above is the daemon's, not this test's: the landed
    // trip block feeds blocking-overlap the proven set before it writes the
    // marker the alert is built from.
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    const tripBlock = src.slice(src.indexOf('main-sync-deadlock-tripped') - 2500, src.indexOf('main-sync-deadlock-tripped'));
    assert.match(tripBlock, /master-main-reconcile-redundant-paths!/, 'the trip block no longer consults the proof');
    assert.match(tripBlock, /blocking-overlap dirty merge-changed proven/, 'the trip block no longer subtracts the proven set');
    teardown(ctx);
  });

  // ── Scenario 04: dirt outside the overlap ────────────────────────────
  scoped(/^that path retains its uncommitted content unchanged$/, (ctx) => {
    const st = state(ctx);
    assert.ok(reconciled(st), `the reconcile did not run to completion: ${st.tick.log}`);
    assert.equal(
      fs.readFileSync(path.join(st.fx.root, UNRELATED_PATH), 'utf8'),
      'uncommitted work the merge never carries\n',
      'the reconcile touched dirt outside the overlap',
    );
    assert.ok(status(st.fx.root).includes(UNRELATED_PATH), 'the unrelated dirt is no longer in the working tree');
    teardown(ctx);
  });

  // ── Scenario 05: the drop set is recomputed before the merge ──────────
  scoped(/^a redundancy proof computed earlier in the same sweep$/, (ctx) => {
    const st = state(ctx);
    st.shape = { redundant: true, divergent: false };
    const fx = ensureFixture(ctx);
    const [earlier] = callLandedFns(
      fx,
      `(emit (vec (sort (#'handoffd/master-main-reconcile-redundant-paths! ["${REDUNDANT_PATH}"]))))`,
    );
    assert.deepEqual(earlier, [REDUNDANT_PATH], 'the earlier proof did not establish the path it is meant to');
    st.earlierProof = earlier;
  });

  scoped(/^one of its paths has since stopped matching origin\/main$/, (ctx) => {
    const st = state(ctx);
    write(st.fx.root, REDUNDANT_PATH, 'drifted after the proof was taken\n');
  });

  scoped(/^the reconcile performs the real merge$/, (ctx) => {
    const st = state(ctx);
    // The merge adapter's FIRST act, called exactly as it is called there -
    // no argument to carry a stale set in, so what it drops is whatever it
    // proves for itself, now.
    const [dropped] = callLandedFns(
      st.fx,
      `(emit (vec (sort (#'handoffd/master-main-reconcile-drop-redundant-dirty-paths!))))`,
    );
    st.dropped = dropped;
  });

  scoped(/^the stale proof is not reused$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual(st.dropped, [], `a path proven earlier was dropped on the stale proof: ${JSON.stringify(st.dropped)}`);
    // Structural half of the same claim: the drop site takes no proven set
    // and is called from inside the merge adapter, so freshness is not a
    // property of this fixture's timing alone (BL-1310's freshness rule).
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    assert.match(src, /\(defn- master-main-reconcile-drop-redundant-dirty-paths! \[\]/, 'the drop site now takes a hand-passed set');
    const mergeAdapter = src.slice(src.indexOf('(defn- master-main-reconcile-merge! []'));
    assert.match(
      mergeAdapter.slice(0, 1200),
      /\(master-main-reconcile-drop-redundant-dirty-paths!\)/,
      'the merge adapter no longer recomputes the drop set immediately before the merge',
    );
  });

  scoped(/^that path is left as found and still blocks$/, (ctx) => {
    const st = state(ctx);
    assert.equal(
      fs.readFileSync(path.join(st.fx.root, REDUNDANT_PATH), 'utf8'),
      'drifted after the proof was taken\n',
      'the drifted path was not left as found',
    );
    const tickResult = runReconcileTick(st.fx);
    assert.match(tickResult.log, /master-main-reconcile dirty-blocked/, `the drifted path no longer blocks: ${tickResult.log}`);
    teardown(ctx);
  });

  // ── Scenario 06: local history survives a drop ───────────────────────
  scoped(/^the merge completes$/, (ctx) => {
    const st = state(ctx);
    assert.ok(reconciled(st), `the reconcile did not complete: ${st.tick.log}`);
    assert.match(st.tick.log, new RegExp(`redundant-overlap-discarded [^\\n]*${REDUNDANT_PATH}`));
  });

  scoped(/^every local-only commit is still reachable$/, (ctx) => {
    const st = state(ctx);
    const reachable = git(st.fx.root, 'rev-list', 'HEAD').split('\n').map((s) => s.trim());
    assert.ok(reachable.includes(st.localSha), 'a local-only commit was discarded by the reconcile');
    teardown(ctx);
  });

  // ── Scenario 07: the certification decision stays human ──────────────
  scoped(/^the review parcel completes$/, (ctx) => {
    state(ctx).ledger = fs.readFileSync(LEDGER, 'utf8');
  });

  scoped(/^both ledger rows for the reviewed commits still read "pending"$/, (ctx) => {
    const ledger = state(ctx).ledger;
    for (const commit of REVIEWED_COMMITS) {
      const start = ledger.indexOf(`- commit: ${commit}`);
      assert.ok(start >= 0, `no ledger row for ${commit}`);
      const rest = ledger.slice(start + 1);
      const end = rest.indexOf('\n- commit:');
      const row = end === -1 ? rest : rest.slice(0, end);
      // "pending" is the row's UNDECIDED state, not one literal spelling of
      // it: a row legitimately moves through stamp-open and back while the
      // parcel travels. What must not appear is a decision no human made.
      assert.doesNotMatch(row, /state:\s*(certified|waived)\b/, `a decided state appears on ${commit}:\n${row}`);
      assert.match(row, /human_decision: null/, `a decision was written without a human on ${commit}:\n${row}`);
      assert.match(row, /decided_at: null/, `a decision timestamp was written without a human on ${commit}:\n${row}`);
    }
  });
}

module.exports = { registerSteps };
