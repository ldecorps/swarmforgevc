'use strict';

// BL-1375: step handlers for "approved siblings sharing a path can land".
//
// BL-1332 refused every shared path with an unlanded co-owner. That is
// circular once several APPROVED tickets share one path - each refuses
// because the others are unlanded, and no order lets any of them go first
// (four deadlocked on specs/pipeline/steps/index.js, 2026-09-03). The human
// narrowed the refusal to siblings that are withheld, awaiting approval, or
// whose approval state cannot be read, and added the rider that a passenger
// rides only if the REPLAYED TREE is self-consistent on main.
//
// Every scenario builds a real git fixture and asks the REAL
// swarmforge/scripts/land_step_lib.bb about it through bb; scenarios 06 and
// 07 go all the way through the REAL replay!, which runs the REAL
// check_feature_handler_registration.sh against the tree it built. Nothing
// here reimplements the decision - the rider exists because a guard that was
// never actually run is how BL-1324 froze main.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1375-acceptance-';
const LANDING = 'BL-9375';
const SUBJECT_SIBLING = 'BL-9376';
const CO_OWNER = 'BL-9377';
const SHARED_PATH = 'specs/pipeline/steps/index.js';
const SIBLING_HANDLER = 'specs/pipeline/steps/bl9376FixtureSteps.js';
// The sibling's contribution to the shared registry: a require line, which is
// what makes the replayed tree's self-consistency a real question rather than
// a formality (BL-1324 froze main on exactly this line, in this file).
const SIBLING_LINE = "require('./bl9376FixtureSteps')";
const REGISTRY = (lines) => `const DOMAINS = [\n${lines.map((l) => `  ${l},\n`).join('')}];\n`;

// BL-971: a killed run traps nothing, so stale roots are swept by prefix
// BEFORE the run as well as removed in a finally. The sweep is age-guarded:
// scenarios run concurrently and this module can be loaded more than once, so
// an unguarded prefix sweep would delete a sibling scenario's live root.
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
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD').trim();
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

