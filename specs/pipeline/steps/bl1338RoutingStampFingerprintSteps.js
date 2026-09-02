'use strict';

// BL-1338: step handlers for "the promotion's own routing stamp does not
// invalidate the adjudication that authorized it".
//
// The routing stamp is never re-implemented here: the promoted scenario runs
// the REAL swarmforge/scripts/promote_and_route_next.sh against a fixture
// project root that is its own git repository, so the script's commit and the
// handoff helpers' `git rev-parse --show-toplevel` both resolve INSIDE the
// fixture and the live mailboxes are never touched (BL-1256's failure shape,
// same guard as BL-1267's scenario 06).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PROMOTE_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const LIVE_INBOX = path.join(REPO_ROOT, '.swarmforge', 'handoffs', 'inbox', 'new');
const FIXTURE_PREFIX = 'bl1338-acceptance-';
const TICKET_ID = 'BL-9338';

// A ticket the gate holds on its own text: an allow measured against a
// fixture that never held anything is not evidence.
const HELD_TICKET = [
  `id: ${TICKET_ID}`,
  'title: "fixture ticket for the routing-stamp fingerprint"',
  'type: feature',
  'status: todo',
  'human_approval: approved',
  'priority: 10',
  'depends_on: []',
  'closed_as: superseded-by-BL-9339',
  `acceptance: specs/features/${TICKET_ID}-fixture.feature`,
  'description: |',
  '  the substance of the fixture ticket',
  '',
].join('\n');

// Scenario Outline values are validated against this table rather than
// passed through: an unknown change or verdict is a failure, not a silent
// pass (the explicit-KNOWN_VALUES rule).
const CHANGES = {
  'the routing stamp a promotion writes': (root) => promoteFixture(root),
  'an edit to its acceptance criteria': (root) =>
    rewriteTicket(root, (text) => text.replace(/^acceptance: .*$/m, 'acceptance: specs/features/amended.feature')),
  'an edit to its description': (root) =>
    rewriteTicket(root, (text) => text.replace('the substance of the fixture ticket', 'amended substance')),
};
const VERDICTS = { 'still matches': true, 'no longer matches': false };

function cliModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'deprecate-check.js'));
}

function writerModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'record-adjudication.js'));
}

// BL-971: sweep by prefix up front too - a killed earlier run traps nothing.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

function ticketPath(root, folder = 'paused') {
  return path.join(root, 'backlog', folder, `${TICKET_ID}-fixture.yaml`);
}

function currentTicketPath(root) {
  return fs.existsSync(ticketPath(root, 'active')) ? ticketPath(root, 'active') : ticketPath(root, 'paused');
}

function rewriteTicket(root, transform) {
  const file = currentTicketPath(root);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) {
    throw new Error(`the amendment changed nothing in ${file}, so the scenario would prove nothing`);
  }
  fs.writeFileSync(file, after);
}

/** Run the real promotion, which stamps `assigned_to:` after the gate passes. */
function promoteFixture(root) {
  try {
    execFileSync('bash', [PROMOTE_SCRIPT], {
      cwd: root,
      env: { ...process.env, SWARMFORGE_ROLE: 'coordinator' },
      stdio: 'pipe',
    });
  } catch {
    // A refused promotion exits non-zero by design; the durable observable
    // the caller asserts on is the ticket file itself.
  }
  const file = currentTicketPath(root);
  if (!/^assigned_to:/m.test(fs.readFileSync(file, 'utf8'))) {
    throw new Error(`the promotion wrote no routing stamp into ${file}, so this scenario tests nothing`);
  }
}

function ensureRoot(ctx) {
  if (ctx.bl1338Root) {
    return ctx.bl1338Root;
  }
  sweepStaleFixtures();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const dir of [...liveFixtures]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort on the way out */
        }
      }
    });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  liveFixtures.add(root);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(ticketPath(root), HELD_TICKET);
  fs.writeFileSync(path.join(root, 'specs', 'features', `${TICKET_ID}-fixture.feature`), '');
  git(root, ['init', '-q', '.']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'bl1338 fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
  ctx.bl1338Root = root;
  ctx.bl1338LiveInboxBefore = countLiveInbox();
  return root;
}

function countLiveInbox() {
  try {
    return fs.readdirSync(LIVE_INBOX).length;
  } catch {
    return 0;
  }
}

const FEATURE_NAME =
  "BL-1338 the promotion's own routing stamp does not invalidate the adjudication that authorized it";

