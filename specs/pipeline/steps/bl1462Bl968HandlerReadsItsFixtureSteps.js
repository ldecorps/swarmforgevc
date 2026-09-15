'use strict';

// BL-1462: step handlers for "BL-968's acceptance handler reads its
// fixture, not the live checkout's bookkeeping or shape". Scenarios 01/03
// run BL-968's own feature end-to-end (via run_acceptance.sh, parsing its
// Node-test-runner TAP output) from the master checkout and from a linked
// role worktree respectively; scenario 02 drives the exported resolver
// (lib/ticketYamlLookup.js) directly over a fixture backlog under mkdtemp;
// scenario 04 checks the register row is gone once the fix lands.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveTicketYamlPath } = require('./lib/ticketYamlLookup');
const { masterCheckoutPath, firstLinkedWorktreePath } = require('./lib/roleWorktrees');

const FEATURE = "BL-1462 BL-968's acceptance handler reads its fixture, not the live checkout's bookkeeping or shape";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BL968_TICKET_ID = 'BL-968';
const BL968_FEATURE_REL = path.join('specs', 'features', 'BL-968-step-registry-loadable-from-materialized-tree.feature');
const BL968_FEATURE_FILE_BASENAME = 'BL-968-step-registry-loadable-from-materialized-tree.feature';

function runBl968Feature(cwd) {
  return spawnSync(path.join('specs', 'pipeline', 'scripts', 'run_acceptance.sh'), [BL968_FEATURE_REL], {
    cwd,
    encoding: 'utf8',
    timeout: 300000,
  });
}

// The generated entry point registers one Node-test-runner `test()` per
// BL-968 scenario (4, no outlines) - "ok 1..4" with no "not ok" line is
// what "all four of its scenarios pass" means for that TAP output.
function assertAllFourScenariosPass(result, whereLabel) {
  assert.ok(result, `BL-968's feature never ran from ${whereLabel}`);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const notOkLines = output.match(/^not ok .*$/gm) || [];
  assert.deepEqual(notOkLines, [], `BL-968's feature reported failing scenarios from ${whereLabel}:\n${output}`);
  const okLines = output.match(/^ok \d+ .*$/gm) || [];
  assert.equal(
    okLines.length,
    4,
    `expected all 4 of BL-968's scenarios to report ok from ${whereLabel}, got ${okLines.length}:\n${output}`
  );
  assert.equal(result.status, 0, `run_acceptance.sh exited ${result.status} from ${whereLabel}:\n${output}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── the-feature-passes-from-the-master-checkout-with-the-ticket-closed-01 ──
  scoped(/^BL-968's ticket YAML lives under backlog\/done$/, (ctx) => {
    const master = masterCheckoutPath(REPO_ROOT);
    assert.ok(master, 'no master checkout found via `git worktree list` off this repository');
    ctx.masterCheckout = master;
    const found = resolveTicketYamlPath(master, BL968_TICKET_ID);
    assert.ok(found, `${BL968_TICKET_ID}'s ticket YAML was not found anywhere under ${master}/backlog`);
    const normalized = found.split(path.sep).join('/');
    assert.match(normalized, /\/backlog\/done(\/|$)/, `expected ${BL968_TICKET_ID}'s ticket YAML under backlog/done, found it at ${found}`);
  });
  scoped(/^the BL-968 feature runs from the repository's master checkout$/, (ctx) => {
    ctx.result = runBl968Feature(ctx.masterCheckout);
    ctx.whereLabel = 'the master checkout';
  });

  // ── the-feature-still-passes-from-a-linked-role-worktree-03 ─────────────
  scoped(/^a linked role worktree of the repository exists$/, (ctx) => {
    const linked = firstLinkedWorktreePath(REPO_ROOT);
    assert.ok(linked, 'no linked role worktree found via `git worktree list` - a real swarm install is this scenario\'s premise, never a false red about the master checkout');
    ctx.linkedWorktree = linked;
  });
  scoped(/^the BL-968 feature runs from that worktree$/, (ctx) => {
    ctx.result = runBl968Feature(ctx.linkedWorktree);
    ctx.whereLabel = 'the linked role worktree';
  });

  // Shared Then, scoped to this feature, for both scenario 01 and 03.
  scoped(/^all four of its scenarios pass$/, (ctx) => {
    assertAllFourScenariosPass(ctx.result, ctx.whereLabel);
  });

  // ── the-ticket-is-found-wherever-bookkeeping-put-it-02 ──────────────────
  scoped(/^a fixture backlog carrying BL-968's ticket YAML under (.+) and nowhere else$/, (ctx, dir) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1462-ticket-lookup-'));
    ctx.__disposables = ctx.__disposables ?? [];
    ctx.__disposables.push(async () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    ctx.fixtureRoot = fixtureRoot;
    ctx.expectedDir = dir;
    const targetDir = path.join(fixtureRoot, ...dir.split('/'));
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, `${BL968_TICKET_ID}-fixture-ticket.yaml`),
      `id: ${BL968_TICKET_ID}\ntitle: "fixture ticket for BL-1462 scenario 02"\n`
    );
  });
  scoped(/^the handler resolves the ticket YAML for scenario 03 against that fixture$/, (ctx) => {
    ctx.resolvedYamlPath = resolveTicketYamlPath(ctx.fixtureRoot, BL968_TICKET_ID);
  });
  scoped(/^it resolves the file under (.+)$/, (ctx, dir) => {
    assert.ok(ctx.resolvedYamlPath, `the handler did not resolve ${BL968_TICKET_ID}'s fixture ticket YAML under ${dir}`);
    const expectedDir = path.join(ctx.fixtureRoot, ...dir.split('/'));
    assert.equal(
      path.dirname(ctx.resolvedYamlPath),
      expectedDir,
      `expected the resolved path under ${dir}, got ${ctx.resolvedYamlPath}`
    );
  });

  // ── the-register-row-leaves-with-the-fix-04 ─────────────────────────────
  scoped(/^the fix is on main$/, () => {
    // No-op precondition - the Then step below is the actual assertion.
  });
  scoped(/^backlog\/standing-reds\.tsv carries no row for BL-968's feature file$/, () => {
    const master = masterCheckoutPath(REPO_ROOT) || REPO_ROOT;
    const tsvPath = path.join(master, 'backlog', 'standing-reds.tsv');
    const content = fs.existsSync(tsvPath) ? fs.readFileSync(tsvPath, 'utf8') : '';
    const rows = content.split('\n').filter((line) => line.includes(BL968_FEATURE_FILE_BASENAME));
    assert.deepEqual(rows, [], `standing-reds.tsv still carries a row for ${BL968_TICKET_ID}'s feature file:\n${rows.join('\n')}`);
  });
}

module.exports = { registerSteps };
