'use strict';

// BL-1604: step handlers for "a land never carries another ticket's
// register row removal". Drives the REAL swarmforge/scripts/land_step_cli.bb
// against a real fixture git repo, same pattern as
// bl1481SharedPathContentCheckSteps.js - an entangled (unlanded) sibling
// commit forces land-plan's :replay path (the one write-tree-from-paths!
// builds through), so this ticket's registry-row restoration actually runs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE_NAME = "BL-1604 A land never carries another ticket's register row removal";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9601';
const OTHER_OPEN = 'BL-9602';
const CLOSED = 'BL-9603';
const SIBLING = 'BL-9605';

const REGISTER_PATH = 'backlog/standing-reds.tsv';
const ALLOWLIST_PATH = 'swarmforge/scripts/property_suite_standing_allowlist.tsv';

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

function allowlistRow(owner) {
  return `test/${owner}.property.test.js\tallowlist\towner ${owner} (backlog/standing-reds.tsv): some reason\n`;
}

function fullRegisterContent() {
  return `# header\n${registerRow(LANDING)}${registerRow(OTHER_OPEN)}${registerRow(CLOSED)}`;
}

function fullAllowlistContent() {
  return `file\tdisposition\trationale\n${allowlistRow(LANDING)}${allowlistRow(OTHER_OPEN)}${allowlistRow(CLOSED)}`;
}