// The ticket file the approval read consults. Written UNTRACKED and after
// origin/main is marked, so it is never itself delivered content the land
// step would have to attribute to somebody.
function writeTicket(root, folder, id, approvalLine) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n${approvalLine}`);
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
  if (!ctx.bl1375) ctx.bl1375 = {};
  return ctx.bl1375;
}

function cleanup(st) {
  if (st.root) fs.rmSync(st.root, { recursive: true, force: true });
}

const FEATURE = 'Approved siblings sharing a path can land';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^several tickets share one path and none of them has landed$/, (ctx) => {
    const st = state(ctx);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    // origin/main starts with an EMPTY but self-consistent registry: no
    // feature file, nothing required that is not there. Anything the guard
    // later refuses is therefore something the replay carried in, never
    // something main was already carrying.
    fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
    fs.writeFileSync(path.join(root, SHARED_PATH), REGISTRY([]));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'seed the step registry');
    git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
    st.root = root;
    // The landing ticket and one sibling both edit the shared path, and
    // neither has landed - the deadlock's own shape.
    commitFile(root, SHARED_PATH, REGISTRY([`// ${LANDING} line`]), `${LANDING}: the landing ticket adds its handler`);
    commitFile(
      root,
      SHARED_PATH,
      REGISTRY([`// ${LANDING} line`, SIBLING_LINE]),
      `${SUBJECT_SIBLING}: the sibling adds its handler to the same file`,
    );
    // The handler the sibling's registry line reaches for is the sibling's
    // OWN path, so the replay excludes it: the shared line rides, the file
    // behind it does not. That asymmetry IS the BL-1324 shape.
    commitFile(
      root,
      SIBLING_HANDLER,
      'module.exports = { registerSteps() {} };\n',
      `${SUBJECT_SIBLING}: the handler its registry line reaches for`,
    );
  });

  scoped(/^every sibling sharing the path is approved$/, (ctx) => {
    const st = state(ctx);
    writeTicket(st.root, 'active', SUBJECT_SIBLING, 'human_approval: approved\n');
    st.subject = SUBJECT_SIBLING;
  });

  scoped(/^one sibling sharing the path is awaiting approval$/, (ctx) => {
    const st = state(ctx);
    writeTicket(st.root, 'active', SUBJECT_SIBLING, 'human_approval: pending\n');
    st.subject = SUBJECT_SIBLING;
    // An APPROVED co-owner as well, so scenario 04's land has something to
    // proceed with: a fixture where the only sibling is the blocked one
    // proves nothing about what an approved land carries.
    writeTicket(st.root, 'active', CO_OWNER, 'human_approval: approved\n');
    commitFile(
      st.root,
      SHARED_PATH,
      REGISTRY([`// ${LANDING} line`, SIBLING_LINE, `// ${CO_OWNER} line`]),
      `${CO_OWNER}: an approved co-owner adds its handler to the same file`,
    );
  });

  scoped(/^one sibling sharing the path is withheld$/, (ctx) => {
    const st = state(ctx);
    // Filed in backlog/hold, and its field still reads approved from before a
    // human pulled it - the hold is the later, stronger statement.
    writeTicket(st.root, 'hold', SUBJECT_SIBLING, 'human_approval: approved\n');
    st.subject = SUBJECT_SIBLING;
  });

  scoped(/^one sibling sharing the path has no readable approval state$/, (ctx) => {
    // No ticket file is written at all: the state cannot be read, and an
    // unanswered question is never collected as an approval.
    state(ctx).subject = SUBJECT_SIBLING;
  });

  scoped(/^one sibling's shared-path lines reference a file that is not on main$/, (ctx) => {
    const st = state(ctx);
    // The precondition is READ, not arranged: the Background already put the
    // sibling's require line in the shared registry and its handler file on
    // the sibling's own (excluded) path. A fixture that stopped doing that
    // would make this scenario pass for the wrong reason.
    const registry = fs.readFileSync(path.join(st.root, SHARED_PATH), 'utf8');
    assert.ok(registry.includes(SIBLING_LINE), 'the sibling contributed no line to the shared registry');
    const onMain = spawnSync('git', ['show', `refs/remotes/origin/main:${SIBLING_HANDLER}`], {
      cwd: st.root,
      encoding: 'utf8',
    });
    assert.notEqual(onMain.status, 0, `${SIBLING_HANDLER} is already on main, so nothing is dangling`);
    st.treeShouldBeConsistent = false;
  });

  scoped(/^every file the shared-path lines reference is on main$/, (ctx) => {
    const st = state(ctx);
    // ON MAIN, literally - origin/main is advanced to a commit carrying the
    // handler, rather than the handler being committed on the tip where the
    // replay would exclude it as the sibling's own path. That distinction is
    // the whole scenario: the passenger's line is safe precisely because what
    // it reaches for is ALREADY there.
    const base = git(st.root, 'rev-parse', 'refs/remotes/origin/main').trim();
    const index = path.join(st.root, '.git', 'bl1375-scratch-index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    const plumb = (args, input) =>
      execFileSync('git', args, { cwd: st.root, env, encoding: 'utf8', input }).trim();
    plumb(['read-tree', base]);
    const blob = plumb(['hash-object', '-w', '--stdin'], 'module.exports = { registerSteps() {} };\n');
    plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${SIBLING_HANDLER}`]);
    const tree = plumb(['write-tree']);
    const commit = plumb(['commit-tree', tree, '-p', base, '-m', 'main already carries the handler']);
    git(st.root, 'update-ref', 'refs/remotes/origin/main', commit);
    fs.rmSync(index, { force: true });
    st.treeShouldBeConsistent = true;
  });

  // "one of them" and "another of them" are the same act from the landing
  // ticket's seat - which sibling the scenario is talking ABOUT is fixed by
  // its Given, not by the pronoun. Both therefore run the same decision, and
  // scenarios 06/07 (whose subject is the tree guard, not the plan) go on
  // through the REAL replay!, which runs the REAL guard against its own tree.
  const decide = (ctx) => {
    const st = state(ctx);
    st.commit = head(st.root);
    st.plan = askLandStep(
      st.root,
      `(land-step-lib/land-plan {:root "${st.root}" :commit "${st.commit}" :task-ticket-id "${LANDING}"})`,
    );
    if (st.treeShouldBeConsistent !== undefined) {
      assert.equal(st.plan.action, 'replay', `the plan refused before the guard could speak: ${JSON.stringify(st.plan)}`);
      st.replay = askLandStep(
        st.root,
        `(land-step-lib/replay! {:root "${st.root}" :commit "${st.commit}" :task-ticket-id "${LANDING}"` +
          ` :own-paths ${JSON.stringify(st.plan['own-paths'])} :passengers #{${(st.plan.passengers || [])
            .map((s) => `"${s}"`)
            .join(' ')}}})`,
      );
    }
  };

  scoped(/^the land step decides for one of them$/, (ctx) => {
    decide(ctx);
  });

  scoped(/^the land step decides for another of them$/, (ctx) => {
    decide(ctx);
  });

  scoped(/^any land proceeds for the approved siblings$/, (ctx) => {
    const st = state(ctx);
    decide(ctx);
    // The approved co-owner's land is the one that proceeds. It is asked of
    // the real library rather than assumed - if it escalated too, this
    // scenario would "pass" having landed nothing at all.
    st.approvedPlan = askLandStep(
      st.root,
      `(land-step-lib/land-plan {:root "${st.root}" :commit "${st.commit}" :task-ticket-id "${CO_OWNER}"})`,
    );
  });

  scoped(/^a land is available for that ticket$/, (ctx) => {
    const st = state(ctx);
    if (st.treeShouldBeConsistent !== undefined) {
      assert.equal(
        st.replay.success,
        true,
        `the land was refused for a self-consistent replayed tree: ${JSON.stringify(st.replay)}`,
      );
      assert.ok(
        (st.plan.passengers || []).includes(SUBJECT_SIBLING),
        `no passenger rode, so the guard's pass proves nothing: ${JSON.stringify(st.plan)}`,
      );
      git(st.root, 'branch', '-q', '-D', st.replay.branch);
    } else {
      assert.equal(st.plan.action, 'replay', `no land is available: ${JSON.stringify(st.plan)}`);
      assert.ok(
        (st.plan['own-paths'] || []).includes(SHARED_PATH),
        `the shared path was not replayed: ${JSON.stringify(st.plan)}`,
      );
      assert.ok(
        (st.plan.passengers || []).includes(SUBJECT_SIBLING),
        `the approved sibling riding on the shared path was not named: ${JSON.stringify(st.plan)}`,
      );
    }
    cleanup(st);
  });

  scoped(/^the land is refused naming that sibling$/, (ctx) => {
    const st = state(ctx);
    if (st.treeShouldBeConsistent === false) {
      assert.equal(st.replay.success, false, `an inconsistent replayed tree was published: ${JSON.stringify(st.replay)}`);
      assert.ok(
        st.replay.reason.includes(SUBJECT_SIBLING),
        `the refusal does not name the passenger: ${st.replay.reason}`,
      );
    } else {
      assert.equal(st.plan.action, 'escalate', `the land was not refused: ${JSON.stringify(st.plan)}`);
      assert.ok(st.plan.reason.includes(SUBJECT_SIBLING), `the refusal does not name the sibling: ${st.plan.reason}`);
      assert.ok(st.plan.reason.includes(SHARED_PATH), `the refusal does not name the shared path: ${st.plan.reason}`);
    }
    // No scratch worktree is left behind by a refusal, whichever door it left by.
    assert.equal(
      git(st.root, 'worktree', 'list').trim().split('\n').length,
      1,
      'a scratch worktree was left behind by the refusal',
    );
    cleanup(st);
  });

  scoped(/^that sibling's lines are not on main$/, (ctx) => {
    const st = state(ctx);
    // The blocked sibling's own land refuses...
    assert.equal(st.plan.action, 'escalate', `the blocked sibling's land was not refused: ${JSON.stringify(st.plan)}`);
    // ...and the approved co-owner's land also refuses, because the shared
    // path it would take whole carries the blocked sibling's line. That is
    // invariant 1 holding: no route this ticket opens carries it.
    assert.equal(
      st.approvedPlan.action,
      'escalate',
      `an approved land carried a sibling awaiting approval: ${JSON.stringify(st.approvedPlan)}`,
    );
    assert.ok(
      st.approvedPlan.reason.includes(SUBJECT_SIBLING),
      `the refusal does not name the sibling whose lines it kept off main: ${st.approvedPlan.reason}`,
    );
    // Asked of the tree, not inferred from the refusal: origin/main's own
    // copy of the shared path carries no line of the blocked sibling's.
    // A path absent from origin/main altogether carries nothing, which is the
    // same answer as a present copy without the line - but it is read, never
    // assumed, so a fixture that stopped putting the path there is visible.
    let onMain = '';
    try {
      onMain = git(st.root, 'show', `refs/remotes/origin/main:${SHARED_PATH}`);
    } catch {
      onMain = '';
    }
    assert.ok(
      !onMain.includes(SIBLING_LINE),
      `the sibling's line reached origin/main: ${onMain}`,
    );
    cleanup(st);
  });
}

module.exports = { registerSteps };
