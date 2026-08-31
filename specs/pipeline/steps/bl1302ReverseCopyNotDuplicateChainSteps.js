'use strict';

// BL-1302: step handlers for "a reverse-hop copy does not block the forward
// it was synthesized from".
//
// Each scenario builds a REAL mailbox tree - roles.tsv, inbox/new, handoff
// files with real headers - and asks the REAL production predicate,
// duplicate_chain_guard_lib.bb's `blocking-parcel`, the same question
// swarm_handoff.bb's validate step asks on every send. Nothing about the
// guard is modelled or stubbed: the marker under test is a header line, and
// reading that line off disk is precisely the behaviour this ticket changes.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'duplicate_chain_guard_lib.bb');

const FEATURE = 'A reverse-hop copy does not block the forward it was synthesized from';

// The pipeline stages the fixture roles.tsv carries, in order. The sender is
// `architect`, so `coder` is an EARLIER role - the mailbox a back-one or
// back-all forward actually plants its copy in.
const STAGES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const SENDER = 'architect';
const BLOCKER_ROLE = 'coder';
const TICKET = 'BL-901';

function writeRoles(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = STAGES.map(
    (s) => `${s}\t${s}-wt\t${path.join(root, s)}\tswarmforge-${s}\t${s}\tclaude\ttask`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

// marker: 'true' stamps `non-forwarding: true` exactly as swarm_handoff.bb's
// with-non-forwarding does; null writes no marker line at all.
function writeParcel(root, role, filename, marker) {
  const dir = path.join(root, role, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    'id: x',
    'from: architect',
    `to: ${role}`,
    'priority: 00',
    'type: git_handoff',
    `task: ${TICKET}-some-work`,
    'commit: a1b2c3d4e5',
  ];
  if (marker !== null) {
    lines.push(`non-forwarding: ${marker}`);
  }
  fs.writeFileSync(path.join(dir, filename), `${lines.join('\n')}\n\nbody\n`);
  return filename;
}

// Calls the production predicate itself. Prints the blocker's filename, or
// the literal `nil` when the send is unblocked.
function askGuard(root) {
  const program = `
(require '[babashka.fs :as fs])
(load-file "${GUARD_LIB}")
(let [b (duplicate-chain-guard-lib/blocking-parcel "${root}" "${TICKET}-some-work" "${SENDER}")]
  (println (if b (str (:role b) " " (fs/file-name (:file b))) "nil")))`;
  const run = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(run.status, 0, `bb failed: ${run.stderr}`);
  return run.stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a role is sending a forward git_handoff for a ticket$/, (ctx) => {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1302-aps-'));
    writeRoles(ctx.root);
  });

  scoped(
    /^another role's mailbox holds a live parcel for that ticket marked non-forwarding$/,
    (ctx) => {
      ctx.parcel = writeParcel(ctx.root, BLOCKER_ROLE, '00_reverse_copy.handoff', 'true');
    }
  );

  scoped(/^another role's mailbox holds a live forward parcel for that ticket$/, (ctx) => {
    ctx.parcel = writeParcel(ctx.root, BLOCKER_ROLE, '50_forward_parcel.handoff', null);
  });

  scoped(
    /^another role's mailbox holds a live parcel for that ticket with no non-forwarding marker$/,
    (ctx) => {
      ctx.parcel = writeParcel(ctx.root, BLOCKER_ROLE, '50_unmarked_parcel.handoff', null);
    }
  );

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the duplicate-chain guard evaluates the send$/, (ctx) => {
    ctx.result = askGuard(ctx.root);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the send is not blocked$/, (ctx) => {
    assert.equal(
      ctx.result,
      'nil',
      `the reverse-hop copy blocked the forward it was synthesized from: ${ctx.result}`
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(/^the send is blocked naming that parcel$/, (ctx) => {
    assert.equal(
      ctx.result,
      `${BLOCKER_ROLE} ${ctx.parcel}`,
      `the guard did not refuse naming ${ctx.parcel}: ${ctx.result}`
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
