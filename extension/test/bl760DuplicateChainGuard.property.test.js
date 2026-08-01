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
// Non-vacuity, checked by hand before landing (all three properties below):
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

// ── Invariant 1: at most one live parcel per ticket id; a duplicate send is refused ──

test('property: a send is always refused when any OTHER role already holds a live (new/ or in_process/) git_handoff for the same ticket id', () => {
  fc.assert(
    fc.property(
      senderRoleArb,
      digitsArb,
      slugArb,
      slugArb,
      stateArb,
      (sender, digits, heldSlug, sentSlug, state) => {
        const others = ROLES.filter((r) => r !== sender);
        const blockingRole = others[0];
        const recipient = others[others.length - 1];
        const { root, commit } = mkFixture();
        const heldTask = taskFor(digits, heldSlug);
        const sentTask = taskFor(digits, sentSlug);
        seedParcel(root, blockingRole, state, 'blocker.handoff', heldTask, commit);
        const draft = `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: ${sentTask}\ncommit: ${commit}\n`;
        const result = runSwarmHandoff(root, sender, draft);
        assert.equal(
          result.status,
          2,
          `expected refusal (exit 2) for duplicate ticket BL-${digits}; held="${heldTask}" sent="${sentTask}" blocker=${blockingRole} sender=${sender} state=${state}, got exit ${result.status}: ${combinedOutput(result)}`,
        );
        assert.match(combinedOutput(result), /HANDOFF INVALID/);
      },
    ),
    { numRuns: 40 },
  );
});

// ── Invariant 2: a refused send is inert ────────────────────────────────

test('property: a refused send writes nothing to the sender\'s outbox/sent, delivers nothing to the recipient, and injects no wake', () => {
  fc.assert(
    fc.property(senderRoleArb, digitsArb, slugArb, slugArb, stateArb, (sender, digits, heldSlug, sentSlug, state) => {
      const others = ROLES.filter((r) => r !== sender);
      const blockingRole = others[0];
      const recipient = others[others.length - 1];
      const { root, commit } = mkFixture();
      const heldTask = taskFor(digits, heldSlug);
      const sentTask = taskFor(digits, sentSlug);
      seedParcel(root, blockingRole, state, 'blocker.handoff', heldTask, commit);
      const draft = `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: ${sentTask}\ncommit: ${commit}\n`;
      const result = runSwarmHandoff(root, sender, draft);

      assert.equal(result.status, 2, `expected the send to be refused, got: ${combinedOutput(result)}`);
      assert.deepEqual(listHandoffFiles(outboxDir(root, sender)), [], "sender's outbox must be empty after a refusal");
      assert.deepEqual(listHandoffFiles(sentDir(root, sender)), [], "sender's sent must be empty after a refusal");
      assert.deepEqual(
        listHandoffFiles(mailboxDir(root, recipient, 'new')),
        [],
        "recipient's new/ must receive no parcel after a refusal",
      );
      assert.doesNotMatch(combinedOutput(result), /HANDOFF (DELIVERED|QUEUED)/);
      assert.equal(
        fs.existsSync(path.join(root, '.swarmforge', 'handoffs', 'inject-traffic.log')),
        false,
        'no wake/inject attempt should have been reached for a refused send',
      );
    }),
    { numRuns: 40 },
  );
});

// ── Invariant 3: ticket identity is exact ticket-id equality, never a prefix/substring match ──
//
// idB is DERIVED from idA by appending one more digit - the exact transform
// salvage-lib/item-handoff?'s str/starts-with? prefix match would wrongly
// treat as "the same item" (BL-90 "starts with" BL-9, BL-901 "starts with"
// BL-90). Every generated pair is a collision candidate by construction, in
// both directions.

test('property: a held parcel for a DIFFERENT ticket id never blocks a send, even when one id is a digit-prefix of the other', () => {
  fc.assert(
    fc.property(
      senderRoleArb,
      fc.integer({ min: 1, max: 99 }),
      fc.integer({ min: 0, max: 9 }),
      stateArb,
      fc.boolean(),
      (sender, base, extraDigit, state, heldIsLonger) => {
        const others = ROLES.filter((r) => r !== sender);
        const blockingRole = others[0];
        const recipient = others[others.length - 1];
        const idA = String(base);
        const idB = `${base}${extraDigit}`;
        assert.notEqual(idA, idB, 'generator invariant: appending a digit must change the id string');

        const { root, commit } = mkFixture();
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
    { numRuns: 40 },
  );
});
