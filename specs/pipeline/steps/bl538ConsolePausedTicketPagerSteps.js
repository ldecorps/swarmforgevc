'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installPromotionGates } = require('./lib/promotionGatesFixture');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

// BL-1685: the path only - bridgeServer.js is the whole bridge graph (286
// modules: bridge/metrics/swarm under extension/out plus @connectrpc/
// @bufbuild/@cursor), so a mere require() of this file never pays for it -
// the actual require happens inside the step that starts a bridge (the
// same pattern BL-1658 used for jsdom above and for the fifteen
// cursor-bridge handlers).
function getStartBridge() {
  return require('../../../extension/out/bridge/bridgeServer').startBridge;
}

const FEATURE = 'paused-ticket pager on the SwarmForge Telegram Mini App console';
const TOKEN = 'paused-pager-token';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// BL-1693: scenarios 07/08's Approve route commits its human_approval flip
// durably through the REAL commit_integrity_cli.bb (BL-892) - a target
// that is not a real git repo with the CLI present reports the commit as
// (correctly) failed, same posture pausedPagerBridge.test.js's own
// mkGitTmpWithCli() and bl1368ApprovalCommitNamesDeciderSteps.js's
// installCommitIntegrity/makeRoot already take. Derived from the CLI's own
// load-file closure, never a hand-listed copy.
function installCommitIntegrity(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of computeClosure(REAL_SCRIPTS_DIR, 'commit_integrity_cli.bb')) {
    const src = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
  }
}

function mkFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl538-')));
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  // BL-1693: scenario 06's Expedite consults the real
  // promotion_gates_cli.bb (BL-1083, promoteToActive fails closed without
  // it, exactly as bl1425QueueJumpPastCapSteps.js's own fixture stages it);
  // scenarios 07/08's Approve needs the real commit_integrity_cli.bb and a
  // real git repo to durably commit, never a fabricated verdict.
  installPromotionGates(root);
  installCommitIntegrity(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  return root;
}

function writeTicket(root, folder, id, title, priority, extra) {
  const lines = [`id: ${id}`, `title: ${title}`, `status: ${folder}`];
  if (priority !== undefined) {
    lines.push(`priority: ${priority}`);
  }
  if (extra) {
    lines.push(...Object.entries(extra).map(([key, value]) => `${key}: ${value}`));
  }
  const file = path.join(root, 'backlog', folder, `${id}.yaml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

async function withBridge(ctx, fn) {
  const handle = await getStartBridge()(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {});
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function fetchPager(ctx) {
  await withBridge(ctx, async (handle) => {
    const base = `http://127.0.0.1:${handle.port}`;
    const htmlRes = await fetch(`${base}/paused-pager`);
    assert.equal(htmlRes.status, 200);
    ctx.html = await htmlRes.text();
    const stateRes = await fetch(`${base}/paused-pager-state?token=${TOKEN}`);
    assert.equal(stateRes.status, 200);
    ctx.state = await stateRes.json();
    ctx.index = Math.min(ctx.index ?? 0, Math.max(0, ctx.state.items.length - 1));
  });
}

function currentItem(ctx) {
  return ctx.state.items[ctx.index ?? 0];
}

function pausedPath(ctx, id) {
  return path.join(ctx.root, 'backlog', 'paused', `${id}.yaml`);
}

function activePath(ctx, id) {
  return path.join(ctx.root, 'backlog', 'active', `${id}.yaml`);
}

