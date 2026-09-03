'use strict';

// BL-1342: step handlers for the BL-848 stamp-off of landed hotfix
// 27d6ab8630 (handoffd survives a vanished outbox parcel; the supervisor
// grants a startup grace window).
//
// REVIEW parcel: every scenario drives the LANDED code - the real daemon's
// own `--poll-once` against a throwaway root, the real
// `handoff-lib/read-envelope-if-present`, and the real
// `handoffd-supervisor/evaluate-health`. Nothing here reimplements the
// hotfix, and nothing here writes a certify or waive decision into
// backlog/hotfix-ledger.yaml: only a recorded human decision does that
// (BL-848).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REPO_ROOT,
  HANDOFFD,
  HANDOFF_LIB,
  SUPERVISOR,
  makeFixture,
  removeFixture,
  runPoll,
  restoreVanished,
  neutralizeRaceHook,
  callLanded,
  callSupervisor,
} = require('./lib/bl1342CrashloopStampFixture');

const FEATURE = 'Stamp-off review of the handoffd crash-loop hotfix';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const REVIEWED_COMMIT = '27d6ab8630';

// Scenario Outline cells are validated against these explicit values rather
// than passed through (engineering.prompt, Acceptance Pipeline). The stall
// window and the stale post-crash observation are the ones the landed
// runner uses, so the review asks the same question the incident did.
const STALL_MS = 30000;
const STALE_OBSERVATION =
  '{:alive? true :heartbeat-age-ms 158000 :pending-outbox-age-ms 160000 ' +
  `:stall-ms ${STALL_MS} :in-flight-sweep-age-ms nil :in-sweep-budget-ms 225000}`;
const KNOWN_AGES = {
  'younger than a stall window': '250',
  'older than a stall window': String(STALL_MS + 1),
  unknown: 'nil',
};
const KNOWN_VERDICTS = new Set(['healthy', 'stalled', 'dead']);

function state(ctx) {
  if (!ctx.bl1342) ctx.bl1342 = {};
  return ctx.bl1342;
}

