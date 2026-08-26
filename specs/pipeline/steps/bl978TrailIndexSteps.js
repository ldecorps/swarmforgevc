'use strict';

// BL-978: step handlers for "the dropped-parcel sweep reads each handoff
// file once, not once per active ticket". Every scenario drives the REAL
// chase_sweep_lib.bb dropped-parcel-items over real files via one bb
// subprocess per tick - the *read-handoff-file* seam counts every byte
// read (index and legacy readers alike), and the scenario-02 oracle is the
// REAL pre-change per-item composition from the same lib, never a JS
// re-statement.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const HANDOFF_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');

const FEATURE = 'BL-978 the dropped-parcel sweep reads each handoff file once, not once per active ticket';

const SUPERVISOR_STALL_MS = 30000;
const NOW_MS = Date.parse('2026-08-20T12:00:00Z');
const STALL_MS = 45 * 60 * 1000;
const STALE_AT = new Date(NOW_MS - 3 * STALL_MS).toISOString();
const FRESH_AT = new Date(NOW_MS - 60000).toISOString();

// KNOWN_VALUES: the outline's tokens, validated explicitly.
const KNOWN_FILE_COUNTS = new Set([40, 400]);
const KNOWN_ITEM_COUNTS = new Set([1, 8]);

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkFixture(ctx) {
  ctx.root = mkSocketFixtureRoot('bl978-');
  trackedRoots.push(ctx.root);
  ctx.activeDir = path.join(ctx.root, 'backlog', 'active');
  const roles = ['coder', 'QA', 'coordinator'];
  ctx.allDirs = [];
  ctx.liveDirs = [];
  for (const role of roles) {
    for (const kind of ['new', 'in_process', 'completed', 'sent', 'outbox']) {
      const dir = path.join(ctx.root, role, kind);
      fs.mkdirSync(dir, { recursive: true });
      ctx.allDirs.push(dir);
      if (kind === 'new' || kind === 'in_process') {
        ctx.liveDirs.push(dir);
      }
    }
  }
  fs.mkdirSync(ctx.activeDir, { recursive: true });
}

function writeActive(ctx, id) {
  fs.writeFileSync(path.join(ctx.activeDir, `${id}.yaml`), `id: ${id}\nassigned_to: coder\n`);
}