function registerSteps(registry) {
  // Scoped for the same reason BL-1267's file is: the gate's step texts are
  // generic enough that an unscoped registration would answer another
  // feature's scenarios with this ticket's fixture (BL-425).
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^a ticket with a recorded confirm_promote adjudication$/, (ctx) => {
    const root = ensureRoot(ctx);
    const held = cliModule().deprecateCheck(root, TICKET_ID);
    if (held.decision !== 'hold') {
      throw new Error(`the fixture ticket does not hold, so a later allow proves nothing: ${JSON.stringify(held)}`);
    }
    ctx.bl1338Record = writerModule().recordAdjudication({
      root,
      ticketId: TICKET_ID,
      outcome: 'confirm_promote',
      adjudicatedBy: 'specifier',
      adjudicatedAt: '2026-09-02T12:00:00.000Z',
    });
    const cleared = cliModule().deprecateCheck(root, TICKET_ID);
    if (cleared.decision !== 'allow') {
      throw new Error(`the recorded adjudication does not clear the hold: ${JSON.stringify(cleared)}`);
    }
  });

  scoped(/^the ticket changes by (.+)$/, (ctx, change) => {
    const apply = CHANGES[change];
    if (!apply) {
      throw new Error(`unknown change "${change}" - the Examples table and this handler have diverged`);
    }
    apply(ensureRoot(ctx));
  });

  scoped(/^the recorded adjudication (still matches|no longer matches)$/, (ctx, verdict) => {
    if (!(verdict in VERDICTS)) {
      throw new Error(`unknown verdict "${verdict}" - the Examples table and this handler have diverged`);
    }
    const root = ensureRoot(ctx);
    const record = JSON.parse(fs.readFileSync(ctx.bl1338Record.path, 'utf8'));
    const now = cliModule().computeTicketFingerprint(fs.readFileSync(currentTicketPath(root), 'utf8'));
    const matches = record.content_fingerprint === now;
    if (matches !== VERDICTS[verdict]) {
      throw new Error(
        `expected the record to ${verdict} the ticket, but recorded ${record.content_fingerprint.slice(0, 12)} ` +
          `and the ticket is now ${now.slice(0, 12)}`
      );
    }
    // The verdict must be the gate's, not only the fingerprint's.
    const decision = cliModule().deprecateCheck(root, TICKET_ID);
    if (decision.decision !== (VERDICTS[verdict] ? 'allow' : 'hold')) {
      throw new Error(`the gate disagrees with the fingerprint: ${JSON.stringify(decision)}`);
    }
  });

  scoped(/^the ticket's spec is amended after the adjudication was recorded$/, (ctx) => {
    CHANGES['an edit to its description'](ensureRoot(ctx));
  });

  scoped(/^the ticket has been promoted and carries its routing stamp$/, (ctx) => {
    const root = ensureRoot(ctx);
    promoteFixture(root);
    if (!fs.existsSync(ticketPath(root, 'active'))) {
      throw new Error('the promotion did not move the ticket into backlog/active/');
    }
    const after = countLiveInbox();
    if (after !== ctx.bl1338LiveInboxBefore) {
      throw new Error(`the fixture delivered a handoff into the live mailbox (${ctx.bl1338LiveInboxBefore} → ${after})`);
    }
  });

  scoped(/^the freshness gate is consulted$/, (ctx) => {
    ctx.bl1338Decision = cliModule().deprecateCheck(ensureRoot(ctx), TICKET_ID);
  });

  scoped(/^it holds and names re-adjudication as the remedy$/, (ctx) => {
    const decision = ctx.bl1338Decision;
    if (decision.decision !== 'hold') {
      throw new Error(`expected a hold, got ${decision.decision} (${decision.reason || 'no reason'})`);
    }
    if (!/re-adjudicate/.test(decision.reason || '')) {
      throw new Error(`the hold does not name re-adjudication: ${decision.reason || '(no reason at all)'}`);
    }
  });

  scoped(/^it allows, naming the adjudication record$/, (ctx) => {
    const decision = ctx.bl1338Decision;
    if (decision.decision !== 'allow') {
      throw new Error(`expected an allow, got ${decision.decision} (${decision.reason || 'no reason'})`);
    }
    if (!(decision.reason || '').includes(ctx.bl1338Record.path)) {
      throw new Error(`the allow does not name the record it came from: ${decision.reason || '(no reason at all)'}`);
    }
  });
}

module.exports = { registerSteps };
