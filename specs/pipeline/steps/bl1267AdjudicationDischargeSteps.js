'use strict';

// BL-1267: step handlers for "the deprecator freshness gate honours a recorded
// specifier adjudication". Scenarios 01-05 drive the compiled CLI directly;
// scenario 06 drives the REAL swarmforge/scripts/promote_and_route_next.sh
// against a fixture project root and asserts on where the ticket file ends up,
// never on a log line and never on a re-implementation of the script's own
// parse (BL-1256's failure shape, called out by name in this ticket).
//
// The fixture is its own git repository, so the promote script's commit and
// the handoff helpers' `git rev-parse --show-toplevel` both resolve INSIDE the
// fixture - the live .swarmforge/ mailboxes are never written to, which the
// last step of scenario 06 asserts rather than assumes.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PROMOTE_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const LIVE_INBOX = path.join(REPO_ROOT, '.swarmforge', 'handoffs', 'inbox', 'new');
const FIXTURE_PREFIX = 'bl1267-acceptance-';
const TICKET_ID = 'BL-9001';

// A ticket the gate holds on its own text - a discharge measured against a
// fixture that never held anything is not evidence (qa_e2e step 2).
const HELD_TICKET = [
  `id: ${TICKET_ID}`,
  'title: "fixture ticket for the discharge path"',
  'type: feature',
  'status: todo',
  'human_approval: approved',
  'priority: 10',
  'assigned_to: coder',
  'depends_on: []',
  'closed_as: superseded-by-BL-9002',
  `acceptance: specs/features/${TICKET_ID}-fixture.feature`,
  '',
].join('\n');

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

