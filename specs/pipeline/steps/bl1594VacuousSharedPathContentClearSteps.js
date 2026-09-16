'use strict';

// BL-1594: step handlers for "a fully reverted sibling edit on a shared
// path is content-clear". Drives the REAL swarmforge/scripts/land_step_cli.bb
// for scenario 01 (a real git fixture the way bl1481SharedPathContentCheckSteps.js
// builds one), and land_step_lib.bb's path-content-blocked-ids/landed-siblings
// directly for scenarios 02/03 (pure injection - the BL-1481/04 convention -
// and a real self-reverting git history respectively) - never a
// reimplementation of the decision.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1594 A fully reverted sibling edit on a shared path is content-clear';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9501';
const SIBLING = 'BL-9502';
const SHARED_PATH = 'shared.txt';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function writeTicket(root, id, extraYaml) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n${extraYaml || ''}`);
}

function writeBounce(root, ticket, commit, at) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, '2026-09.jsonl'),
    JSON.stringify({ ticket, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit, by: 'QA', at }) + '\n',
  );
}

function runCli(root, commit) {
  const r = spawnSync('bb', [CLI, `${LANDING}-fixture`, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function bbEval(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop();
}

function bbJson(expr) {
  const r = spawnSync('bb', ['-e', `(require '[cheshire.core :as json])\n${expr}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// Given <restored>, how many of the sibling's three removed rows the
// lander's own commit restores - the ONLY two shapes the ticket's own
// Examples table names (BL-654/engineering: an explicit KNOWN_VALUES
// lookup, never a passthrough of the narrative text).
const RESTORE_COUNTS = { 'every one': 3, 'all but one': 2 };

function restoreCount(token) {
  if (!Object.prototype.hasOwnProperty.call(RESTORE_COUNTS, token)) {
    throw new Error(`unknown <restored> token: "${token}"`);
  }
  return RESTORE_COUNTS[token];
}

// <verdict> -> the injected per-id line-change this scenario needs
// path-content-blocked-ids to see, against a fixed real git fixture
// (origin-main "base\n", tip "base\nextra\n" - the lander's own line).
// "unreadable" is special-cased below (lines-fn returns nil, never a
// changes map).
const VERDICT_CHANGES = {
  landed: { added: ['base'], removed: [] },
  vacuous: { added: ['reverted-line'], removed: [] },
  unlanded: { added: ['extra'], removed: [] },
};

const VERDICT_OUTCOME_CHECKS = {
  'is cleared': (blocked) => assert.equal(blocked.has('CO_OWNER'), false, `expected CO_OWNER cleared, blocked: ${JSON.stringify([...blocked])}`),
  'still blocks': (blocked) => assert.equal(blocked.has('CO_OWNER'), true, `expected CO_OWNER blocking, blocked: ${JSON.stringify([...blocked])}`),
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository under a scratch root with its own origin, a lander ticket and a bounced sibling that both touched one path$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1594-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      writeTicket(root, SIBLING, 'human_approval: approved\n');
      ctx.root = root;
    },
  );

  // -- Scenario 01 (Outline) -------------------------------------------
  scoped(
    /^the bounced sibling's commit removed lines from the shared path that origin\/main has and a later lander commit restored (.+) of them and changed only the lander's own line$/,
    (ctx, token) => {
      const root = ctx.root;
      const rowsToRestore = restoreCount(token);
      commitFile(root, SHARED_PATH, 'anchor\nrow1\nrow2\nrow3\n', 'seed the shared file');
      markOriginMain(root);
      commitFile(root, SHARED_PATH, 'anchor\n', `${SIBLING}: sibling removes every row`);
      const siblingCommit = head(root);
      const rows = ['row1', 'row2', 'row3'].slice(0, rowsToRestore);
      const restored = ['anchor', ...rows, 'lander line'].join('\n') + '\n';
      commitFile(root, SHARED_PATH, restored, `${LANDING}: the lander restores ${rowsToRestore} row(s) and adds its own line`);
      writeBounce(root, SIBLING, siblingCommit, '2026-09-16T00:00:00.000Z');
      ctx.tip = head(root);
    },
  );

  scoped(/^the land plan is computed for the lander$/, (ctx) => {
    ctx.cli = runCli(ctx.root, ctx.tip);
  });

  scoped(
    /^the plan is a replay that includes the shared path and names the sibling content-clear by reversion$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 0, `expected a clean replay (exit 0), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
      assert.ok(
        ctx.cli.stdout.includes(`CONTENT_CLEAR_SIBLING_PATH ${SHARED_PATH} ${SIBLING} reverted`),
        `expected a content-clear-by-reversion report line, got: ${ctx.cli.stdout}`,
      );
    },
  );

  scoped(/^the plan is a refusal naming the path, the sibling and its bounce$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SHARED_PATH), `reason does not name the path: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the sibling: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes('bounced'), `reason does not name the bounce: ${ctx.cli.stdout}`);
  });

  // -- Scenario 02 (Outline) -------------------------------------------
  scoped(
    /^the content check is asked about a blocking co-owner whose verdict on the shared path is (\w+)$/,
    (ctx, verdict) => {
      const root = mkSocketFixtureRoot('bl1594-verdict-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      commitFile(root, SHARED_PATH, 'base\n', 'seed');
      markOriginMain(root);
      commitFile(root, SHARED_PATH, 'base\nextra\n', `${LANDING}: the lander's own line`);
      ctx.verdictRoot = root;
      ctx.verdictCommit = head(root);
      ctx.verdictOriginMain = git(root, 'rev-parse', 'refs/remotes/origin/main');
      ctx.verdictToken = verdict;
    },
  );

  scoped(/^the still-blocking co-owners of that path are computed$/, (ctx) => {
    const { verdictRoot: root, verdictCommit: commit, verdictOriginMain: originMain, verdictToken: token } = ctx;
    if (token === 'unreadable') {
      const expr = `
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  {:blocked (land-step-lib/path-content-blocked-ids "${root}" "${originMain}" "${commit}" "${SHARED_PATH}" #{"CO_OWNER"} (fn [_] nil))}))`;
      const { blocked } = bbJson(expr);
      ctx.blockedIds = blocked === null ? null : new Set(blocked);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(VERDICT_CHANGES, token)) {
      throw new Error(`unknown <verdict> token: "${token}"`);
    }
    const { added, removed } = VERDICT_CHANGES[token];
    const linesFnEdn = `{"CO_OWNER" {"${SHARED_PATH}" {:added #{${added.map((a) => `"${a}"`).join(' ')}} :removed #{${removed.map((r) => `"${r}"`).join(' ')}}}}}`;
    const expr = `
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  {:blocked (land-step-lib/path-content-blocked-ids "${root}" "${originMain}" "${commit}" "${SHARED_PATH}" #{"CO_OWNER"} ${linesFnEdn})}))`;
    const { blocked } = bbJson(expr);
    ctx.blockedIds = new Set(blocked);
  });

  scoped(/^the co-owner (is cleared|still blocks)$/, (ctx, outcome) => {
    VERDICT_OUTCOME_CHECKS[outcome](ctx.blockedIds || new Set());
  });

  scoped(/^the co-owner still blocks, the check failing closed$/, (ctx) => {
    assert.equal(ctx.blockedIds, null, `expected a nil (fail-closed) result, got: ${JSON.stringify([...(ctx.blockedIds || [])])}`);
  });

  // -- Scenario 03 ----------------------------------------------------
  scoped(/^a sibling whose every attributed path is vacuous at the tip$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1594-landed-siblings-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    commitFile(root, SHARED_PATH, 'base\n', 'seed');
    markOriginMain(root);
    commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: sibling adds its line`);
    commitFile(root, SHARED_PATH, 'base\n', `${SIBLING}: sibling removes its own line again`);
    commitFile(root, 'own.txt', 'own line\n', `${LANDING}: own work`);
    ctx.landedRoot = root;
    ctx.landedCommit = head(root);
    ctx.landedOriginMain = git(root, 'rev-parse', 'refs/remotes/origin/main');
  });

  scoped(/^the landed siblings are computed$/, (ctx) => {
    const { landedRoot: root, landedCommit: commit, landedOriginMain: originMain } = ctx;
    const expr = `
(require '[babashka.process :as process] '[clojure.string :as str])
(load-file "${LAND_STEP_LIB}")
(let [cands (str/split-lines (:out (process/sh {:dir "${root}"} "git" "rev-list" (str "${originMain}" ".." "${commit}"))))]
  (println (json/generate-string {:landed (land-step-lib/landed-siblings "${root}" "${commit}" "${originMain}" cands #{"${SIBLING}"})})))`;
    ctx.landedResult = bbJson(expr);
  });

  scoped(/^that sibling is reported as unlanded$/, (ctx) => {
    assert.ok(
      !ctx.landedResult.landed.includes(SIBLING),
      `expected ${SIBLING} unlanded, landed-siblings reported: ${JSON.stringify(ctx.landedResult.landed)}`,
    );
  });
}

module.exports = { registerSteps };
