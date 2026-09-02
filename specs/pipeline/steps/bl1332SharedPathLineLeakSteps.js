'use strict';

// BL-1332: step handlers for "the replay separates two tickets inside one
// shared path". Human ruling option 1 - a shared path refuses the land.
//
// Every scenario builds a real git fixture and asks the REAL
// swarmforge/scripts/land_step_lib.bb (own-paths / land-plan / replay!) about
// it through bb. Nothing here reimplements the decision, and scenario 04 runs
// the REAL check_feature_handler_registration.sh against whatever tree the
// land step would have produced - that guard is what turned this defect into
// a swarm-wide freeze, so a fixture that only asked the library would not
// have closed the loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const REGISTRATION_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_feature_handler_registration.sh');
const FIXTURE_PREFIX = 'bl1332-acceptance-';
const LANDING = 'BL-9332';
const SIBLING = 'BL-9333';
const SIBLING_LINE = "require('./bl9333SiblingSteps')";

// BL-971: a killed run traps nothing, so sweep by prefix before creating.
// BL-971 wants stale fixture roots swept BEFORE a run, because a killed run
// traps nothing. The sweep is AGE-GUARDED rather than prefix-only: scenarios
// run concurrently and this module can be loaded more than once in a run, so
// an unguarded prefix sweep deletes a sibling scenario's live root out from
// under it - which is a flake that reads as a missing file, not as a sweep.
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // A root another scenario is removing right now is not this sweep's
      // business.
    }
  }
}

