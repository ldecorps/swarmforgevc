'use strict';

// BL-982: step handlers for "a pipeline stage can host a second seat,
// booting with its own identity and its own model". Every scenario drives
// the REAL swarmforge.sh (sourced per the BL-089 ZSH_EVAL_CONTEXT guard -
// parse_config / write_roles_file / generate_dormant_role_launch_artifacts)
// over fixture confs. Scenario 04's oracle is the PRE-CHANGE swarmforge.sh
// pinned by blob sha (the exact script this parcel's merge-base carried),
// run from a symlink-farmed scripts dir so its SCRIPT_DIR-relative helpers
// resolve.
//
// Invariant 1 (BL-968) applies here: module load is requires and pure
// constants only - everything environmental binds at step-execution time.
//
// BL-1006: this file used to carry a third group of handlers driving the
// REAL swarm_handoff.bb delivery path and the REAL ready_for_next.sh claim
// path, for a scenario 06 asserting the second seat was inert. That was a
// slice boundary, not a behaviour - BL-983 made the seat a real claimant on
// 2026-08-20, and the scenario has been retired rather than reworded. The
// delivery and exclusivity contracts are asserted by BL-983's own feature
// file and step handlers; do not restore these from history.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
// BL-1002/BL-948 gate: this file references a control socket, so fixture
// roots come from the shared short-base helper, never os.tmpdir().
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-982 a pipeline stage can host a second seat, booting with its own identity and its own model';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
// The pre-change swarmforge.sh, pinned by BLOB sha (durable; HEAD~N drifts).
const PRE_BLOB = '2edd9a17ba9d40709c0f436d12395b638563c0ca';

// KNOWN_VALUES: scenario 05's <collision> tokens - validated explicitly,
// never a passthrough into an arbitrary conf shape.
const KNOWN_COLLISIONS = {
  'two seats of one stage sharing a seat id': {
    conf: ['window coder claude coder --model x', 'window coder@fable claude coder-a --model x', 'window coder@fable claude coder-b --model x'],
    names: "Duplicate role 'coder@fable'",
  },
  'two seats of one stage sharing a worktree': {
    conf: ['window coder claude coder --model x', 'window coder@fable claude coder --model x'],
    names: "Duplicate worktree 'coder'",
  },
};

const TWO_SEAT_CONF = [
  'window specifier claude master --model claude-opus-5',
  'window coder claude coder --model claude-sonnet-5',
  'window coder@fable claude coder-fable --model claude-fable-5',
];
const SINGLE_SEAT_CONF = [
  'window specifier claude master --model claude-opus-5 --effort xhigh',
  'window coder claude coder --model claude-sonnet-5 --effort xhigh',
];

