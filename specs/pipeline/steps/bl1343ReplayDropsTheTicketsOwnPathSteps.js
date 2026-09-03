'use strict';

// BL-1343: step handlers for "the replay never drops the landing ticket's own
// path in silence".
//
// The land step is never re-implemented here. Every scenario builds a real
// git fixture in its own temp directory and asks the REAL
// swarmforge/scripts/land_step_lib.bb (own-paths / land-plan) about it
// through bb, so what these scenarios pin is the shipped decision rather
// than a JavaScript restatement of it. The fixture is its own repository and
// its own origin/main ref, so nothing reaches the live repo.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1343-acceptance-';
const TICKET_ID = 'BL-9343';
const SIBLING_ID = 'BL-9344';
const OWN_PATH = 'specs/pipeline/steps/bl9343Steps.js';

// BL-971: sweep any fixture a killed run left behind BEFORE creating a new
// one - a trap catches nothing when the process is killed.
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

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  return root;
}

function commitFile(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMainHere(root) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  git(root, 'update-ref', 'refs/remotes/origin/main', head);
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

// Asks the real library, in one bb process, and returns its answer as data.
function askLandStep(root, expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string ${expression}))`;
  const result = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb could not run the land step: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

function ownPaths(ctx) {
  const root = ctx.bl1343Root;
  return askLandStep(
    root,
    `(land-step-lib/own-paths "${root}" "${head(root)}" "${TICKET_ID}" #{"${SIBLING_ID}"})`,
  );
}

function landPlan(ctx) {
  const root = ctx.bl1343Root;
  return askLandStep(
    root,
    `(land-step-lib/land-plan {:root "${root}" :commit "${head(root)}" :task-ticket-id "${TICKET_ID}"})`,
  );
}

function requireRoot(ctx) {
  if (!ctx.bl1343Root) {
    throw new Error('no fixture repository was built for this scenario');
  }
  return ctx.bl1343Root;
}

function answer(ctx) {
  if (!ctx.bl1343Answer) {
    throw new Error('the land step was never asked anything in this scenario');
  }
  return ctx.bl1343Answer;
}

const FEATURE_NAME = "BL-1343 the replay never drops the landing ticket's own path in silence";

