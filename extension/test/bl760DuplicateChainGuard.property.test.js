'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-760: coder-authored property tests for this ticket's three declared
// invariants (coder.prompt's Invariants section - first authorship rests
// with the coder). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the unit/coverage/mutation
// run per engineering.prompt's property-test separation rule. Drives the
// REAL swarm_handoff.bb / duplicate_chain_guard_lib.bb via subprocess
// against real fixture mailboxes, the same "drive the real core" posture
// qaBounceFailureClassWidening.property.test.js's own CLI property uses.
//
// BL-971 (amendment): invariants 1 and 2 are now asserted by ONE merged
// property (identical draw shape, both labeled assertion groups per draw -
// see its comment), the fixture repo is built once per test with an
// asserted per-draw reset, and numRuns carries a measured basis. The
// invariant ENCODINGS below are unchanged - each break documented here
// still fails its own labeled assertion in the merged/remaining tests
// (the invariant-1 break was re-run against the reworked harness at
// BL-971-amendment time: dup-chain-block arm removed from
// swarm_handoff.bb -> the merged property failed on its first draw with
// the invariant-1 refusal assertion; restored, green).
//
// Non-vacuity, checked by hand before landing (all three invariants below):
//   - Invariant 1 (at-most-one-live-parcel): temporarily removed the
//     dup-chain-block arm from swarm_handoff.bb's git-errors cond-> (the
//     exact BL-727 regression shape - the guard call site deleted, gating
//     nothing). The refused-send property failed immediately (every
//     generated duplicate was silently accepted, exit 0). Restoring the
//     call site made it pass again.
//   - Invariant 2 (refusal is inert): temporarily reordered swarm_handoff.bb
//     so write-handoff! ran before the git-errors check was consulted. The
//     inertness property failed (outbox/sent gained a file even though the
//     send was later reported refused). Reverting made it pass again.
//   - Invariant 3 (exact ticket-id equality): temporarily swapped
//     duplicate_chain_guard_lib.bb's equality test for
//     salvage-lib/item-handoff?'s own prefix match
//     (str/starts-with? on the lower-cased task header - the exact
//     "BL-90 matches BL-901" bug this invariant exists to forbid). The
//     distinctness property failed with counterexamples like
//     {idA: "BL-4", idB: "BL-42"}. Restoring exact extract-ticket-id
//     equality made it pass again.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

// BL-871 QA bounce D2 (2026-08-11): every draw below shells out to a real
// `bb` process (and, pre-BL-971, to per-draw git fixture spawns). The
// worker-pool cap those tickets added bounds Vitest's OWN fork count and
// heap, not the real child-process CPU those forks consume - three forks
// each shelling out to real subprocesses can still oversubscribe this
// host's 4 real CPUs. Under that contention QA measured this file's
// properties actually finishing (not hanging) at up to 162757ms against
// the vitest.properties lane's global 20000ms testTimeout - a false
// failure, not a real one. 240000ms leaves headroom above the worst
// measured run; the per-test numRuns comments below carry the BL-971
// re-measured per-draw basis.
// BL-932: the value itself now lives in one place, imported here rather
// than hand-copied - see helpers/subprocessHeavyTimeout.js.
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function roleDir(root, role) {
  return path.join(root, role);
}

function mkFixture() {
  const root = mkTmpDir('sfvc-bl760-prop-');
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'FIXTURE-ticket.yaml'), 'id: FIXTURE\ntitle: t\nstatus: active\n');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = ROLES.map((r) => `${r}\t${r}-wt\t${roleDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`);
  rows.push(`coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  for (const r of ROLES) {
    fs.mkdirSync(roleDir(root, r), { recursive: true });
  }
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed fixture']);
  const commit = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  return { root, commit };
}

// BL-971 (amendment, bl760 slice): the fixture REPO is draw-invariant -
// nothing any draw varies (sender, ids, slugs, state) lives in git, only in
// mailbox files and the draft. Pre-rework every draw paid mkFixture's five
// git subprocesses (init, 2x commit, add, rev-parse) on top of the one real
// bb send under test: 120 draws x ~6 spawns was the file's dominant cost
// and what exhausted the SHARED 240s budget under full 8-agent load. Now
// each test builds ONE fixture and every draw resets only the mutable
// surface: every role dir (mailboxes, drafts) and the root handoffs dir
// (wake/inject logs), each removal ASSERTED gone so a draw can never pass
// against another draw's leftovers - the properties' own per-draw
// assertions are byte-identical, all generator arbitraries and numRuns
// unchanged.
function resetFixture(fx) {
  for (const r of ROLES) {
    const dir = roleDir(fx.root, r);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(dir), `resetFixture failed to clear ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
  const rootHandoffs = path.join(fx.root, '.swarmforge', 'handoffs');
  fs.rmSync(rootHandoffs, { recursive: true, force: true });
  assert.ok(!fs.existsSync(rootHandoffs), `resetFixture failed to clear ${rootHandoffs}`);
}

