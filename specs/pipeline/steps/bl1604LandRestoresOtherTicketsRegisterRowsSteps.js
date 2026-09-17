'use strict';

// BL-1604: step handlers for "a land never carries another ticket's
// register row removal". Scenario 01 drives the REAL
// swarmforge/scripts/land_step_lib.bb's land-plan/replay! (never a
// reimplementation of the restore decision) through a real git fixture -
// never the land_step_cli.bb wrapper, since the assertions need the
// structured :register-restored report and the replayed tree's raw
// content, which the CLI only prints as text lines. Scenario 02 (an
// unreadable registry) has no real git failure this fixture can construct
// without corrupting the repository, so it drives
// land-step-lib/restore-registry-rows! directly with an injected reader
// returning nil - the same convention BL-1481's own unreadable scenario
// already uses (ownPathsWithUnreadableContentCheck).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1604 A land never carries another ticket's register row removal";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9604';
const OTHER_OPEN = 'BL-9605';
const CLOSED = 'BL-9606';
const UNLANDED_SIBLING = 'BL-9608';

const STANDING_REDS = 'backlog/standing-reds.tsv';
const ALLOWLIST = 'swarmforge/scripts/property_suite_standing_allowlist.tsv';

// Which registry row each owner role names, per registry - the file
// column identity and the ticket id restoration must name.
const ROW_FOR = {
  [STANDING_REDS]: {
    'the landing ticket': { file: 'some/file/a.js', owner: LANDING },
    'the other open ticket': { file: 'some/file/b.js', owner: OTHER_OPEN },
    'the closed ticket': { file: 'some/file/c.js', owner: CLOSED },
  },
  [ALLOWLIST]: {
    'the landing ticket': { file: 'some/prop-a.test.js', owner: LANDING },
    'the other open ticket': { file: 'some/prop-b.test.js', owner: OTHER_OPEN },
    'the closed ticket': { file: 'some/prop-c.test.js', owner: CLOSED },
  },
};

function standingRedsText(rows) {
  const lines = rows.map((r) => `unit\t${r.file}\t${r.owner}\t2026-09-16\tfixture row`);
  return `# fixture header\n${lines.join('\n')}\n`;
}

function allowlistText(rows) {
  const lines = rows.map((r) => `${r.file}\tallowlist\tflaky under load; owner ${r.owner}`);
  return `file\tdisposition\trationale\n${lines.join('\n')}\n`;
}

function registryText(registry, rows) {
  return registry === STANDING_REDS ? standingRedsText(rows) : allowlistText(rows);
}

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

function writeTicket(root, id, folder) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n`);
}

function bb(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop();
}

function landPlan(root, commit) {
  const expr = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/land-plan {:root "${root}" :commit "${commit}" :task-ticket-id "${LANDING}"})))`;
  return JSON.parse(bb(expr));
}