function registerSteps(registry) {
  // Scoped: "the land step refuses" and its neighbours are generic enough
  // that an unscoped registration would answer another feature's scenarios
  // with this ticket's fixture (BL-425).
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^a ticket approved at a tip whose content is not yet on origin\/main$/, (ctx) => {
    const root = newRepo();
    markOriginMainHere(root);
    ctx.bl1343Root = root;
    ctx.bl1343Answer = null;
  });

  scoped(/^a path present at the tip and absent from origin\/main$/, (ctx) => {
    // Recorded, not yet committed: the NEXT Given decides which commit
    // subject introduces it, and that subject is the whole point of each
    // scenario's separation.
    ctx.bl1343PathPending = OWN_PATH;
  });

  scoped(/^no sibling commit in the walked range touches it$/, (ctx) => {
    const root = requireRoot(ctx);
    commitFile(root, 'unrelated/sibling.txt', 's\n', `${SIBLING_ID}: unrelated sibling work`);
    commitFile(root, ctx.bl1343PathPending, '// own\n', `${TICKET_ID}: its own new handler`);
  });

  scoped(/^no commit in the walked range is attributed to any ticket for it$/, (ctx) => {
    const root = requireRoot(ctx);
    commitFile(root, ctx.bl1343PathPending, '// own\n', 'housekeeping with no ticket in the subject');
  });

  scoped(/^the only commits the attribution walk sees touching it name an unlanded sibling$/, (ctx) => {
    const root = requireRoot(ctx);
    // The BL-1338 shape exactly: the landing ticket's own file arrives under
    // a commit whose subject names a sibling, so attribution credits the
    // whole contribution away from the ticket that is landing.
    commitFile(root, ctx.bl1343PathPending, '// own\n', `${SIBLING_ID}: sibling commit carrying it`);
  });

  scoped(/^the replay set for the landing ticket is empty$/, (ctx) => {
    const root = requireRoot(ctx);
    ctx.bl1343EmptySetBuilt = true;
    // Left to the next Given, which decides WHY it is empty - the whole
    // distinction scenarios 04 and 05 exist to separate.
    ctx.bl1343Root = root;
  });

  scoped(/^the tip still differs from origin\/main on at least one path$/, (ctx) => {
    const root = requireRoot(ctx);
    commitFile(root, OWN_PATH, '// own\n', `${SIBLING_ID}: sibling commit carrying it`);
  });

  scoped(/^the tip is identical to origin\/main$/, (ctx) => {
    const root = requireRoot(ctx);
    // Nothing delivered at all: origin/main already points at this tip.
    markOriginMainHere(root);
  });

  scoped(/^one path's attribution cannot be read$/, (ctx) => {
    const root = requireRoot(ctx);
    commitFile(root, OWN_PATH, '// own\n', `${TICKET_ID}: own new handler`);
    ctx.bl1343UnreadableAttribution = true;
  });

  scoped(/^the land step computes the ticket's own paths$/, (ctx) => {
    const root = requireRoot(ctx);
    if (ctx.bl1343UnreadableAttribution) {
      // The injected commits-fn seam the library already exposes, so an
      // unreadable read is driven without corrupting a repository.
      ctx.bl1343Answer = askLandStep(
        root,
        `(land-step-lib/own-paths "${root}" "${head(root)}" "${TICKET_ID}" #{"${SIBLING_ID}"} (fn [_ _ _ _] nil))`,
      );
      return;
    }
    ctx.bl1343Answer = ownPaths(ctx);
  });

  scoped(/^the land step decides$/, (ctx) => {
    ctx.bl1343Answer = landPlan(ctx);
  });

  scoped(/^that path is in the replay set$/, (ctx) => {
    const result = answer(ctx);
    const paths = result.paths || [];
    if (!paths.includes(OWN_PATH)) {
      throw new Error(`${OWN_PATH} is not in the replay set: ${JSON.stringify(result)}`);
    }
  });

  scoped(/^the land step refuses$/, (ctx) => {
    const result = answer(ctx);
    const refused = result.paths === null || result.action === 'escalate';
    if (!refused) {
      throw new Error(`the land step did not refuse: ${JSON.stringify(result)}`);
    }
  });

  scoped(/^the refusal names that path, the landing ticket and the sibling$/, (ctx) => {
    const text = answer(ctx).warning || '';
    for (const needle of [OWN_PATH, TICKET_ID, SIBLING_ID]) {
      if (!text.includes(needle)) {
        throw new Error(`the refusal does not name ${needle}: ${text || '(no reason at all)'}`);
      }
    }
  });

  scoped(/^it does not report the ticket as landed$/, (ctx) => {
    const result = answer(ctx);
    if (result.action === 'land' || result.action === 'replay') {
      throw new Error(`the land step still reported ${result.action}: ${JSON.stringify(result)}`);
    }
  });

  scoped(/^the land step reports nothing left to replay$/, (ctx) => {
    const result = answer(ctx);
    // Two shapes say the same thing, and both must stay non-refusals: asked
    // for the paths, an empty set; asked to decide on a tip that is already
    // origin/main, :land - there is no range left to walk, so nothing is
    // left to replay. What would be wrong here is an escalation.
    const emptySet = Array.isArray(result.paths) && result.paths.length === 0;
    const nothingToDo = result.action === 'land';
    if (!emptySet && !nothingToDo) {
      throw new Error(`expected nothing left to replay, got: ${JSON.stringify(result)}`);
    }
  });

  scoped(/^it does not refuse$/, (ctx) => {
    const result = answer(ctx);
    if (result.warning || result.action === 'escalate') {
      throw new Error(`the land step refused after all: ${JSON.stringify(result)}`);
    }
  });

  scoped(/^the land step refuses and names what it could not read$/, (ctx) => {
    const result = answer(ctx);
    if (result.paths !== null) {
      throw new Error(`an unreadable attribution did not refuse: ${JSON.stringify(result)}`);
    }
    if (!/attribution/.test(result.warning || '')) {
      throw new Error(`the refusal does not name what it could not read: ${result.warning || '(none)'}`);
    }
  });
}

module.exports = { registerSteps };