function teardown(ctx) {
  const st = state(ctx);
  removeFixture(st.fx);
  st.fx = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the handoff daemon is polling role outboxes$/, (ctx) => {
    state(ctx).polling = true;
  });

  // ── Scenarios 01-02: the vanished parcel ─────────────────────────────
  scoped(/^an outbox parcel that is unreadable when the poll reads it$/, (ctx) => {
    const st = state(ctx);
    // Not a permissions trick: an ordinary parcel, listed like any other,
    // that the sending role archives while this same poll is still
    // delivering the parcel ahead of it - the live 2026-09-02 race, made
    // deterministic by the fixture's own fake tmux.
    st.fx = makeFixture({ unreadable: true });
    st.parcelBefore = fs.readFileSync(st.fx.vanishingPath, 'utf8');
  });

  scoped(/^an outbox parcel that reads normally$/, (ctx) => {
    const st = state(ctx);
    st.fx = makeFixture({ unreadable: false, readable: true });
  });

  scoped(/^the poll runs$/, (ctx) => {
    const st = state(ctx);
    if (!st.fx) return; // scenario 03 drives the reader directly, not a poll
    st.poll = runPoll(st.fx);
  });

  scoped(/^the daemon survives the poll$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.poll.status, 0, `the poll died on the vanished parcel: ${st.poll.out.slice(-800)}`);
    assert.match(st.poll.log, /poll-once done/, `the poll did not run to completion: ${st.poll.log}`);
    // And it kept working: the parcel ahead of the vanished one delivered.
    assert.match(st.poll.log, /delivered .*000001/, `the sibling parcel was not delivered: ${st.poll.log}`);
  });

  scoped(/^the unreadable parcel is recorded as skipped for this poll$/, (ctx) => {
    const st = state(ctx);
    const line = st.poll.log.split('\n').find((l) => l.includes('outbox-parcel-unreadable'));
    assert.ok(line, `no skip was recorded for the vanished parcel: ${st.poll.log}`);
    assert.ok(line.includes(st.fx.names.vanishing), `the skip does not name the parcel: ${line}`);
    assert.match(line, /skipped this poll/, `the skip does not say what it did: ${line}`);
    teardown(ctx);
  });

  scoped(/^that parcel is neither delivered nor archived nor modified$/, (ctx) => {
    const st = state(ctx);
    const delivered = fs.readdirSync(st.fx.inbox);
    assert.ok(
      !delivered.some((f) => f.includes('000002')),
      `the skipped parcel was delivered anyway: ${JSON.stringify(delivered)}`,
    );
    // The daemon moved it nowhere of its own: no failed/, sent/ or
    // quarantine entry appeared for it.
    for (const box of ['failed', 'sent', 'quarantine', 'completed']) {
      const dir = path.join(st.fx.outbox, '..', box);
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      assert.ok(
        !entries.some((f) => f.includes('000002')),
        `the skipped parcel was moved to ${box}: ${JSON.stringify(entries)}`,
      );
    }
    // Byte-identical to what the sender wrote - the guard reads, it does not
    // rewrite.
    assert.equal(fs.readFileSync(st.fx.archivedPath, 'utf8'), st.parcelBefore, 'the skipped parcel was modified');
  });

  scoped(/^it is re-evaluated on the next poll$/, (ctx) => {
    const st = state(ctx);
    // The sender re-queues the parcel it archived; nothing about the skip
    // marked it as handled, so the very next poll delivers it normally.
    restoreVanished(st.fx);
    neutralizeRaceHook(st.fx);
    const second = runPoll(st.fx);
    assert.equal(second.status, 0, `the second poll failed: ${second.out.slice(-500)}`);
    const delivered = fs.readdirSync(st.fx.inbox);
    assert.ok(
      delivered.some((f) => f.includes('000002')),
      `the once-skipped parcel was never re-evaluated: ${JSON.stringify(delivered)}`,
    );
    teardown(ctx);
  });

  scoped(/^that parcel is delivered exactly as it was before the hotfix$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.poll.status, 0, `the happy-path poll failed: ${st.poll.out.slice(-500)}`);
    assert.doesNotMatch(st.poll.log, /outbox-parcel-unreadable/, 'the guard fired on a perfectly readable parcel');
    const delivered = fs.readdirSync(st.fx.inbox);
    assert.equal(delivered.length, 1, `expected exactly one delivery, got ${JSON.stringify(delivered)}`);
    assert.ok(delivered[0].includes('000001'), `the wrong parcel was delivered: ${delivered[0]}`);
    assert.equal(fs.readdirSync(st.fx.outbox).length, 0, 'the delivered parcel was left in the outbox');
    teardown(ctx);
  });

  // ── Scenario 03: the swallow is I/O only ─────────────────────────────
  scoped(/^a parcel read that fails with a non-I\/O error$/, (ctx) => {
    state(ctx).nonIo = true;
  });

  scoped(/^that error is not reported as a vanished parcel$/, (ctx) => {
    // Executed, not merely read: the landed reader is called twice - once on
    // a genuinely absent file (must answer :vanished) and once with the read
    // itself raising a non-I/O exception (must propagate, so a real bug is
    // never disguised as a vanished parcel).
    const [result] = callLanded(
      HANDOFF_LIB,
      `(emit {:missing (handoff-lib/read-envelope-if-present "/definitely/not/here.handoff")
              :non-io (try
                        (with-redefs [slurp (fn [& _] (throw (IllegalStateException. "a genuine bug")))]
                          {:swallowed (handoff-lib/read-envelope-if-present "/tmp/whatever.handoff")})
                        (catch Exception e {:propagated (.getName (class e))}))})`,
    );
    assert.deepEqual(result.missing, { vanished: true }, 'an absent parcel is no longer answered as vanished');
    assert.deepEqual(
      result['non-io'],
      { propagated: 'java.lang.IllegalStateException' },
      `a non-I/O failure did not propagate: ${JSON.stringify(result['non-io'])}`,
    );

    // And the catch itself is narrow by inspection as well: java.io.
    // IOException, never Exception or Throwable, with no second, unguarded
    // read of an outbox parcel in the poll loop.
    const libSource = fs.readFileSync(HANDOFF_LIB, 'utf8');
    const reader = libSource.slice(libSource.indexOf('(defn read-envelope-if-present'));
    const body = reader.slice(0, reader.indexOf('\n\n'));
    assert.match(body, /catch java\.io\.IOException/, 'the guard no longer catches java.io.IOException specifically');
    assert.ok(!/catch (Exception|Throwable)\b/.test(body), 'the guard widened to catch every exception');

    const daemonSource = fs.readFileSync(HANDOFFD, 'utf8');
    const pollOnce = daemonSource.slice(daemonSource.indexOf('(defn poll-once! []'));
    const pollBody = pollOnce.slice(0, pollOnce.indexOf('\n(defn '));
    assert.match(pollBody, /handoff-lib\/read-envelope-if-present path/, 'the poll no longer reads parcels through the guarded reader');
    assert.ok(!/\(slurp \(str path\)\)/.test(pollBody), 'a bare slurp of an outbox parcel is back in the poll loop');
  });

  // ── Scenarios 05-06: the startup grace ───────────────────────────────
  scoped(/^a live daemon whose age is "(.+)" and whose observations otherwise read stalled$/, (ctx, age) => {
    const st = state(ctx);
    assert.ok(Object.hasOwn(KNOWN_AGES, age), `unknown age cell: ${age}`);
    st.ageForm = KNOWN_AGES[age];
    st.alive = true;
  });

  scoped(/^a daemon that is not alive and whose age is younger than a stall window$/, (ctx) => {
    const st = state(ctx);
    st.ageForm = KNOWN_AGES['younger than a stall window'];
    st.alive = false;
  });

  scoped(/^the supervisor evaluates health$/, (ctx) => {
    const st = state(ctx);
    const [verdict] = callSupervisor(
      `(emit (handoffd-supervisor/evaluate-health
               (assoc ${STALE_OBSERVATION} :alive? ${st.alive} :daemon-age-ms ${st.ageForm})))`,
    );
    st.verdict = verdict;
  });

  scoped(/^the verdict is "(.+)"$/, (ctx, verdict) => {
    const st = state(ctx);
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict cell: ${verdict}`);
    assert.equal(st.verdict, verdict, `expected ${verdict} for daemon-age ${st.ageForm} (alive=${st.alive})`);

    // The grace's bound is a property of the landed clause, not of these
    // three samples: it is gated on a NUMBER within one stall window, and it
    // sits below the :dead clause so it can never reach a daemon that is not
    // running.
    const source = fs.readFileSync(SUPERVISOR, 'utf8');
    assert.match(
      source,
      /within-startup-grace\?\s+\(and \(number\? daemon-age-ms\) \(<= daemon-age-ms stall-ms\)\)/,
      'the startup grace is no longer bounded by a known age within one stall window',
    );
    const cond = source.slice(source.indexOf('(cond\n      (not alive?) :dead'));
    assert.ok(
      cond.indexOf('(not alive?) :dead') < cond.indexOf('within-startup-grace? :healthy'),
      'the grace clause now sits above the :dead clause, where it could hide a dead daemon',
    );
  });

  // ── Scenario 07: the certification decision stays human ──────────────
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
    // "pending" is the row's UNDECIDED state, not one literal spelling of it:
    // the row legitimately moves through stamp-open while the parcel travels.
    // What must not appear is a decision no human made.
    assert.doesNotMatch(row, /state:\s*(certified|waived)\b/, `a decided state appears on the row:\n${row}`);
    assert.match(row, /human_decision: null/, `a decision was written without a human:\n${row}`);
    assert.match(row, /decided_at: null/, `a decision timestamp was written without a human:\n${row}`);
  });
}

module.exports = { registerSteps };
