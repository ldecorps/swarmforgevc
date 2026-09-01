'use strict';

// BL-1313 declared invariants:
//
// 1. A role's receive mode never changes what a send-time guard sees: a
//    parcel held inside a batch directory counts exactly as the same parcel
//    held as a flat file.
// 2. Absence still fails closed - a batch-held parcel carrying no
//    non-forwarding marker blocks a competing chain exactly as a flat one
//    does.
//
// Both invariants pin the batch-aware reader in handoff_lib.bb
// (handoff-files-with-batches) and the guard that calls it
// (duplicate_chain_guard_lib.bb's blocking-parcel).
//
// Drives the REAL committed bb code via spawnSync - no redefinition, no
// patching of the code under test. Runs ONLY via `npm run test:properties`.
//
// ISOLATION (architect bounce 2026-09-01, class invariant-unencoded): the
// previous version of this file re-defn'd the two readers inside the loaded
// namespace (a PATCH_EVAL block) so it exercised its own hand-written copy,
// never the committed code - it stayed green against a deliberately broken
// handoff_lib.bb. The motive was a background daemon reverting worktree files
// mid-run. The remediation the bounce prescribed: keep driving the real code,
// isolate the hazard instead. At suite start the full load-file closure of
// handoff_lib.bb / duplicate_chain_guard_lib.bb is copied byte-for-byte into
// a per-file shared tmp dir; every bb invocation loads those copies (the libs
// resolve their own load-file siblings relative to their own path, so the
// copied closure loads itself). The copies ARE the committed content as of
// seeding - break the committed file and this test goes red - while being
// immune to any mid-run worktree reversion. Nothing is re-derived by hand.
//
// FIXTURE LAYOUT (this file's second vacuity in the bounced version): role
// mailboxes are laid out exactly as handoff_lib.bb/mailbox-dir resolves them
// - roles.tsv rows point each role at its own worktree path, parcels sit in
// <worktree-path>/.swarmforge/handoffs/inbox/in_process[/batch_*]. The old
// fixture wrote parcels to <root>/<role>/in_process, which mailbox-dir never
// reads, so blocking-parcel never saw a parcel there.
//
// OUTPUT PARSING: bb -e prints its final form with prn (a returned string
// arrives WITH literal double quotes), so every script prints via println and
// returns nil; only println lines are parsed. The old version compared its
// prn-quoted "\"NIL\"" against 'NIL' - an equality that could never hold, so
// its refusal assertion could never fire.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// The full load-file closure seeded once into the isolated dir (verified:
// handoff_lib.bb loads the first eight, duplicate_chain_guard_lib.bb adds
// pipeline_stage_lib.bb, and every listed dep is itself load-file-closed).
const LIB_CLOSURE = [
  'handoff_lib.bb',
  'duplicate_chain_guard_lib.bb',
  'pipeline_stage_lib.bb',
  'ambulance_lib.bb',
  'shell_quote_lib.bb',
  'daemon_cycle_guard_lib.bb',
  'mono_router_lib.bb',
  'prompt_engine_lib.bb',
  'rotation_telemetry_lib.bb',
  'seat_difficulty_lib.bb',
  'self_heal_telemetry_lib.bb',
];

const TICKETS = ['BL-901', 'BL-902', 'BL-903'];
const HOLDER_ROLES = ['cleaner', 'hardender'];
const SENDER = 'coder';

let LIB_DIR = null;

beforeAll(() => {
  LIB_DIR = mkSharedTmpDir('sfvc-bl1313-libs-');
  for (const name of LIB_CLOSURE) {
    fs.cpSync(path.join(SCRIPTS_DIR, name), path.join(LIB_DIR, name));
  }
});

function bbEval(script) {
  const result = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      SWARMFORGE_ROLE: undefined,
    },
  });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

// The generated shape of one held parcel. placement: flat on the in_process
// top level vs inside a batch_* subdir (what ready_for_next claims for batch
// roles). marker mirrors the non-forwarding header: 'true' stamps
// "non-forwarding: true", 'false' stamps "non-forwarding: false", 'absent'
// stamps no header - non-forwarding? is true ONLY for the literal "true", so
// forwardable means marker !== 'true'.
const parcelArb = fc.record({
  ticket: fc.constantFrom(...TICKETS),
  role: fc.constantFrom(...HOLDER_ROLES),
  placement: fc.constantFrom('flat', 'batch'),
  marker: fc.constantFrom('true', 'false', 'absent'),
});

const populationArb = fc.array(parcelArb, { minLength: 1, maxLength: 12 });

