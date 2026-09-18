'use strict';

// BL-1631: step handlers for "A land retires the landing ticket's own
// register rows" (specifier-authored feature, lands with this handler in
// the same parcel - BL-233, BL-1371). Reuses BL-1604's fixture-building
// idiom (`mkSocketFixtureRoot`, an entangled unlanded sibling to force
// land-plan's :replay path) directly, per the ticket's own "How" section.
//
// Scenario 01 (Outline) drives land-step-lib/rows-to-retire directly, over
// bb, against each registry's real row/owner shape - never re-implemented
// in JS. Scenarios 02/03 drive the real swarmforge/scripts/land_step_cli.bb
// against a real fixture git repo, same pattern as BL-1604's own handler.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE_NAME = "BL-1631 A land retires the landing ticket's own register rows";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDING = 'BL-9631';
const OTHER_OPEN = 'BL-9632';
const SIBLING = 'BL-9635';

const REGISTER_PATH = 'backlog/standing-reds.tsv';
const ALLOWLIST_PATH = 'swarmforge/scripts/property_suite_standing_allowlist.tsv';
const POLE_PATH = 'backlog/suite-poles.tsv';

// Explicit known values per the Scenario Outline handler rule (engineering
// rules): each Examples: <registry> value is looked up here, never passed
// through as a bare string.
const KNOWN_REGISTRIES = new Map([
  [
    'standing-red register',
    {
      path: REGISTER_PATH,
      row: (owner) => `unit\tfile-${owner}.test.js\t${owner}\t2026-09-01\tnote-${owner}`,
      extra: '# a comment line',
    },
  ],
  [
    'property suite standing allowlist',
    {
      path: ALLOWLIST_PATH,
      row: (owner) => `test/${owner}.property.test.js\tallowlist\towner ${owner} (backlog/standing-reds.tsv): some reason`,
      extra: '# a comment line',
    },
  ],
  [
    'pole register',
    {
      path: POLE_PATH,
      row: (owner) => `extension/test/${owner}.test.js\t${owner}\t2026-09-01\t14600\tBL-791 slice D pole census`,
      extra: (owner) => `extension/test/accepted-${owner}.test.js\t${owner}\t2026-09-01\t69900\tan accepted pole under BL-9099 (register disposition)`,
    },
  ],
]);

function bbEval(expr) {
  const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
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

function writeActiveTicket(root, id) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\nhuman_approval: approved\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', `${id}: open ticket file`);
}

function registerRow(owner) {
  return `unit\tfile-${owner}.test.js\t${owner}\t2026-09-01\tnote-${owner}\n`;
}

