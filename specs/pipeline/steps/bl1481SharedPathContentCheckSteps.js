'use strict';

// BL-1481: step handlers for "a shared path blocks a land only when the
// sibling's lines are not yet on main". Drives the REAL
// swarmforge/scripts/land_step_cli.bb - never a reimplementation of the
// decision - for the three scenarios a real git fixture can produce.
// Scenario 04 (an unreadable content attribution) has no real git failure
// this fixture can construct without corrupting the repository, so it
// drives land_step_lib.bb's own `own-paths` directly with an injected
// `:content-blocked-fn` returning nil - the same injection convention
// BL-1332/03 and BL-1375/05 already use for their own unreadable rows.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = "BL-1481 A shared path blocks a land only when the sibling's lines are not yet on main";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9481';
const SIBLING = 'BL-9482';
const SHARED_PATH = 'shared.txt';
const OTHER_PATH = 'other.txt';

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkTmpDir(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

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

function bb(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop();
}

// Drives own-paths directly with a content-blocked-fn injected to fail -
// no real git state constructs an unreadable content attribution without
// corrupting the repository, so this proves the fail-closed WIRING (own-
// paths refuses, naming the path, when the content check cannot answer)
// rather than a specific git-level cause.
function ownPathsWithUnreadableContentCheck(root, commit) {
  const expr = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/own-paths "${root}" "${commit}" "${LANDING}" #{"${SIBLING}"} nil nil
    {:content-blocked-fn (fn [_ _] nil)})))`;
  return JSON.parse(bb(expr));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository under a scratch root with its own origin, a lander ticket and a bounced sibling that both touched one path$/,
    (ctx) => {
      const root = mkTmpDir('bl1481-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');
      writeTicket(root, SIBLING, 'human_approval: approved\n');
      ctx.root = root;
    },
  );

  scoped(
    /^the sibling's lines in the shared path are present on origin\/main and the tip adds only the lander's lines$/,
    (ctx) => {
      const root = ctx.root;
      commitFile(root, SHARED_PATH, 'base\n', 'seed the shared file');
      markOriginMain(root);
      commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: sibling adds its line`);
      const preTip = head(root);
      // Also touches an unrelated path that never lands, so the sibling
      // stays genuinely unlanded OVERALL (BL-1389's own ticket-level
      // landed/unlanded split) - the point under test is ONE shared path
      // whose content clears, not the whole sibling.
      commitFile(root, OTHER_PATH, 'never landed\n', `${SIBLING}: touches an unrelated path that never lands`);
      // A separate branch off origin/main lands the SAME content under a
      // DIFFERENT sha (the BL-1446 replay shape) - origin/main advances to
      // it, while the sibling's ORIGINAL commit stays reachable only from
      // the tip built below.
      git(root, 'checkout', '-q', '-b', 'replay-landed', git(root, 'rev-parse', 'refs/remotes/origin/main'));
      commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: replayed tip-pure`);
      markOriginMain(root);
      git(root, 'checkout', '-q', 'main');
      commitFile(root, SHARED_PATH, 'base\nsibling line\nlander line\n', `${LANDING}: the lander adds its own line`);
      writeBounce(root, SIBLING, preTip, '2026-09-07T11:48:00.000Z');
      ctx.tip = head(root);
    },
  );

  scoped(
    /^the shared path in the tip carries a line the bounced sibling added that origin\/main lacks$/,
    (ctx) => {
      const root = ctx.root;
      commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
      markOriginMain(root);
      commitFile(root, SHARED_PATH, 'base\n', `${LANDING}: lander seeds the shared file`);
      commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: sibling adds a line only it owns`);
      const siblingCommit = head(root);
      writeBounce(root, SIBLING, siblingCommit, '2026-09-07T11:48:00.000Z');
      ctx.tip = siblingCommit;
    },
  );

  scoped(
    /^the shared path in the tip lacks a line origin\/main has because the bounced sibling deleted it$/,
    (ctx) => {
      const root = ctx.root;
      commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: sibling adds its line`);
      markOriginMain(root);
      commitFile(root, SHARED_PATH, 'base\n', `${SIBLING}: sibling deletes its own line`);
      const siblingRemoveCommit = head(root);
      commitFile(root, SHARED_PATH, 'base\nlander line\n', `${LANDING}: the lander adds its own line`);
      writeBounce(root, SIBLING, siblingRemoveCommit, '2026-09-07T11:48:00.000Z');
      ctx.tip = head(root);
    },
  );

  scoped(/^the blame of a changed line in the shared path cannot be read$/, (ctx) => {
    const root = ctx.root;
    commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
    markOriginMain(root);
    commitFile(root, SHARED_PATH, 'base\n', `${LANDING}: lander seeds the shared file`);
    commitFile(root, SHARED_PATH, 'base\nsibling line\n', `${SIBLING}: sibling adds a line only it owns`);
    const siblingCommit = head(root);
    writeBounce(root, SIBLING, siblingCommit, '2026-09-07T11:48:00.000Z');
    ctx.tip = siblingCommit;
    ctx.forceUnreadable = true;
  });

  scoped(/^the land plan is computed for the lander$/, (ctx) => {
    if (ctx.forceUnreadable) {
      ctx.ownPaths = ownPathsWithUnreadableContentCheck(ctx.root, ctx.tip);
    } else {
      ctx.cli = runCli(ctx.root, ctx.tip);
    }
  });

  scoped(/^the plan is a replay that includes the shared path$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected a clean replay (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
  });

  scoped(/^the report names the sibling as content-clear for that path$/, (ctx) => {
    assert.ok(
      ctx.cli.stdout.includes(`CONTENT_CLEAR_SIBLING_PATH ${SHARED_PATH} ${SIBLING}`),
      `expected a content-clear report line, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(/^the plan is a refusal naming the path, the sibling and its bounce$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SHARED_PATH), `reason does not name the path: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the sibling: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes('bounced'), `reason does not name the bounce: ${ctx.cli.stdout}`);
  });

  scoped(/^the plan is a refusal naming the path and the unreadable attribution$/, (ctx) => {
    assert.equal(ctx.ownPaths.paths, null, `expected a refusal, got: ${JSON.stringify(ctx.ownPaths)}`);
    assert.ok(ctx.ownPaths.warning.includes(SHARED_PATH), `refusal does not name the path: ${ctx.ownPaths.warning}`);
    assert.ok(
      ctx.ownPaths.warning.includes('unreadable'),
      `refusal does not name the unreadable attribution: ${ctx.ownPaths.warning}`,
    );
  });
}

module.exports = { registerSteps };