// ── reachability floor ──────────────────────────────────────────────────────
// BL-654: the generator must DEMONSTRABLY reach the states the invariants
// quantify over - an asserted floor, not a hoped-for one. Every shape the two
// properties' assertions are written against must actually occur in sampled
// populations, or a green run could mean the interesting region was never
// drawn.
describe('BL-1313 batch guard visibility invariants (property)', () => {
  it('generator reaches every state the invariants quantify over', () => {
    const samples = fc.sample(populationArb, 1000);
    const flat = samples.filter((pop) => pop.some((p) => p.placement === 'flat'));
    const batch = samples.filter((pop) => pop.some((p) => p.placement === 'batch'));
    const markerTrue = samples.filter((pop) => pop.some((p) => p.marker === 'true'));
    const markerFalse = samples.filter((pop) => pop.some((p) => p.marker === 'false'));
    const markerAbsent = samples.filter((pop) => pop.some((p) => p.marker === 'absent'));
    const bothRoles = samples.filter((pop) => {
      const roles = new Set(pop.map((p) => p.role));
      return HOLDER_ROLES.every((r) => roles.has(r));
    });
    const sameTicketBothPlacements = samples.filter((pop) =>
      TICKETS.some((t) => {
        const ps = pop.filter((p) => p.ticket === t);
        return ps.some((p) => p.placement === 'flat') && ps.some((p) => p.placement === 'batch');
      })
    );
    const sameTicketMixedMarkers = samples.filter((pop) =>
      TICKETS.some((t) => {
        const ps = pop.filter((p) => p.ticket === t);
        return ps.some((p) => p.marker === 'true') && ps.some((p) => p.marker !== 'true');
      })
    );
    const deep = samples.filter((pop) => pop.length >= 8);

    assert.ok(flat.length > 0, 'no flat-placement parcel ever sampled');
    assert.ok(batch.length > 0, 'no batch-placement parcel ever sampled');
    assert.ok(markerTrue.length > 0, 'no non-forwarding:true parcel ever sampled');
    assert.ok(markerFalse.length > 0, 'no non-forwarding:false parcel ever sampled');
    assert.ok(markerAbsent.length > 0, 'no marker-absent parcel ever sampled');
    assert.ok(bothRoles.length > 0, 'no population ever holds parcels at BOTH batch roles');
    assert.ok(sameTicketBothPlacements.length > 0, 'no ticket ever held flat AND batch at once');
    assert.ok(sameTicketMixedMarkers.length > 0, 'no ticket ever mixes marked and unmarked parcels');
    assert.ok(deep.length > 0, 'no deep (>=8 parcel) population ever sampled');
  });

  // Invariant 1: receive mode never changes what the send-time guard sees.
  // For each batch role, the reader must return exactly the same parcel set
  // whether every parcel sits flat on in_process or inside batch_* subdirs -
  // and exactly the expected set (nothing lost, nothing invented), including
  // an empty in_process reading as nothing.
  it('Invariant 1: a batch-held parcel is visible to the guard reader exactly as a flat one', () => {
    // One bb invocation per sample walks all four fixture dirs (generated vs
    // all-flat x each holder role), tagging each printed path by dir so one
    // subprocess covers the whole sample.
    const listVisible = (dirsByTag) => {
      const walk = Object.entries(dirsByTag)
        .map(([tag, dir]) =>
          `(doseq [f (handoff-lib/handoff-files-with-batches "${dir}")]
             (println (str "${tag}|" (str f))))`)
        .join('\n        ');
      const script = `(do
        (load-file "${path.join(LIB_DIR, 'handoff_lib.bb')}")
        ${walk})`;
      const out = {};
      for (const tag of Object.keys(dirsByTag)) out[tag] = [];
      for (const line of bbEval(script).split('\n').filter(Boolean)) {
        const sep = line.indexOf('|');
        const tag = line.slice(0, sep);
        out[tag].push(path.basename(line.slice(sep + 1).trim()));
      }
      for (const tag of Object.keys(out)) out[tag].sort();
      return out;
    };

    const parcelName = (idx, ticket) => `${String(idx).padStart(3, '0')}_${ticket}.handoff`;

    const materialize = (parcelsForRole, placementOverride) => {
      const root = mkTmpDir('sfvc-bl1313-inv1-');
      const inProcess = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.mkdirSync(inProcess, { recursive: true });
      parcelsForRole.forEach((p, i) => {
        const placement = placementOverride || p.placement;
        const dir = placement === 'batch'
          ? path.join(inProcess, `batch_20260901T000000Z_${String(i).padStart(6, '0')}`)
          : inProcess;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, parcelName(p.idx, p.ticket)), 'body\n');
      });
      return inProcess;
    };

    fc.assert(
      fc.property(populationArb, (population) => {
        const withIdx = population.map((p, i) => ({ ...p, idx: i }));
        const dirsByTag = {};
        for (const role of HOLDER_ROLES) {
          const parcelsForRole = withIdx.filter((p) => p.role === role);
          dirsByTag[`${role}-gen`] = materialize(parcelsForRole, null);
          dirsByTag[`${role}-flat`] = materialize(parcelsForRole, 'flat');
        }
        const visible = listVisible(dirsByTag);

        for (const role of HOLDER_ROLES) {
          const parcelsForRole = withIdx.filter((p) => p.role === role);
          const expected = parcelsForRole.map((p) => parcelName(p.idx, p.ticket)).sort();
          const asGenerated = visible[`${role}-gen`];
          const allFlat = visible[`${role}-flat`];

          assert.deepEqual(
            asGenerated, expected,
            `${role}: reader output for generated placements != expected parcel set`
          );
          assert.deepEqual(
            allFlat, expected,
            `${role}: reader output for all-flat placements != expected parcel set`
          );
          assert.deepEqual(
            asGenerated, allFlat,
            `${role}: placement changed what the guard reader sees`
          );
        }
      }),
      { numRuns: 60 }
    );
  });

  // Invariant 2: absence fails closed, batch-held exactly like flat. For
  // every ticket, blocking-parcel's decision must be: blocked IFF some other
  // role holds a forwardable (marker !== 'true') parcel for it - identical
  // under placement flip, naming the identical blocker. A batch-held parcel
  // with no marker is exactly as blocking as a flat one; a non-forwarding
  // marker exempts (BL-1302) whether flat or batched.
  it('Invariant 2: a batch-held unmarked parcel blocks a competing chain exactly as a flat one does', () => {
    // One bb invocation per sample asks blocking-parcel about every ticket in
    // BOTH fixture roots (generated placements vs all-flat), tagging each
    // decision by root.
    const decisions = (rootsByTag) => {
      const ask = Object.entries(rootsByTag)
        .map(([tag, root]) =>
          `(doseq [t ["${TICKETS.join('" "')}"]]
             (if-let [b (duplicate-chain-guard-lib/blocking-parcel "${root}" t "${SENDER}")]
               (println (str "${tag}|" t "|BLOCKED|" (:role b) "|" (.getName (java.io.File. (str (:file b))))))
               (println (str "${tag}|" t "|FREE"))))`)
        .join('\n        ');
      const script = `(do
        (load-file "${path.join(LIB_DIR, 'duplicate_chain_guard_lib.bb')}")
        ${ask})`;
      const out = {};
      for (const tag of Object.keys(rootsByTag)) out[tag] = {};
      for (const line of bbEval(script).split('\n').filter(Boolean)) {
        const [tag, ticket, verdict, role, file] = line.trim().split('|');
        out[tag][ticket] = { blocked: verdict === 'BLOCKED', role: role || null, file: file || null };
      }
      return out;
    };

    const parcelName = (idx, ticket) => `${String(idx).padStart(3, '0')}_${ticket}.handoff`;

    const materialize = (population, placementOverride) => {
      const root = mkTmpDir('sfvc-bl1313-inv2-');
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      const rows = [];
      for (const role of [...HOLDER_ROLES, SENDER]) {
        const worktreePath = path.join(root, role);
        fs.mkdirSync(worktreePath, { recursive: true });
        rows.push([role, role, worktreePath, `swarmforge-${role}`, role, 'claude', role === SENDER ? 'task' : 'batch'].join('\t'));
      }
      fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.join('\n') + '\n');

      population.forEach((p, i) => {
        const placement = placementOverride || p.placement;
        const inProcess = path.join(root, p.role, '.swarmforge', 'handoffs', 'inbox', 'in_process');
        const dir = placement === 'batch'
          ? path.join(inProcess, `batch_20260901T000000Z_${String(i).padStart(6, '0')}`)
          : inProcess;
        fs.mkdirSync(dir, { recursive: true });
        const lines = [
          `id: ${i}`,
          'from: specifier',
          `to: ${p.role}`,
          'recipient: ' + p.role,
          'priority: 50',
          'type: git_handoff',
          `task: ${p.ticket}`,
          'commit: a1b2c3d4e5',
        ];
        if (p.marker !== 'absent') lines.push(`non-forwarding: ${p.marker}`);
        lines.push('', 'body');
        fs.writeFileSync(path.join(dir, parcelName(p.idx, p.ticket)), lines.join('\n') + '\n');
      });
      return root;
    };

    fc.assert(
      fc.property(populationArb, (population) => {
        const withIdx = population.map((p, i) => ({ ...p, idx: i }));

        const all = decisions({
          gen: materialize(withIdx, null),
          flat: materialize(withIdx, 'flat'),
        });
        const asGenerated = all.gen;
        const allFlat = all.flat;

        for (const ticket of TICKETS) {
          const forwardable = withIdx.some((p) => p.ticket === ticket && p.marker !== 'true');
          const gen = asGenerated[ticket];
          const flat = allFlat[ticket];
          assert.ok(gen && flat, `no decision parsed for ${ticket}`);

          assert.equal(
            gen.blocked, forwardable,
            `${ticket}: blocked=${gen.blocked} but forwardable-holder=${forwardable} `
            + `(absence fails closed; non-forwarding exempts) pop=${JSON.stringify(population)}`
          );
          assert.equal(
            flat.blocked, forwardable,
            `${ticket}: all-flat blocked=${flat.blocked} but forwardable-holder=${forwardable}`
          );
          assert.equal(
            gen.blocked, flat.blocked,
            `${ticket}: placement changed the blocking decision`
          );
          if (gen.blocked) {
            assert.equal(gen.role, flat.role, `${ticket}: placement changed the blocking role`);
            assert.equal(gen.file, flat.file, `${ticket}: placement changed the blocking file`);
          }
        }
      }),
      { numRuns: 60 }
    );
  });
});