function ensureRoot(ctx) {
  if (ctx.bl1267Root) {
    return ctx.bl1267Root;
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
  fs.writeFileSync(path.join(root, 'backlog', 'paused', `${TICKET_ID}-fixture.yaml`), HELD_TICKET);
  ctx.bl1267Root = root;
  return root;
}

function ticketPath(root, folder = 'paused') {
  return path.join(root, 'backlog', folder, `${TICKET_ID}-fixture.yaml`);
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

/** Make the fixture a real git repo so the promote script can commit in it. */
function initFixtureRepo(root) {
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', `${TICKET_ID}-fixture.feature`), '');
  git(root, ['init', '-q', '.']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'bl1267 fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
}

function countLiveInbox() {
  try {
    return fs.readdirSync(LIVE_INBOX).length;
  } catch {
    return 0;
  }
}

const FEATURE_NAME = 'the deprecator freshness gate honours a recorded specifier adjudication';

function registerSteps(registry) {
  // BL-425 scoping, and not optional here: BL-1268's handler file registers
  // the SAME generic step texts ("the deprecator freshness check runs for
  // that ticket", "the decision is ...") for the same CLI, and unscoped
  // registrations resolve first-match across every file. Unscoped, this
  // file's registration won BL-1268's scenarios and answered them with THIS
  // ticket's fixture. Scoped, each feature resolves its own.
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);
  // ── Background ──────────────────────────────────────────────────────
  scoped(/^the Article 3\.6 deprecator freshness gate is in force$/, (ctx) => {
    const cli = cliModule();
    for (const name of ['deprecateCheck', 'readAdjudication', 'applyAdjudication', 'computeTicketFingerprint']) {
      if (typeof cli[name] !== 'function') {
        throw new Error(`the freshness gate does not export ${name}`);
      }
    }
    if (typeof writerModule().recordAdjudication !== 'function') {
      throw new Error('no writer ships for the adjudication record the gate reads');
    }
  });

  scoped(/^a paused ticket the freshness check holds on its ticket text$/, (ctx) => {
    const root = ensureRoot(ctx);
    const decision = cliModule().deprecateCheck(root, TICKET_ID);
    if (decision.decision !== 'hold') {
      throw new Error(`the fixture ticket does not hold, so a later allow proves nothing: ${JSON.stringify(decision)}`);
    }
    ctx.bl1267OriginalReason = decision.reason;
  });

  // ── 01 / 02 / 03 ────────────────────────────────────────────────────
  scoped(
    /^a recorded adjudication for that ticket's current content with outcome "([a-z_]+)"$/,
    (ctx, outcome) => {
      const root = ensureRoot(ctx);
      ctx.bl1267Record = writerModule().recordAdjudication({
        root,
        ticketId: TICKET_ID,
        outcome,
        adjudicatedBy: 'specifier',
        adjudicatedAt: '2026-08-29T12:00:00.000Z',
      });
    }
  );

  scoped(/^the ticket content is amended after the adjudication was recorded$/, (ctx) => {
    fs.appendFileSync(ticketPath(ensureRoot(ctx)), 'notes: |\n  amended after the adjudication\n');
  });

  // ── 04 / 05 ─────────────────────────────────────────────────────────
  scoped(/^an adjudication record for that ticket that cannot be read or parsed$/, (ctx) => {
    const root = ensureRoot(ctx);
    const target = cliModule().adjudicationRecordPath(root, TICKET_ID);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{ "outcome": "confirm_promote"');
    ctx.bl1267Record = { path: target };
  });

  scoped(/^no adjudication record exists for that ticket$/, (ctx) => {
    const root = ensureRoot(ctx);
    const target = cliModule().adjudicationRecordPath(root, TICKET_ID);
    if (fs.existsSync(target)) {
      throw new Error(`the fixture already carries a record at ${target}`);
    }
  });

  scoped(/^the deprecator freshness check runs for that ticket$/, (ctx) => {
    ctx.bl1267Decision = cliModule().deprecateCheck(ensureRoot(ctx), TICKET_ID);
  });

  scoped(/^the decision is "?(allow|hold)"?$/, (ctx, expected) => {
    if (ctx.bl1267Decision.decision !== expected) {
      throw new Error(
        `expected ${expected}, got ${ctx.bl1267Decision.decision} (${ctx.bl1267Decision.reason || 'no reason'})`
      );
    }
  });

  scoped(/^the allow names the adjudication record$/, (ctx) => {
    const reason = ctx.bl1267Decision.reason || '';
    if (!reason.includes(ctx.bl1267Record.path)) {
      throw new Error(`the allow does not name the record it came from: ${reason || '(no reason at all)'}`);
    }
    if (!reason.includes('specifier')) {
      throw new Error(`the allow does not name who adjudicated: ${reason}`);
    }
  });

  scoped(/^the reason names the adjudication as no longer matching the ticket$/, (ctx) => {
    const reason = ctx.bl1267Decision.reason || '';
    if (!/no longer matches the ticket content/.test(reason) || !reason.includes(ctx.bl1267Record.path)) {
      throw new Error(`the reason does not name the stale adjudication: ${reason}`);
    }
  });

  scoped(/^the reason names the unusable adjudication rather than treating it as allow$/, (ctx) => {
    const reason = ctx.bl1267Decision.reason || '';
    if (!/unusable adjudication record/.test(reason) || !reason.includes(ctx.bl1267Record.path)) {
      throw new Error(`the reason does not name the unusable record: ${reason}`);
    }
  });

  scoped(/^the reason is the stale-premise reason the gate produced before this slice$/, (ctx) => {
    if (ctx.bl1267Decision.reason !== ctx.bl1267OriginalReason) {
      throw new Error(
        `the no-record path changed the reason: "${ctx.bl1267Decision.reason}" vs "${ctx.bl1267OriginalReason}"`
      );
    }
  });

  // ── 06: the real promotion script ───────────────────────────────────
  scoped(/^a fixture project root containing that paused ticket$/, (ctx) => {
    initFixtureRepo(ensureRoot(ctx));
    ctx.bl1267LiveInboxBefore = countLiveInbox();
  });

  scoped(/^the fixture ticket's adjudication record is "([a-z_]+)"$/, (ctx, adjudication) => {
    if (adjudication === 'absent') {
      return;
    }
    writerModule().recordAdjudication({
      root: ensureRoot(ctx),
      ticketId: TICKET_ID,
      outcome: adjudication,
      adjudicatedBy: 'specifier',
    });
  });

  scoped(/^promote_and_route_next\.sh is run against that fixture root for that ticket$/, (ctx) => {
    const root = ensureRoot(ctx);
    try {
      execFileSync('bash', [PROMOTE_SCRIPT, TICKET_ID, root], {
        cwd: root,
        env: { ...process.env, SWARMFORGE_ROLE: 'coordinator' },
        stdio: 'pipe',
      });
    } catch {
      // A refused promotion exits non-zero by design; the durable observable
      // this scenario asserts on is which folder the ticket ends in.
    }
  });

  scoped(/^the fixture ticket ends in "(paused|active)"$/, (ctx, folder) => {
    const root = ensureRoot(ctx);
    const other = folder === 'active' ? 'paused' : 'active';
    if (!fs.existsSync(ticketPath(root, folder))) {
      throw new Error(`the ticket is not in backlog/${folder}/ (it is ${fs.existsSync(ticketPath(root, other)) ? `still in ${other}/` : 'nowhere'})`);
    }
    if (fs.existsSync(ticketPath(root, other))) {
      throw new Error(`the ticket is in BOTH backlog/${folder}/ and backlog/${other}/`);
    }
    // The fixture's routing side effect must not have reached the live swarm.
    const after = countLiveInbox();
    if (after !== ctx.bl1267LiveInboxBefore) {
      throw new Error(
        `the fixture delivered a handoff into the live mailbox (${ctx.bl1267LiveInboxBefore} → ${after})`
      );
    }
  });
}

module.exports = { registerSteps };
