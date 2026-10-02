'use strict';

// BL-1872 declared invariants (coder first authorship - BL-654):
//
// 1. Every queued approval is landed or refused exactly once, and the sweep
//    never starts a land while another is running.
// 2. Queueing an approval never fetches, builds or pushes: QA's queue command
//    touches only the lander queue.
// 3. A land the sweep cannot complete reaches QA as a note carrying the land
//    step's own reason; the sweep never retries it on its own.
//
// 1 and 3 drive lander_lib.bb's REAL decisions (next-action, outcome,
// outcome-note) through simulated sweeps: random queues (duplicates
// included), random run lengths and exit logs, ticks at random times; every
// draw runs in ONE bb process. 2 runs enqueue! against a real mkdtemp git
// repo with a bare origin and compares every ref, the object count and the
// working tree before and after.
//
// Generator reach is asserted: draws with several entries waiting behind a
// running land, refusals of every reason kind, and duplicate approvals.
//
// Non-vacuity: with next-action ignoring a running entry (always starting
// the oldest queued), invariant 1 fails; with outcome-note dropping the
// reason, invariant 3 fails. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'lander_lib.bb');

function bb(program) {
  return execFileSync('bb', ['-e', `(load-file ${JSON.stringify(LIB)})\n${program}`], { encoding: 'utf8' });
}

const LOGS = {
  landed: { log: 'LAND_CLEAN x\\nLAND_PUBLISHED abcdef0123456789\\n', exit: 0, reason: null },
  escalate: { log: 'LAND_ESCALATE\\nland-step: holds no commit credited\\n', exit: 1, reason: 'LAND_ESCALATE' },
  entangled: { log: 'ENTANGLED_SIBLING_BLOCK\\nBL-1 withheld\\n', exit: 3, reason: 'ENTANGLED_SIBLING_BLOCK' },
  stopped: { log: 'LAND_REMATCH: x\\nLAND_STOPPED: the single permitted rematch conflicted\\n', exit: 5, reason: 'LAND_STOPPED' },
  crashed: { log: 'noise\\n', exit: 137, reason: 'land_main_publish.sh exited 137' },
};

const draw = fc.record({
  // Several approvals (some for the same ticket and commit), each with a
  // run length in ticks and an outcome kind.
  approvals: fc.array(
    fc.record({
      ticket: fc.constantFrom('BL-9001', 'BL-9002', 'BL-9003', 'BL-9004'),
      commit: fc.constantFrom('a'.repeat(40), 'b'.repeat(40)),
      at: fc.nat({ max: 20 }),
      ticks: fc.integer({ min: 1, max: 4 }),
      kind: fc.constantFrom(...Object.keys(LOGS)),
    }),
    { minLength: 1, maxLength: 6 }
  ),
});

// One bb program simulates every draw's sweep with the real decisions and
// prints, per draw, the event trace as EDN-ish lines.
function simulate(draws) {
  const edn = draws
    .map(
      (d) =>
        `[${d.approvals
          .map((a) => `{:task "${a.ticket}" :commit "${a.commit}" :at ${a.at} :ticks ${a.ticks} :log "${LOGS[a.kind].log}" :exit ${LOGS[a.kind].exit}}`)
          .join(' ')}]`
    )
    .join(' ');
  const program = `
(defn run-draw [approvals]
  ;; queue: entry-id dedupes the same approval, as enqueue! does
  (let [entries (atom (into {} (for [a approvals
                                     :let [id (lander-lib/entry-id (:task a) (:commit a))]]
                                 [id {:id id :task (:task a) :commit (:commit a) :status :queued
                                      :enqueued-at (:at a) :spec a}])))
        ;; keep the FIRST approval's spec per id (later duplicates are the same entry)
        _ (doseq [a (reverse approvals)]
            (swap! entries assoc-in [(lander-lib/entry-id (:task a) (:commit a)) :spec] a))
        events (atom [])]
    (loop [t 0]
      (let [es (vals @entries)
            d (lander-lib/next-action es (* t 1000))]
        (swap! events conj [:decide (:action d) (:id d) (count (filter #(= :running (:status %)) es))])
        (case (:action d)
          :start (swap! entries update (:id d) assoc :status :running :started-at (* t 1000) :left (get-in @entries [(:id d) :spec :ticks]))
          :finish (let [e (get @entries (:id d))
                        r (lander-lib/outcome (get-in e [:spec :log]) (get-in e [:spec :exit]))
                        n (lander-lib/outcome-note e r)]
                    (swap! events conj [:finish (:id d) (name (:status r)) (:to n) (:message n)])
                    (swap! entries update (:id d) #(-> (merge % r) (dissoc :exit))))
          :wait (swap! entries update (:id d)
                       (fn [e] (let [left (dec (:left e))]
                                 (cond-> (assoc e :left left) (<= left 0) (assoc :exit (get-in e [:spec :exit]))))))
          nil)
        (when (and (not= :idle (:action d)) (< t 500)) (recur (inc t)))))
    {:events @events :ids (set (keys @entries))}))
(doseq [d [${edn}]]
  (prn (run-draw d)))`;
  return bb(program)
    .split('\n')
    .filter(Boolean);
}