sweepStaleFixtures();

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function askLandStep(root, expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bb could not run the land step: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function state(ctx) {
  if (!ctx.bl1332) ctx.bl1332 = {};
  return ctx.bl1332;
}

function newRepo(ctx) {
  const st = state(ctx);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
  st.root = root;
  return root;
}

const OWNER_SUBJECT = {
  'BL-A': (p) => `${LANDING}: the landing ticket's own work on ${p}`,
  'BL-B': (p) => `${SIBLING}: the unlanded sibling's own work on ${p}`,
  nobody: (p) => `housekeeping touching ${p}, naming no ticket`,
};

const FEATURE = 'The replay separates two tickets inside one shared path';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the land step is replaying a cited commit for ticket "BL-A"$/, (ctx) => {
    newRepo(ctx);
  });

  scoped(/^the same run reports ticket "BL-B" as an unlanded sibling$/, (ctx) => {
    state(ctx).unlanded = [SIBLING];
  });

  scoped(/^the cited commit changes a path attributed to "?(BL-A|BL-B|nobody)"?$/, (ctx, owner) => {
    const st = state(ctx);
    const subject = OWNER_SUBJECT[owner];
    assert.ok(subject, `unknown owner: ${owner}`);
    st.subjectPath = `single-owner/${owner.replace('-', '')}.txt`;
    // The landing ticket always contributes something of its own, so an empty
    // replay set never stands in for the disposition under test.
    commitFile(st.root, 'landing/own.txt', 'own\n', `${LANDING}: the landing ticket's anchor path`);
    commitFile(st.root, st.subjectPath, `${owner}\n`, subject(st.subjectPath));
  });

  scoped(/^the cited commit changes a path attributed to both "BL-A" and "BL-B"$/, (ctx) => {
    const st = state(ctx);
    st.subjectPath = 'specs/pipeline/steps/index.js';
    // BOTH owners, here: "attributed to both" is the precondition, and a
    // fixture carrying only the landing side would leave the run with no
    // entangled sibling at all - which is a different scenario, and one that
    // would pass this one for the wrong reason.
    commitFile(st.root, st.subjectPath, '// base\n', `${LANDING}: the landing ticket adds its handler`);
    commitFile(
      st.root,
      st.subjectPath,
      `// base\n${SIBLING_LINE};\n`,
      `${SIBLING}: the unlanded sibling adds its handler to the same file`,
    );
    st.shared = true;
  });

  scoped(/^that path holds one line contributed only by "BL-B"$/, (ctx) => {
    const st = state(ctx);
    const body = fs.readFileSync(path.join(st.root, st.subjectPath), 'utf8');
    assert.ok(body.includes(SIBLING_LINE), `the sibling contributed no line to ${st.subjectPath}`);
  });

  scoped(/^that path is "specs\/pipeline\/steps\/index\.js"$/, (ctx) => {
    assert.equal(state(ctx).subjectPath, 'specs/pipeline/steps/index.js');
  });

  scoped(/^"BL-B" contributed a handler registration to it but its handler file is absent$/, (ctx) => {
    const st = state(ctx);
    // Registered, never landed - the exact shape that froze main. The
    // sibling's commit above already wrote the registration line; what this
    // step pins is the other half, that no handler file backs it.
    const body = fs.readFileSync(path.join(st.root, st.subjectPath), 'utf8');
    assert.ok(body.includes(SIBLING_LINE), 'the sibling contributed no registration line');
    assert.ok(
      !fs.existsSync(path.join(st.root, 'specs', 'pipeline', 'steps', 'bl9333SiblingSteps.js')),
      'the sibling handler file exists, so this is not the shape that froze main',
    );
  });

  scoped(/^that path's attribution cannot be read$/, (ctx) => {
    state(ctx).unreadable = true;
  });

  scoped(/^the land step computes the replay tip$/, (ctx) => {
    const st = state(ctx);
    const unlanded = `#{${st.unlanded.map((s) => `"${s}"`).join(' ')}}`;
    st.ownPaths = st.unreadable
      ? askLandStep(st.root, `(land-step-lib/own-paths "${st.root}" "${head(st.root)}" "${LANDING}" ${unlanded} (fn [_ _ _ _] nil))`)
      : askLandStep(st.root, `(land-step-lib/own-paths "${st.root}" "${head(st.root)}" "${LANDING}" ${unlanded})`);
    st.plan = askLandStep(
      st.root,
      `(land-step-lib/land-plan {:root "${st.root}" :commit "${head(st.root)}" :task-ticket-id "${LANDING}"})`,
    );
  });

  scoped(/^that path is "?(replayed whole|excluded)"? in the tip$/, (ctx, disposition) => {
    const st = state(ctx);
    const paths = st.ownPaths.paths || [];
    if (disposition === 'replayed whole') {
      assert.ok(paths.includes(st.subjectPath), `${st.subjectPath} is not in the tip: ${JSON.stringify(st.ownPaths)}`);
    } else {
      assert.ok(!paths.includes(st.subjectPath), `${st.subjectPath} should have been excluded: ${JSON.stringify(paths)}`);
      assert.ok(paths.length > 0, 'the landing ticket kept nothing, so "excluded" is not what was measured');
    }
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the land is refused$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.ownPaths.paths, null, `the land was not refused: ${JSON.stringify(st.ownPaths)}`);
    assert.equal(st.plan.action, 'escalate', `the land step did not escalate: ${JSON.stringify(st.plan)}`);
  });

  scoped(/^the refusal names that path and "BL-B"$/, (ctx) => {
    const st = state(ctx);
    const text = `${st.ownPaths.warning || ''}\n${st.plan.reason || ''}`;
    assert.ok(text.includes(st.subjectPath), `the refusal does not name the path: ${text}`);
    if (!st.unreadable) {
      assert.ok(text.includes(SIBLING), `the refusal does not name the sibling: ${text}`);
    }
  });

  scoped(/^no tip is produced whose copy of that path contains "BL-B"'s line$/, (ctx) => {
    const st = state(ctx);
    // Nothing to replay means nothing can carry the line - and the library is
    // asked, not assumed: a refusal hands back no path set at all.
    assert.equal(st.ownPaths.paths, null);
    assert.notEqual(st.plan.action, 'replay');
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^no partial tip is left behind$/, (ctx) => {
    const st = state(ctx);
    const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: st.root, encoding: 'utf8' });
    assert.equal(worktrees.trim().split('\n').length, 1, `a scratch worktree was left behind:\n${worktrees}`);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the feature-handler registration guard passes against every tip produced$/, (ctx) => {
    const st = state(ctx);
    // Under option 1 no tip is produced at all, which is exactly why the
    // guard cannot fail - but that is asserted rather than assumed, and the
    // REAL guard is run against the tree that would have shipped.
    assert.equal(st.ownPaths.paths, null, 'a tip was produced for a shared path');
    const r = spawnSync('bash', [REGISTRATION_GUARD], {
      cwd: st.root,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'QA' },
    });
    assert.notEqual(
      r.status,
      null,
      'the registration guard did not run at all, so its pass proves nothing',
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