function registerSteps(registry) {
  registry.defineScoped(/^the SwarmForge bridge Mini App is reachable with my allowlisted console token$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.index = 0;
  }, FEATURE);

  registry.defineScoped(/^the console menu at \/console is available$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /paused/i);
    });
  }, FEATURE);

  registry.defineScoped(/^at least one ticket exists under backlog\/paused\/$/, (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'paused', 'BL-900', 'Review paused pager', 4);
  }, FEATURE);

  registry.defineScoped(/^backlog\/paused\/ has no tickets$/, () => {}, FEATURE);

  registry.defineScoped(/^two or more tickets exist under backlog\/paused\/$/, (ctx) => {
    writeTicket(ctx.root, 'paused', 'BL-901', 'Second paused ticket', 5);
    writeTicket(ctx.root, 'paused', 'BL-800', 'First paused ticket', 1);
  }, FEATURE);

  registry.defineScoped(/^I am viewing the first paused ticket on the pager$/, async (ctx) => {
    ctx.index = 0;
    await fetchPager(ctx);
    ctx.originalId = currentItem(ctx).id;
  }, FEATURE);

  registry.defineScoped(/^I am viewing the last paused ticket on the pager$/, async (ctx) => {
    writeTicket(ctx.root, 'paused', 'BL-901', 'Second paused ticket', 5);
    writeTicket(ctx.root, 'paused', 'BL-800', 'First paused ticket', 1);
    await fetchPager(ctx);
    ctx.index = ctx.state.items.length - 1;
    ctx.originalId = currentItem(ctx).id;
  }, FEATURE);

  registry.defineScoped(/^a paused ticket is shown on the pager$/, async (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'paused', 'BL-902', 'Expedite me', 8);
    await fetchPager(ctx);
    ctx.originalYaml = fs.readFileSync(pausedPath(ctx, currentItem(ctx).id), 'utf8');
  }, FEATURE);

  registry.defineScoped(/^I open the paused-ticket pager from the console menu$/, fetchPager, FEATURE);
  registry.defineScoped(/^I open the paused-ticket pager$/, fetchPager, FEATURE);

  registry.defineScoped(/^the page shows that ticket's id and title at the top$/, (ctx) => {
    const item = currentItem(ctx);
    assert.equal(item.id, 'BL-900');
    assert.equal(item.title, 'Review paused pager');
  }, FEATURE);

  registry.defineScoped(/^shows the ticket YAML in the middle$/, (ctx) => {
    assert.match(currentItem(ctx).yaml, /id: BL-900/);
    assert.match(currentItem(ctx).yaml, /title: Review paused pager/);
  }, FEATURE);

  registry.defineScoped(/^shows a "Set highest priority, expedite" control at the bottom$/, (ctx) => {
    assert.match(ctx.html, /Set highest priority, expedite/);
    assert.equal(currentItem(ctx).canExpedite, true);
  }, FEATURE);

  registry.defineScoped(/^I see a clear empty state and no Expedite control$/, (ctx) => {
    assert.equal(ctx.state.total, 0);
    assert.deepEqual(ctx.state.items, []);
    assert.match(ctx.html, /No paused tickets\./);
  }, FEATURE);

  registry.defineScoped(/^I go to the next paused ticket$/, (ctx) => {
    ctx.index = Math.min((ctx.index ?? 0) + 1, ctx.state.items.length - 1);
  }, FEATURE);

  registry.defineScoped(/^a different paused ticket is shown with id and title at the top, YAML in the middle, and Expedite at the bottom$/, (ctx) => {
    const item = currentItem(ctx);
    assert.notEqual(item.id, ctx.originalId);
    assert.ok(item.title);
    assert.match(item.yaml, new RegExp(`id: ${item.id}`));
    assert.equal(item.canExpedite, true);
  }, FEATURE);

  registry.defineScoped(/^the tickets are ordered by priority ascending then id ascending$/, (ctx) => {
    assert.deepEqual(ctx.state.items.map((item) => item.id), ['BL-800', 'BL-901']);
  }, FEATURE);

  registry.defineScoped(/^I try to go to the next paused ticket$/, (ctx) => {
    ctx.index = Math.min((ctx.index ?? 0) + 1, ctx.state.items.length - 1);
  }, FEATURE);

  registry.defineScoped(/^the same ticket remains visible$/, (ctx) => {
    assert.equal(currentItem(ctx).id, ctx.originalId);
  }, FEATURE);

  registry.defineScoped(/^when I am on the first ticket and try to go previous, the first ticket remains visible$/, (ctx) => {
    ctx.index = 0;
    const firstId = currentItem(ctx).id;
    ctx.index = Math.max(0, ctx.index - 1);
    assert.equal(currentItem(ctx).id, firstId);
  }, FEATURE);

  registry.defineScoped(/^I tap "Set highest priority, expedite"$/, (ctx) => {
    ctx.confirmPending = true;
  }, FEATURE);

  registry.defineScoped(/^I am asked to confirm and the ticket is not yet mutated$/, (ctx) => {
    assert.equal(ctx.confirmPending, true);
    const item = currentItem(ctx);
    assert.equal(fs.readFileSync(pausedPath(ctx, item.id), 'utf8'), ctx.originalYaml);
    assert.equal(fs.existsSync(activePath(ctx, item.id)), false);
  }, FEATURE);

  registry.defineScoped(/^I confirm "Set highest priority, expedite"$/, async (ctx) => {
    const item = currentItem(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/expedite`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-control-token': TOKEN,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id: item.id })
      });
      assert.equal(res.status, 200);
      ctx.expeditedId = item.id;
    });
    await fetchPager(ctx);
  }, FEATURE);

  registry.defineScoped(/^that ticket's priority becomes 0$/, (ctx) => {
    assert.match(fs.readFileSync(activePath(ctx, ctx.expeditedId), 'utf8'), /^priority:\s*0$/m);
  }, FEATURE);

  registry.defineScoped(/^the ticket is expedited onto the swarm's next-work path using the BL-490 promote\/dispatch effect$/, (ctx) => {
    assert.equal(fs.existsSync(pausedPath(ctx, ctx.expeditedId)), false);
    assert.equal(fs.existsSync(activePath(ctx, ctx.expeditedId)), true);
  }, FEATURE);

  registry.defineScoped(/^the pager advances to another paused ticket or the empty state$/, (ctx) => {
    assert.equal(ctx.state.items.some((item) => item.id === ctx.expeditedId), false);
    assert.equal(ctx.state.total, ctx.state.items.length);
  }, FEATURE);

  // ── BL-1693 (BL-538 scenarios 07/08): Approve ───────────────────────────
  registry.defineScoped(/^a paused ticket with human_approval pending is shown on the pager$/, async (ctx) => {
    ctx.ticketPath = writeTicket(ctx.root, 'paused', 'BL-903', 'Approve me', 3, { human_approval: 'pending' });
    // A companion ticket carrying no human_approval field at all - the
    // negative half of scenario 07 ("I do not see Approve on paused
    // tickets that are not pending approval") needs a second item in the
    // SAME fetch to prove the control is per-ticket, not a global flag.
    writeTicket(ctx.root, 'paused', 'BL-904', 'Not pending approval', 9);
    await fetchPager(ctx);
    ctx.index = ctx.state.items.findIndex((item) => item.id === 'BL-903');
    assert.notEqual(ctx.index, -1, `expected BL-903 to appear in the pager state, got: ${JSON.stringify(ctx.state.items)}`);
    ctx.originalYaml = fs.readFileSync(pausedPath(ctx, 'BL-903'), 'utf8');
  }, FEATURE);

  registry.defineScoped(/^I see an Approve control$/, (ctx) => {
    assert.equal(currentItem(ctx).canApprove, true, `expected canApprove on the pending-approval ticket, got: ${JSON.stringify(currentItem(ctx))}`);
  }, FEATURE);

  registry.defineScoped(/^I do not see Approve on paused tickets that are not pending approval$/, (ctx) => {
    const other = ctx.state.items.find((item) => item.id === 'BL-904');
    assert.ok(other, `expected BL-904 (no human_approval) in the pager state, got: ${JSON.stringify(ctx.state.items)}`);
    assert.equal(other.canApprove, false, `expected canApprove false for a ticket with no human_approval, got: ${JSON.stringify(other)}`);
  }, FEATURE);

  registry.defineScoped(/^I confirm Approve$/, async (ctx) => {
    const item = currentItem(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/paused-pager/approve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-control-token': TOKEN,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id: item.id })
      });
      const body = await res.json();
      assert.equal(res.status, 200, `expected a durable Approve to succeed, got ${res.status}: ${JSON.stringify(body)}`);
      assert.equal(body.success, true, `expected success, got: ${JSON.stringify(body)}`);
      ctx.approvedId = item.id;
    });
    await fetchPager(ctx);
    ctx.index = ctx.state.items.findIndex((i) => i.id === ctx.approvedId);
  }, FEATURE);

  registry.defineScoped(/^that ticket's human_approval becomes approved$/, (ctx) => {
    assert.match(fs.readFileSync(pausedPath(ctx, ctx.approvedId), 'utf8'), /^human_approval:\s*approved$/m);
    // BL-892 invariant 1: HEAD, not only the working tree, is the source
    // of truth - the same distinction pausedPagerBridge.test.js's own
    // Approve test asserts.
    const headYaml = git(ctx.root, 'show', `HEAD:backlog/paused/${ctx.approvedId}.yaml`);
    assert.match(headYaml, /^human_approval:\s*approved$/m, 'expected the Approve route to commit the flip to HEAD, not just the working tree');
  }, FEATURE);

  registry.defineScoped(/^the ticket remains under backlog\/paused\/$/, (ctx) => {
    assert.equal(fs.existsSync(pausedPath(ctx, ctx.approvedId)), true);
    assert.equal(fs.existsSync(activePath(ctx, ctx.approvedId)), false);
  }, FEATURE);

  registry.defineScoped(/^the pager refreshes to show the updated YAML$/, (ctx) => {
    const item = currentItem(ctx);
    assert.notEqual(item, undefined, `expected ${ctx.approvedId} still in the pager state, got: ${JSON.stringify(ctx.state.items)}`);
    assert.match(item.yaml, /^human_approval:\s*approved$/m);
    assert.notEqual(item.yaml, ctx.originalYaml, 'expected the pager to show the updated YAML, not the pre-Approve text');
  }, FEATURE);
}

module.exports = { registerSteps };