function writeHandoff(dir, name, headerLines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${headerLines.join('\n')}\n\nbody\n`);
}

// One bb call: the REAL sweep with every handoff read counted through the
// *read-handoff-file* seam, plus (for scenario 02) the REAL pre-change
// per-item composition over the same tree.
function runSweep(ctx, { withReference = false } = {}) {
  const expr = `
(require '[babashka.fs :as fs] '[clojure.string :as str])
(load-file ${JSON.stringify(CHASE_SWEEP_LIB)})
(let [reads (atom {})
      active-dir ${JSON.stringify(ctx.activeDir)}
      all-dirs ${JSON.stringify(ctx.allDirs)}
      live-dirs ${JSON.stringify(ctx.liveDirs)}
      start (System/nanoTime)
      ids (binding [chase-sweep-lib/*read-handoff-file*
                    (fn [p] (swap! reads update (str p) (fnil inc 0)) (slurp p))]
            (mapv :id (chase-sweep-lib/dropped-parcel-items active-dir all-dirs live-dirs ${NOW_MS} ${STALL_MS})))
      duration-ms (quot (- (System/nanoTime) start) 1000000)
      reference (when ${withReference}
                  (let [items (chase-sweep-lib/read-active-items active-dir)
                        dispatched (chase-sweep-lib/collect-dispatched-ticket-ids all-dirs)
                        live (chase-sweep-lib/collect-dispatched-ticket-ids live-dirs)]
                    (vec (keep (fn [item]
                                 (when (chase-sweep-lib/decide-dropped-parcel?
                                        {:has-trail? (contains? dispatched (:id item))
                                         :live-mail? (contains? live (:id item))
                                         :newest-trail-ms (chase-sweep-lib/newest-trail-event-ms (:id item) all-dirs)}
                                        ${NOW_MS} ${STALL_MS})
                                   (:id item)))
                               items))))]
  (prn {:ids (vec (sort ids))
        :reference (vec (sort (or reference [])))
        :max-reads (if (empty? @reads) 0 (apply max (vals @reads)))
        :total-reads (reduce + 0 (vals @reads))
        :duration-ms duration-ms}))
`;
  const out = execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
  const listOf = (key) => {
    const m = out.match(new RegExp(`:${key} \\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  const numOf = (key) => Number((out.match(new RegExp(`:${key} (\\d+)`)) || [])[1]);
  return {
    ids: listOf('ids'),
    reference: listOf('reference'),
    maxReads: numOf('max-reads'),
    totalReads: numOf('total-reads'),
    durationMs: numOf('duration-ms'),
    raw: out,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a backlog tree with active tickets and a mailbox tree of handoff files$/, (ctx) => {
    mkFixture(ctx);
  });

  // ── Scenario 01 (outline) ────────────────────────────────────────────────
  scoped(/^(\d+) handoff files across the scan dirs$/, (ctx, filesToken) => {
    const files = Number(filesToken);
    if (!KNOWN_FILE_COUNTS.has(files)) {
      throw new Error(`unknown <files> token: ${filesToken}`);
    }
    for (let i = 0; i < files; i++) {
      const dir = ctx.allDirs[i % ctx.allDirs.length];
      // A spread of ids so the index carries real per-ticket variety.
      writeHandoff(dir, `f-${i}.handoff`, [`task: BL-${400 + (i % 10)}-slice`, `enqueued_at: ${STALE_AT}`]);
    }
  });

  scoped(/^(\d+) active tickets$/, (ctx, itemsToken) => {
    const items = Number(itemsToken);
    if (!KNOWN_ITEM_COUNTS.has(items)) {
      throw new Error(`unknown <items> token: ${itemsToken}`);
    }
    for (let i = 0; i < items; i++) {
      writeActive(ctx, `BL-${400 + i}`);
    }
  });

  scoped(/^no handoff file is read more than once$/, (ctx) => {
    assert.ok(ctx.result.maxReads <= 1, `a handoff file was read ${ctx.result.maxReads} times: ${ctx.result.raw}`);
    assert.ok(ctx.result.totalReads > 0, `expected the sweep to have read the tree at all: ${ctx.result.raw}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────────
  scoped(
    /^a fixture tree covering a ticket with a stale trail, a ticket with live mail, a ticket with no trail at all, and a ticket whose only trail file has no parseable timestamp header$/,
    (ctx) => {
      const archive = path.join(ctx.root, 'QA', 'completed');
      writeActive(ctx, 'BL-501');
      writeHandoff(archive, 'a-501.handoff', ['task: BL-501-slice', `enqueued_at: ${STALE_AT}`]);
      writeActive(ctx, 'BL-502');
      writeHandoff(archive, 'a-502.handoff', ['task: BL-502-slice', `enqueued_at: ${STALE_AT}`]);
      writeHandoff(path.join(ctx.root, 'coder', 'new'), 'l-502.handoff', ['task: BL-502-slice', `enqueued_at: ${FRESH_AT}`]);
      writeActive(ctx, 'BL-503');
      writeActive(ctx, 'BL-504');
      writeHandoff(archive, 'a-504.handoff', ['task: BL-504-slice', 'enqueued_at: not-a-time']);
      ctx.wantReference = true;
    }
  );

  scoped(/^the nudged ticket ids are exactly those the per-item scan produced for the same tree$/, (ctx) => {
    assert.deepEqual(ctx.result.ids, ctx.result.reference, `candidate sets diverged: ${ctx.result.raw}`);
    // The tree is constructed so the comparison is non-trivial: the stale
    // ticket IS nudged, the other three are not.
    assert.deepEqual(ctx.result.ids, ['BL-501'], `expected exactly the stale-trail ticket: ${ctx.result.raw}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────────
  scoped(/^an active ticket whose only recent trail file is this sweep's own earlier coordinator nudge$/, (ctx) => {
    writeActive(ctx, 'BL-505');
    writeHandoff(path.join(ctx.root, 'QA', 'completed'), 'a-505.handoff', ['task: BL-505-slice', `enqueued_at: ${STALE_AT}`]);
    const nudgeMessage = execFileSync(
      'bb',
      ['-e', `(require '[babashka.fs :as fs]) (load-file ${JSON.stringify(CHASE_SWEEP_LIB)}) (print (chase-sweep-lib/dropped-parcel-note-message "BL-505"))`],
      { encoding: 'utf8' }
    );
    writeHandoff(path.join(ctx.root, 'coordinator', 'sent'), 'n-505.handoff', [`message: ${nudgeMessage}`, `enqueued_at: ${FRESH_AT}`]);
    ctx.candidateId = 'BL-505';
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────────
  scoped(
    /^an active ticket whose trail holds one stale file with a parseable timestamp and further files with no parseable timestamp header$/,
    (ctx) => {
      writeActive(ctx, 'BL-506');
      writeHandoff(path.join(ctx.root, 'QA', 'completed'), 'a-506.handoff', ['task: BL-506-slice', `enqueued_at: ${STALE_AT}`]);
      writeHandoff(path.join(ctx.root, 'coder', 'completed'), 'u1-506.handoff', ['task: BL-506-slice', 'enqueued_at: not-a-time']);
      writeHandoff(path.join(ctx.root, 'coordinator', 'sent'), 'u2-506.handoff', ['task: BL-506-slice', 'created_at: garbage']);
      ctx.candidateId = 'BL-506';
    }
  );

  // ── Scenario 06 ──────────────────────────────────────────────────────────
  scoped(/^an active ticket whose trail files all lack a parseable timestamp header$/, (ctx) => {
    writeActive(ctx, 'BL-507');
    writeHandoff(path.join(ctx.root, 'QA', 'completed'), 'u1-507.handoff', ['task: BL-507-slice', 'enqueued_at: not-a-time']);
    writeHandoff(path.join(ctx.root, 'coordinator', 'sent'), 'u2-507.handoff', ['task: BL-507-slice']);
    ctx.candidateId = 'BL-507';
  });

  // ── Scenario 05 (live tree) ──────────────────────────────────────────────
  scoped(/^the live mailbox tree of this host$/, (ctx) => {
    // The REAL dir construction: handoff_lib's own role-info + mailbox-dir
    // resolvers over this host's roles.tsv - the same composition
    // handoffd.bb's dispatch-gap-scan-dirs performs.
    const expr = `
(require '[babashka.fs :as fs] '[clojure.string :as str])
(load-file ${JSON.stringify(HANDOFF_LIB)})
(let [roles (handoff-lib/load-all-roles)]
  (prn {:all (vec (for [r roles, k [:new :in_process :completed :sent :outbox]] (str (handoff-lib/mailbox-dir r k))))
        :live (vec (for [r roles, k [:new :in_process]] (str (handoff-lib/mailbox-dir r k))))
        :active (str (fs/path (handoff-lib/target-root) "backlog" "active"))}))
`;
    const out = execFileSync('bb', ['-e', expr], { encoding: 'utf8', cwd: REPO_ROOT }).trim();
    const listOf = (key) => {
      const m = out.match(new RegExp(`:${key} \\[([^\\]]*)\\]`));
      return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    };
    ctx.allDirs = listOf('all');
    ctx.liveDirs = listOf('live');
    ctx.activeDir = (out.match(/:active "([^"]+)"/) || [])[1];
    assert.ok(ctx.allDirs.length >= 10, `expected a real multi-role live tree, got ${ctx.allDirs.length} dirs`);
    assert.ok(ctx.activeDir, `no active dir resolved: ${out}`);
  });

  scoped(/^its measured duration is below the supervisor stall threshold$/, (ctx) => {
    assert.ok(
      ctx.result.durationMs < SUPERVISOR_STALL_MS,
      `sweep took ${ctx.result.durationMs}ms, not below the ${SUPERVISOR_STALL_MS}ms supervisor window (pre-change baseline: 30000-143269ms)`
    );
  });

  // ── Shared When / Thens ──────────────────────────────────────────────────
  scoped(/^the dropped-parcel sweep evaluates one tick$/, (ctx) => {
    ctx.result = runSweep(ctx, { withReference: Boolean(ctx.wantReference) });
  });

  scoped(/^that ticket is still reported as a dropped-parcel candidate$/, (ctx) => {
    assert.ok(ctx.result.ids.includes(ctx.candidateId), `expected ${ctx.candidateId} among candidates: ${ctx.result.raw}`);
  });

  scoped(/^that ticket is not reported as a dropped-parcel candidate$/, (ctx) => {
    assert.ok(!ctx.result.ids.includes(ctx.candidateId), `expected ${ctx.candidateId} NOT to be a candidate: ${ctx.result.raw}`);
  });
}

module.exports = { registerSteps };