function restoreWithUnreadableOrigin(root, originMain) {
  const expr = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/restore-registry-rows!
    {:root "${root}" :tree-root "${root}" :origin-main "${originMain}" :landing-id "${LANDING}"}
    (fn [_ _] nil)
    (fn [_] ""))))`;
  return JSON.parse(bb(expr));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository under a scratch root with its own origin, a landing ticket and a registry file on origin\/main carrying rows owned by the landing ticket, by another open ticket and by a closed ticket$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1604-fixture-');
      fixtureRoots.push(root);
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      writeTicket(root, LANDING, 'active');
      writeTicket(root, OTHER_OPEN, 'active');
      writeTicket(root, CLOSED, path.join('done', 'M8'));
      const standingRows = [
        ROW_FOR[STANDING_REDS]['the landing ticket'],
        ROW_FOR[STANDING_REDS]['the other open ticket'],
        ROW_FOR[STANDING_REDS]['the closed ticket'],
      ];
      const allowlistRows = [
        ROW_FOR[ALLOWLIST]['the landing ticket'],
        ROW_FOR[ALLOWLIST]['the other open ticket'],
        ROW_FOR[ALLOWLIST]['the closed ticket'],
      ];
      commitFile(root, STANDING_REDS, standingRedsText(standingRows), 'seed the standing-red register');
      commitFile(root, ALLOWLIST, allowlistText(allowlistRows), 'seed the property-suite allowlist');
      markOriginMain(root);
      // An entangled, unlanded sibling - required for land-plan to choose
      // :replay at all. Shares no path with the landing ticket, so it
      // rides only as an excluded sibling, never a passenger.
      commitFile(root, 'sibling-only.txt', 'sib\n', `${UNLANDED_SIBLING}: sibling unlanded work`);
      ctx.root = root;
      ctx.standingRows = standingRows;
      ctx.allowlistRows = allowlistRows;
    },
  );

  scoped(/^the landing ticket's tip lacks the (\S+) row owned by (.+)$/, (ctx, registryPath, ownerPhrase) => {
    const allRows = registryPath === STANDING_REDS ? ctx.standingRows : ctx.allowlistRows;
    const missing = ROW_FOR[registryPath][ownerPhrase];
    assert.ok(missing, `unknown owner phrase: ${ownerPhrase}`);
    const remaining = allRows.filter((r) => r.file !== missing.file);
    // The landing ticket's own two commits: its own ticket file (an
    // own-path unrelated to the registry), then the registry rewrite that
    // - for whatever branch-local reason, never assumed deliberate - lacks
    // exactly the named row. Both tagged with the landing ticket's own id
    // so task-tagged-changed-paths attributes both paths to it.
    commitFile(ctx.root, path.join('backlog', 'active', `${LANDING}-own.yaml`), `id: ${LANDING}\n`, `${LANDING}: own ticket file`);
    commitFile(ctx.root, registryPath, registryText(registryPath, remaining), `${LANDING}: rewrite ${registryPath}`);
    ctx.tip = head(ctx.root);
    ctx.ownerPhrase = ownerPhrase;
  });

  scoped(/^the land plan is computed and the replay is built for the landing ticket$/, (ctx) => {
    ctx.plan = landPlan(ctx.root, ctx.tip);
  });

  scoped(/^the replayed (\S+) (.+)$/, (ctx, registryPath, outcome) => {
    assert.equal(ctx.plan.action, 'replay', `expected a replay, got: ${JSON.stringify(ctx.plan)}`);
    const row = ROW_FOR[registryPath][ctx.ownerPhrase];
    const tipText = execFileSync('git', ['show', `${ctx.plan.commit}:${registryPath}`], {
      cwd: ctx.root,
      encoding: 'utf8',
    });
    const reportLine = `REGISTER_ROW_RESTORED ${registryPath} ${row.file} ${row.owner}`;
    if (outcome === 'carries that row again and the report prints REGISTER_ROW_RESTORED for it') {
      assert.ok(tipText.includes(row.file), `expected the replayed ${registryPath} to carry ${row.file} back`);
      assert.ok(
        (ctx.plan['register-restored'] || []).includes(reportLine),
        `expected REGISTER_ROW_RESTORED for ${row.file}, got: ${JSON.stringify(ctx.plan['register-restored'])}`,
      );
    } else if (outcome === 'lacks that row and the report prints no REGISTER_ROW_RESTORED') {
      assert.ok(!tipText.includes(row.file), `expected the replayed ${registryPath} to still lack ${row.file}`);
      assert.ok(
        !(ctx.plan['register-restored'] || []).includes(reportLine),
        `expected no REGISTER_ROW_RESTORED for ${row.file}, got: ${JSON.stringify(ctx.plan['register-restored'])}`,
      );
    } else {
      assert.fail(`unknown outcome text: ${outcome}`);
    }
  });

  scoped(/^the registry file on origin\/main cannot be read as rows$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1604-unreadable-');
    fixtureRoots.push(root);
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    writeTicket(root, LANDING, 'active');
    commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
    const originMain = head(root);
    markOriginMain(root);
    ctx.root = root;
    ctx.originMain = originMain;
  });

  scoped(/^the landing ticket's land is attempted$/, (ctx) => {
    ctx.restoreResult = restoreWithUnreadableOrigin(ctx.root, ctx.originMain);
  });

  scoped(/^the attempt is refused with a reason naming the registry file$/, (ctx) => {
    assert.equal(ctx.restoreResult.success, false, `expected a refusal, got: ${JSON.stringify(ctx.restoreResult)}`);
    assert.ok(
      ctx.restoreResult.reason.includes(STANDING_REDS),
      `expected the reason to name the registry file, got: ${ctx.restoreResult.reason}`,
    );
  });
}

module.exports = { registerSteps };