function mailboxDir(root, role, state) {
  return path.join(roleDir(root, role), '.swarmforge', 'handoffs', 'inbox', state);
}

function outboxDir(root, role) {
  return path.join(roleDir(root, role), '.swarmforge', 'handoffs', 'outbox');
}

function sentDir(root, role) {
  return path.join(roleDir(root, role), '.swarmforge', 'handoffs', 'sent');
}

function seedParcel(root, role, state, filename, task, commit) {
  const dir = mailboxDir(root, role, state);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, filename),
    `id: x\nfrom: specifier\nto: ${role}\npriority: 20\ntype: git_handoff\nrole: specifier\ntask: ${task}\ncommit: ${commit}\ncreated_at: 2026-07-31T00:00:00Z\n\nbody\n`,
  );
}

function listHandoffFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function runSwarmHandoff(root, sender, draft) {
  const cwd = roleDir(root, sender);
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draft);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: sender },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

const senderRoleArb = fc.constantFrom(...ROLES);
const stateArb = fc.constantFrom('new', 'in_process');
const digitsArb = fc.integer({ min: 1, max: 999 }).map(String);
// Optional trailing slug text (the ticket yaml filename / bounce-title shape
// the real BL-727 incident's second chain actually used) - present or empty,
// so the generator reaches both "bare ticket id" and "id plus slug" tasks.
const slugArb = fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,24}$/), { nil: undefined });

function taskFor(digits, slug) {
  return slug ? `BL-${digits}-${slug}` : `BL-${digits}`;
}

// ── Invariants 1 + 2, one property: a duplicate send is refused, and the
// refusal is inert ──
//
// BL-971 (amendment): the two invariants were separate 40-draw tests with
// BYTE-IDENTICAL draw shapes - the same fixture, the same seeded blocker,
// the same duplicate send; only the assertions differed. Each real bb send
// is the dominant per-draw cost (the system under test - irreducible), so
// asserting BOTH facets on ONE send halves the subprocess count with zero
// loss: every draw that used to check only refusal now also checks
// inertness, and vice versa. Both invariants keep their own labeled
// assertion groups below, so a failure still attributes to its invariant.
//
// numRuns basis (measured 2026-08-20, swarm host, live load - the same
// measured-rationale discipline the ticket requires for any reduction):
// one draw = one real refused bb send, floor 2.2-3.1s over 5 consecutive
// live single-draw measurements, 5.6-7.5s/draw inside a full scoped vitest
// run under concurrent-suite load (224s/40 and 301s/40 observed - the
// latter the BL-971-amendment exhaustion itself: 40-draw properties are
// arithmetically unfittable under that load, 40 x 7.5s = 300s > the 240s
// shared budget). At numRuns 16 the discrete discriminating space the
// dup-chain scan actually branches on (held state x held-slug presence x
// sent-slug presence = 8 combos; sender identity does not reach the scan)
// is still expected-covered ~2x per run, and every axis keeps its full
// range. Budget basis (measured above): 16 x 7.5s worst = 120s against the
// unchanged shared 240s budget = ~2x headroom at the WORST measured rate,
// ~40-50s at the measured floor.