function mkRoot(ctx, lines) {
  const root = mkSocketFixtureRoot('bl982-acc-');
  ctx.roots = ctx.roots || [];
  ctx.roots.push(root);
  for (const d of ['swarmforge/roles', '.swarmforge/launch', '.swarmforge/prompts']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'c\n');
  for (const r of ['coordinator', 'specifier', 'coder', 'cleaner']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${r}.prompt`), `${r}\n`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
  return root;
}

function cleanupRoots(ctx) {
  for (const r of ctx.roots || []) {
    fs.rmSync(r, { recursive: true, force: true });
  }
  ctx.roots = [];
}

function zshSource(root, shFile, body) {
  return spawnSync('zsh', ['-c', `source '${shFile}' '${root}'; ${body}`], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, XDG_RUNTIME_DIR: '/tmp', SWARMFORGE_CONFIG: '' },
  });
}

function parsePack(root, shFile = SWARMFORGE_SH) {
  return zshSource(root, shFile, 'parse_config; write_roles_file');
}

function provisionSeats(root, seats) {
  const gens = seats
    .map((s) => `generate_dormant_role_launch_artifacts $(( \${ROLE_INDEX[${s}]} + 1 ))`)
    .join('; ');
  return zshSource(root, SWARMFORGE_SH, `parse_config; write_roles_file; ${gens}`);
}

function rolesRows(root) {
  return fs
    .readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

function preChangeScriptDir(ctx) {
  const dir = mkSocketFixtureRoot('bl982-pre-sh-');
  ctx.roots.push(dir);
  for (const entry of fs.readdirSync(SCRIPTS_DIR)) {
    if (entry !== 'swarmforge.sh') {
      fs.symlinkSync(path.join(SCRIPTS_DIR, entry), path.join(dir, entry));
    }
  }
  const blob = execFileSync('git', ['cat-file', 'blob', PRE_BLOB], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(dir, 'swarmforge.sh'), blob);
  return path.join(dir, 'swarmforge.sh');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack config declaring the pipeline stages$/, (ctx) => {
    ctx.roots = ctx.roots || [];
  });

  scoped(/^the pack declares two seats for one stage, each with its own worktree$/, (ctx) => {
    ctx.root = mkRoot(ctx, TWO_SEAT_CONF);
  });
  scoped(/^the pack declares one seat for every stage$/, (ctx) => {
    ctx.root = mkRoot(ctx, SINGLE_SEAT_CONF);
  });
  scoped(/^the two seats declare different models on their own window lines$/, (ctx) => {
    // TWO_SEAT_CONF already declares sonnet vs fable; assert the fixture
    // really does differ rather than assuming.
    const conf = fs.readFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'utf8');
    assert.ok(conf.includes('claude-sonnet-5') && conf.includes('claude-fable-5'), 'fixture models must differ');
  });

  scoped(/^the pack config is parsed$/, (ctx) => {
    ctx.parse = parsePack(ctx.root);
  });

  scoped(/^the parse succeeds$/, (ctx) => {
    assert.equal(ctx.parse.status, 0, `parse failed: ${ctx.parse.stderr}`);
  });
  scoped(/^both seats are reported as seats of that one stage$/, (ctx) => {
    try {
      const seats = rolesRows(ctx.root)
        .map((r) => r[0])
        .filter((id) => id === 'coder' || id.startsWith('coder@'));
      assert.deepEqual(seats.sort(), ['coder', 'coder@fable'], 'expected exactly the two coder-stage seats');
    } finally {
      cleanupRoots(ctx);
    }
  });

  scoped(/^the swarm is provisioned from that pack$/, (ctx) => {
    const seats = ctx.root && fs.readFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'utf8').includes('coder@fable')
      ? ['coder', 'coder@fable']
      : ['coder'];
    ctx.provision = provisionSeats(ctx.root, seats);
    assert.equal(ctx.provision.status, 0, `provisioning failed: ${ctx.provision.stderr}`);
  });

  scoped(/^each seat has its own session, worktree and launch script$/, (ctx) => {
    const rows = rolesRows(ctx.root);
    const bySeat = Object.fromEntries(rows.map((r) => [r[0], r]));
    assert.ok(bySeat['coder'] && bySeat['coder@fable'], 'both seat rows must exist');
    assert.notEqual(bySeat['coder'][1], bySeat['coder@fable'][1], 'worktrees must differ');
    assert.equal(bySeat['coder@fable'][3], 'swarmforge-coder@fable', 'session must derive from the seat id');
    assert.ok(fs.existsSync(path.join(ctx.root, '.swarmforge', 'launch', 'coder.sh')), 'bare seat launch script');
    assert.ok(fs.existsSync(path.join(ctx.root, '.swarmforge', 'launch', 'coder@fable.sh')), 'second seat launch script');
  });
  scoped(/^both seats resolve their role prompt from the one stage$/, (ctx) => {
    try {
      for (const seat of ['coder', 'coder@fable']) {
        const meta = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'prompts', `${seat}.md.metadata.json`), 'utf8');
        assert.ok(meta.includes('"role":"coder"'), `${seat} must compose as stage 'coder': ${meta}`);
        const md = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'prompts', `${seat}.md`), 'utf8');
        assert.ok(md.includes('You are the coder'), `${seat}'s composed prompt must be the coder stage prompt`);
      }
    } finally {
      cleanupRoots(ctx);
    }
  });

  scoped(/^each seat is launched with the model its own window line declared$/, (ctx) => {
    try {
      const bare = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'launch', 'coder.claude-settings.json'), 'utf8');
      const seat = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'launch', 'coder@fable.claude-settings.json'), 'utf8');
      assert.ok(bare.includes('claude-sonnet-5'), `bare seat model: ${bare}`);
      assert.ok(seat.includes('claude-fable-5'), `second seat model: ${seat}`);
      assert.ok(!seat.includes('claude-sonnet-5'), 'second seat must not inherit the bare seat model');
    } finally {
      cleanupRoots(ctx);
    }
  });

  scoped(/^every session, worktree, launch script and prompt path is unchanged from before this slice$/, (ctx) => {
    try {
      const preSh = preChangeScriptDir(ctx);
      const preRoot = mkRoot(ctx, SINGLE_SEAT_CONF);
      const pre = zshSource(preRoot, preSh, "parse_config; write_roles_file; generate_dormant_role_launch_artifacts $(( ${ROLE_INDEX[coder]} + 1 ))");
      assert.equal(pre.status, 0, `pre-change provisioning failed: ${pre.stderr}`);
      const norm = (root) =>
        fs.readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8').split(root).join('ROOT');
      assert.equal(norm(ctx.root), norm(preRoot), 'single-seat roles.tsv (sessions, worktrees) must be byte-identical to the pre-change script');
      const names = (root, sub) => fs.readdirSync(path.join(root, '.swarmforge', sub)).sort();
      assert.deepEqual(names(ctx.root, 'launch'), names(preRoot, 'launch'), 'launch script names must be unchanged');
      assert.deepEqual(names(ctx.root, 'prompts'), names(preRoot, 'prompts'), 'prompt artifact names must be unchanged');
    } finally {
      cleanupRoots(ctx);
    }
  });

  scoped(/^the pack declares (two seats of one stage sharing a (?:seat id|worktree))$/, (ctx, token) => {
    const known = KNOWN_COLLISIONS[token];
    if (!known) {
      throw new Error(`unknown <collision> token: ${token}`);
    }
    ctx.expectedCollision = known.names;
    ctx.root = mkRoot(ctx, known.conf);
  });
  scoped(/^the parse fails naming the collision$/, (ctx) => {
    try {
      assert.notEqual(ctx.parse.status, 0, `expected the parse to fail: ${ctx.parse.stdout}`);
      const out = `${ctx.parse.stdout}${ctx.parse.stderr}`;
      assert.ok(out.includes(ctx.expectedCollision), `expected the failure to name ${ctx.expectedCollision}:\n${out}`);
    } finally {
      cleanupRoots(ctx);
    }
  });
}

module.exports = { registerSteps };