test(
  'BL-1872/BL-654 invariants 1 and 3: one land at a time, each approval decided once, refusals reach QA with their reason and never retry',
  () => {
    const draws = fc.sample(draw, 150);
    const out = simulate(draws);
    assert.equal(out.length, draws.length);
    const reach = { queuedBehindRunning: 0, refusalKinds: new Set(), duplicates: 0 };
    out.forEach((line, i) => {
      const d = draws[i];
      const ids = [...line.matchAll(/"((?:BL)-\d+-[0-9a-f]{10})"/g)].map((m) => m[1]);
      const uniqueIds = new Set(d.approvals.map((a) => `${a.ticket}-${a.commit.slice(0, 10)}`));
      if (uniqueIds.size < d.approvals.length) reach.duplicates += 1;
      // invariant 1: never more than one running at a decision
      for (const m of line.matchAll(/\[:decide :(\w+) (?:"[^"]*"|nil) (\d+)\]/g)) {
        assert.ok(Number(m[2]) <= 1, `two running: ${line}`);
        if (m[1] === 'wait' && uniqueIds.size > 1) reach.queuedBehindRunning += 1;
      }
      // invariant 1: every approval decided exactly once
      const finishes = [...line.matchAll(/\[:finish "([^"]+)" "(\w+)" \[([^\]]*)\] "([^"]*)"\]/g)];
      const finishedIds = finishes.map((m) => m[1]);
      assert.deepEqual([...finishedIds].sort(), [...uniqueIds].sort(), `${JSON.stringify(d)}\n${line}`);
      // invariant 1: never started again after its finish
      for (const id of uniqueIds) {
        const starts = [...line.matchAll(new RegExp(`\\[:decide :start "${id}"`, 'g'))];
        assert.equal(starts.length, 1, `${id} started ${starts.length} times: ${line}`);
      }
      // invariant 3: a refusal goes to QA with the land step's reason
      for (const [, id, status, to, message] of finishes) {
        const a = d.approvals.find((x) => `${x.ticket}-${x.commit.slice(0, 10)}` === id);
        const kind = Object.keys(LOGS).find((k) => k === a.kind);
        if (status === 'refused') {
          reach.refusalKinds.add(kind);
          assert.equal(to.trim(), '"QA"', line);
          assert.ok(message.startsWith(`${a.ticket} land refused: `), message);
          assert.ok(message.includes(LOGS[kind].reason.slice(0, 20)), `${message} lacks ${LOGS[kind].reason}`);
          assert.ok(message.length <= 80, message);
        } else {
          assert.equal(kind, 'landed');
          assert.equal(to.trim(), '"coordinator"', line);
        }
      }
      void ids;
    });
    assert.ok(reach.queuedBehindRunning >= 20, `waits behind a running land: ${reach.queuedBehindRunning}`);
    assert.equal(reach.refusalKinds.size, 4, `refusal kinds reached: ${[...reach.refusalKinds]}`);
    assert.ok(reach.duplicates >= 10, `duplicate approvals: ${reach.duplicates}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  "BL-1872/BL-654 invariant 2: queueing touches only the lander queue - no fetch, build or push",
  () => {
    const work = mkTmpDir('bl1872prop-');
    const origin = path.join(work, 'origin.git');
    const root = path.join(work, 'repo');
    const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', cwd, ...a], { encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    assert.equal(path.resolve(root, g(root, 'rev-parse', '--git-common-dir')), path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'seed');
    g(root, 'remote', 'add', 'origin', origin);
    g(root, 'push', '-q', 'origin', 'main');
    const snapshot = () => ({
      refs: g(root, 'for-each-ref', '--format=%(refname) %(objectname)'),
      originRefs: g(origin, 'for-each-ref', '--format=%(refname) %(objectname)'),
      objects: g(root, 'count-objects', '-v'),
      originObjects: g(origin, 'count-objects', '-v'),
      status: g(root, 'status', '--porcelain', '--ignored'),
      worktrees: g(root, 'worktree', 'list', '--porcelain'),
    });
    const draws = fc.sample(
      fc.array(fc.record({ ticket: fc.constantFrom('BL-9001', 'BL-9002', 'GH-7'), hex: fc.stringMatching(/^[0-9a-f]{40}$/) }), {
        minLength: 1,
        maxLength: 8,
      }),
      40
    );
    const before = snapshot();
    const calls = draws
      .flat()
      .map((a, i) => `(lander-lib/enqueue! ${JSON.stringify(root)} "${a.ticket}" "${a.hex.padEnd(40, '0')}" nil ${i})`)
      .join('\n');
    bb(calls);
    const after = snapshot();
    assert.equal(after.refs, before.refs);
    assert.equal(after.originRefs, before.originRefs);
    assert.equal(after.objects, before.objects);
    assert.equal(after.originObjects, before.originObjects);
    assert.equal(after.worktrees, before.worktrees);
    // The only new path is the lander queue (ignored .swarmforge appears as !!).
    const added = after.status.split('\n').filter((l) => l && !before.status.split('\n').includes(l));
    assert.deepEqual(added, ['?? .swarmforge/']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.swarmforge')), ['lander']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.swarmforge', 'lander')), ['queue']);
    const distinct = new Set(draws.flat().map((a) => `${a.ticket}-${a.hex.padEnd(40, '0').slice(0, 10)}`));
    assert.equal(fs.readdirSync(path.join(root, '.swarmforge', 'lander', 'queue')).length, distinct.size);
    assert.ok(distinct.size >= 20, `distinct approvals queued: ${distinct.size}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