function runCli(root, commit) {
  const r = spawnSync('bb', [CLI, `${LANDING}-fixture`, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function initFixture(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
}

// The entangled, unlanded sibling - forces land-plan's :replay path (the
// only one that runs write-tree-from-paths!/restore-other-tickets-
// registry-rows!). Committed AFTER origin/main is marked, or it would ride
// into origin/main itself and never read as entangled/unlanded.
function addEntangledSibling(root) {
  writeActiveTicket(root, SIBLING);
  commitFile(root, 'sibling-own.txt', 'sibling work\n', `${SIBLING}: sibling's own unrelated commit`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Scenario 01 (Outline) ────────────────────────────────────────────

  scoped(
    /^a (.+) holding a row owned by the landing ticket, a row owned by another open ticket, and (.+)$/,
    (ctx, registryName, extraDesc) => {
      const spec = KNOWN_REGISTRIES.get(registryName);
      assert.ok(spec, `bl1631: unknown registry in Examples: ${registryName}`);
      const landingRow = spec.row(LANDING);
      const otherRow = spec.row(OTHER_OPEN);
      const extraLine =
        extraDesc === 'a comment line'
          ? spec.extra
          : typeof spec.extra === 'function'
            ? spec.extra(LANDING)
            : (() => {
                throw new Error(`bl1631: unknown extra "${extraDesc}" for registry ${registryName}`);
              })();
      ctx.bl1631Spec = spec;
      ctx.bl1631Lines = [landingRow, otherRow, extraLine];
    }
  );

  scoped(/^the rows to retire for the landing ticket are computed$/, (ctx) => {
    const linesLit = ctx.bl1631Lines.map((l) => `"${l.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
    // Exactly land_step_lib.bb's own registry-specs owner-fn/retirable?-fn
    // shapes per registry, driven through the real rows-to-retire rather
    // than re-implemented here: standing-reds.tsv reads column 2 directly,
    // the allowlist reads the "owner BL-<n>" token out of its rationale
    // column, the pole register reads column 1 and excepts an
    // accepted-pole row from retirement regardless of owner.
    const ownerFnClause =
      ctx.bl1631Spec.path === REGISTER_PATH
        ? '(fn [line] (nth (str/split line #"\\t" -1) 2 nil))'
        : ctx.bl1631Spec.path === ALLOWLIST_PATH
          ? '(fn [line] (second (re-find #"owner (BL-\\d+)" (nth (str/split line #"\\t" -1) 2 ""))))'
          : '(fn [line] (nth (str/split line #"\\t" -1) 1 nil))';
    const retirableClause =
      ctx.bl1631Spec.path === POLE_PATH
        ? '(fn [line] (not (re-find #"(?i)accepted pole" line)))'
        : 'nil';
    const expr = `
(require '[cheshire.core :as json] '[clojure.string :as str])
(load-file "${LAND_STEP_LIB}")
(let [lines [${linesLit}]
      owner-fn ${ownerFnClause}
      retire (land-step-lib/rows-to-retire
              {:lines lines :owner-fn owner-fn :task-ticket-id "${LANDING}"
               :retirable?-fn ${retirableClause}})]
  (println (json/generate-string retire)))`;
    ctx.bl1631Retired = bbEval(expr);
  });

  scoped(/^exactly the landing ticket's row is retired$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1631Retired,
      [ctx.bl1631Lines[0]],
      `expected exactly the landing ticket's row retired, got: ${JSON.stringify(ctx.bl1631Retired)}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(
    /^a fixture repository whose origin\/main and tip both carry the landing ticket's standing-red row$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1631-retire-');
      initFixture(root);
      commitFile(
        root,
        REGISTER_PATH,
        `# header\n${registerRow(LANDING)}`,
        'seed the standing-red register with the landing ticket\'s own row'
      );
      markOriginMain(root);
      // A genuine own-path for the landing ticket, committed AFTER
      // origin/main is marked - own-paths would otherwise read empty (the
      // register file itself is untouched relative to origin/main, since
      // it already carries the same row) and land-plan would refuse the
      // whole replay as "nothing of this ticket's own contribution".
      writeActiveTicket(root, LANDING);
      addEntangledSibling(root);
      ctx.root = root;
      ctx.bl1631LandingId = LANDING;
    }
  );

  scoped(/^the land step builds the replay commit for the landing ticket$/, (ctx) => {
    ctx.bl1631Tip = head(ctx.root);
    ctx.bl1631Cli = runCli(ctx.root, ctx.bl1631Tip);
    assert.equal(ctx.bl1631Cli.status, 0, `expected a clean replay (exit 0), got: ${JSON.stringify(ctx.bl1631Cli)}`);
    assert.ok(ctx.bl1631Cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.bl1631Cli.stdout}`);
    const branchMatch = ctx.bl1631Cli.stdout.match(/LAND_REPLAY (\S+) (\S+)/);
    assert.ok(branchMatch, `could not parse LAND_REPLAY line: ${ctx.bl1631Cli.stdout}`);
    ctx.bl1631ReplayCommit = branchMatch[2];
  });

  scoped(/^the replay commit's standing-red register carries no row owned by the landing ticket$/, (ctx) => {
    const content = git(ctx.root, 'show', `${ctx.bl1631ReplayCommit}:${REGISTER_PATH}`);
    assert.ok(
      !content.includes(registerRow(LANDING).trim()),
      `expected no row owned by ${LANDING}, got:\n${content}`
    );
  });

  scoped(/^the land step prints one REGISTER_ROW_RETIRED line naming the register, the file and the owner$/, (ctx) => {
    const marker = `REGISTER_ROW_RETIRED ${REGISTER_PATH} file-${LANDING}.test.js ${LANDING}`;
    assert.ok(
      ctx.bl1631Cli.stdout.includes(marker),
      `expected "${marker}" in stdout, got: ${ctx.bl1631Cli.stdout}`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────

  scoped(
    /^a fixture repository whose origin\/main carries a row owned by another open ticket that the tip removed$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1631-restore-');
      initFixture(root);
      commitFile(
        root,
        REGISTER_PATH,
        `# header\n${registerRow(OTHER_OPEN)}`,
        'seed the standing-red register with the other open ticket\'s row'
      );
      writeActiveTicket(root, OTHER_OPEN);
      markOriginMain(root);
      // The landing ticket's own tip removes the row entirely (the
      // branch-history-loss shape BL-1604 already protects against).
      writeActiveTicket(root, LANDING);
      commitFile(root, REGISTER_PATH, '# header\n', `${LANDING}: own tip lacks ${OTHER_OPEN}'s row`);
      addEntangledSibling(root);
      ctx.root = root;
    }
  );

  scoped(/^the replay commit's standing-red register still carries that other ticket's row$/, (ctx) => {
    const content = git(ctx.root, 'show', `${ctx.bl1631ReplayCommit}:${REGISTER_PATH}`);
    assert.ok(
      content.includes(registerRow(OTHER_OPEN).trim()),
      `expected ${OTHER_OPEN}'s row restored, got:\n${content}`
    );
  });

  scoped(/^the land step prints one REGISTER_ROW_RESTORED line for it$/, (ctx) => {
    const marker = `REGISTER_ROW_RESTORED ${REGISTER_PATH} file-${OTHER_OPEN}.test.js ${OTHER_OPEN}`;
    assert.ok(
      ctx.bl1631Cli.stdout.includes(marker),
      `expected "${marker}" in stdout, got: ${ctx.bl1631Cli.stdout}`
    );
  });
}

module.exports = { registerSteps };