function runCli(root, commit) {
  const r = spawnSync('bb', [CLI, `${LANDING}-fixture`, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const OWNER_DESC = {
  'the other open ticket': OTHER_OPEN,
  'the landing ticket': LANDING,
  'the closed ticket': CLOSED,
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository under a scratch root with its own origin, a landing ticket and a registry file on origin\/main carrying rows owned by the landing ticket, by another open ticket and by a closed ticket$/,
    (ctx) => {
      const root = mkSocketFixtureRoot('bl1604-fixture-');
      git(root, 'init', '-q', '-b', 'main', '.');
      git(root, 'config', 'user.email', 't@t');
      git(root, 'config', 'user.name', 't');
      git(root, 'config', 'commit.gpgsign', 'false');

      commitFile(root, REGISTER_PATH, fullRegisterContent(), 'seed the standing-red register');
      commitFile(root, ALLOWLIST_PATH, fullAllowlistContent(), 'seed the property-suite allowlist');
      writeActiveTicket(root, OTHER_OPEN);
      // CLOSED has no backlog/active or backlog/paused file at all - open-
      // ticket-ids-for reads exactly those two dirs, so its absence is what
      // makes it read as closed.
      markOriginMain(root);

      // The entangled, unlanded sibling - forces land-plan's :replay path
      // (the only one that runs write-tree-from-paths!/restore-other-
      // tickets-registry-rows!). Never lands on origin/main itself.
      writeActiveTicket(root, SIBLING);
      commitFile(root, 'sibling-own.txt', 'sibling work\n', `${SIBLING}: sibling's own unrelated commit`);

      ctx.root = root;
    }
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────

  scoped(/^the landing ticket's tip lacks the (\S+) row owned by (.+)$/, (ctx, registryPath, ownerDesc) => {
    const owner = OWNER_DESC[ownerDesc];
    assert.ok(owner, `bl1604: unknown owner description "${ownerDesc}"`);
    const full = registryPath === REGISTER_PATH ? fullRegisterContent() : fullAllowlistContent();
    const rowLine = registryPath === REGISTER_PATH ? registerRow(owner) : allowlistRow(owner);
    const withoutRow = full
      .split('\n')
      .filter((l) => l !== rowLine.trimEnd())
      .join('\n');
    writeActiveTicket(ctx.root, LANDING);
    commitFile(
      ctx.root,
      registryPath,
      withoutRow.endsWith('\n') ? withoutRow : `${withoutRow}\n`,
      `${LANDING}: own tip lacks ${owner}'s ${registryPath} row`
    );
    ctx.bl1604RegistryPath = registryPath;
    ctx.bl1604Owner = owner;
  });

  scoped(/^the land plan is computed and the replay is built for the landing ticket$/, (ctx) => {
    ctx.bl1604Tip = head(ctx.root);
    ctx.bl1604Cli = runCli(ctx.root, ctx.bl1604Tip);
  });

  scoped(/^the replayed (\S+) (.+)$/, (ctx, registryPath, outcome) => {
    assert.equal(registryPath, ctx.bl1604RegistryPath);
    assert.equal(ctx.bl1604Cli.status, 0, `expected a clean replay (exit 0), got: ${JSON.stringify(ctx.bl1604Cli)}`);
    assert.ok(ctx.bl1604Cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.bl1604Cli.stdout}`);
    const branchMatch = ctx.bl1604Cli.stdout.match(/LAND_REPLAY (\S+) (\S+)/);
    assert.ok(branchMatch, `could not parse LAND_REPLAY line: ${ctx.bl1604Cli.stdout}`);
    const replayCommit = branchMatch[2];
    const rowLine = registryPath === REGISTER_PATH ? registerRow(ctx.bl1604Owner) : allowlistRow(ctx.bl1604Owner);
    const replayedContent = git(ctx.root, 'show', `${replayCommit}:${registryPath}`);
    const restoredMarker = `REGISTER_ROW_RESTORED ${registryPath}`;

    if (outcome.startsWith('carries that row again')) {
      assert.ok(
        replayedContent.includes(rowLine.trim()),
        `expected the replayed ${registryPath} to carry ${ctx.bl1604Owner}'s row, got:\n${replayedContent}`
      );
      assert.ok(
        ctx.bl1604Cli.stdout.includes(restoredMarker) && ctx.bl1604Cli.stdout.includes(ctx.bl1604Owner),
        `expected a REGISTER_ROW_RESTORED line naming ${ctx.bl1604Owner}, got: ${ctx.bl1604Cli.stdout}`
      );
    } else if (outcome.startsWith('lacks that row')) {
      assert.ok(
        !replayedContent.includes(rowLine.trim()),
        `expected the replayed ${registryPath} to still lack ${ctx.bl1604Owner}'s row, got:\n${replayedContent}`
      );
      assert.ok(
        !ctx.bl1604Cli.stdout.includes(restoredMarker),
        `expected no REGISTER_ROW_RESTORED line, got: ${ctx.bl1604Cli.stdout}`
      );
    } else {
      throw new Error(`bl1604: unknown outcome "${outcome}"`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // No real git state constructs an unreadable origin/main registry blob
  // without corrupting the repository (same shape BL-1481's own unreadable
  // scenario is in - see ownPathsWithUnreadableContentCheck there): this
  // drives restore-other-tickets-registry-rows! directly with a genuinely
  // unresolvable origin-main ref, proving the real function's fail-closed
  // wiring rather than a specific git-level cause.

  scoped(/^the registry file on origin\/main cannot be read as rows$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1604-unreadable-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    commitFile(root, REGISTER_PATH, fullRegisterContent(), 'seed the register');
    commitFile(root, ALLOWLIST_PATH, fullAllowlistContent(), 'seed the allowlist');
    ctx.root = root;
  });

  scoped(/^the landing ticket's land is attempted$/, (ctx) => {
    const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
    const expr = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/restore-other-tickets-registry-rows!
    {:root "${ctx.root}" :scratch "${ctx.root}"
     :origin-main "0000000000000000000000000000000000000000"
     :task-ticket-id "${LANDING}"})))`;
    const r = spawnSync('bb', ['-e', expr], { encoding: 'utf8' });
    assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
    ctx.bl1604Result = JSON.parse(r.stdout.trim().split('\n').pop());
  });

  scoped(/^the attempt is refused with a reason naming the registry file$/, (ctx) => {
    assert.equal(ctx.bl1604Result['ok?'], false, `expected a refusal, got: ${JSON.stringify(ctx.bl1604Result)}`);
    assert.ok(
      String(ctx.bl1604Result.reason).includes(REGISTER_PATH),
      `expected the refusal to name ${REGISTER_PATH}, got: ${ctx.bl1604Result.reason}`
    );
  });
}

module.exports = { registerSteps };