test(
  'property: a duplicate send (same ticket id held live by any OTHER role) is refused, and the refusal is inert - nothing written, nothing delivered, no wake',
  () => {
    const fx = mkFixture();
    fc.assert(
      fc.property(
        senderRoleArb,
        digitsArb,
        slugArb,
        slugArb,
        stateArb,
        (sender, digits, heldSlug, sentSlug, state) => {
          resetFixture(fx);
          const others = ROLES.filter((r) => r !== sender);
          const blockingRole = others[0];
          const recipient = others[others.length - 1];
          const { root, commit } = fx;
          const heldTask = taskFor(digits, heldSlug);
          const sentTask = taskFor(digits, sentSlug);
          seedParcel(root, blockingRole, state, 'blocker.handoff', heldTask, commit);
          const draft = `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: ${sentTask}\ncommit: ${commit}\n`;
          const result = runSwarmHandoff(root, sender, draft);

          // Invariant 1: the duplicate is refused.
          assert.equal(
            result.status,
            2,
            `invariant 1: expected refusal (exit 2) for duplicate ticket BL-${digits}; held="${heldTask}" sent="${sentTask}" blocker=${blockingRole} sender=${sender} state=${state}, got exit ${result.status}: ${combinedOutput(result)}`,
          );
          assert.match(combinedOutput(result), /HANDOFF INVALID/);

          // Invariant 2: the refusal is inert.
          assert.deepEqual(listHandoffFiles(outboxDir(root, sender)), [], "invariant 2: sender's outbox must be empty after a refusal");
          assert.deepEqual(listHandoffFiles(sentDir(root, sender)), [], "invariant 2: sender's sent must be empty after a refusal");
          assert.deepEqual(
            listHandoffFiles(mailboxDir(root, recipient, 'new')),
            [],
            "invariant 2: recipient's new/ must receive no parcel after a refusal",
          );
          assert.doesNotMatch(combinedOutput(result), /HANDOFF (DELIVERED|QUEUED)/);
          assert.equal(
            fs.existsSync(path.join(root, '.swarmforge', 'handoffs', 'inject-traffic.log')),
            false,
            'invariant 2: no wake/inject attempt should have been reached for a refused send',
          );
        },
      ),
      { numRuns: 16 },
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS,
);

// ── Invariant 3: ticket identity is exact ticket-id equality, never a prefix/substring match ──
//
// idB is DERIVED from idA by appending one more digit - the exact transform
// salvage-lib/item-handoff?'s str/starts-with? prefix match would wrongly
// treat as "the same item" (BL-90 "starts with" BL-9, BL-901 "starts with"
// BL-90). Every generated pair is a collision candidate by construction, in
// both directions.

test(
  'property: a held parcel for a DIFFERENT ticket id never blocks a send, even when one id is a digit-prefix of the other',
  () => {
    const fx = mkFixture();
    fc.assert(
      fc.property(
        senderRoleArb,
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 0, max: 9 }),
        stateArb,
        fc.boolean(),
        (sender, base, extraDigit, state, heldIsLonger) => {
          resetFixture(fx);
          const others = ROLES.filter((r) => r !== sender);
          const blockingRole = others[0];
          const recipient = others[others.length - 1];
          const idA = String(base);
          const idB = `${base}${extraDigit}`;
          assert.notEqual(idA, idB, 'generator invariant: appending a digit must change the id string');

          const { root, commit } = fx;
          const heldDigits = heldIsLonger ? idB : idA;
          const sentDigits = heldIsLonger ? idA : idB;
          seedParcel(root, blockingRole, state, 'blocker.handoff', `BL-${heldDigits}`, commit);
          const draft = `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: BL-${sentDigits}\ncommit: ${commit}\n`;
          const result = runSwarmHandoff(root, sender, draft);

          assert.notEqual(
            result.status,
            2,
            `expected BL-${heldDigits} (held) not to block BL-${sentDigits} (sent) - distinct ids - got refused: ${combinedOutput(result)}`,
          );
        },
      ),
      // numRuns and budget basis: same measured 2026-08-20 numbers as the
      // merged invariant-1+2 property above (floor 2.2-3.1s/draw, worst
      // loaded 5.6-7.5s/draw; this test's own pre-rework run measured
      // 119s/40 draws). 16 x 7.5s worst = 120s vs the shared 240s budget =
      // ~2x headroom at the worst measured rate. The collision-pair
      // construction (idB derived from idA) and heldIsLonger direction flag
      // are untouched - every draw stays a collision candidate.
      { numRuns: 16 },
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS,
);
