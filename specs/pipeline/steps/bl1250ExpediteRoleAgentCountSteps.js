'use strict';

// BL-1250: step handlers for "the expeditor observes one role agent per role,
// whatever processes a role runs".
//
// The "recorded process table" the Background names is realised as REAL
// processes with the recorded argv - `exec -a` over `sleep`, the same device
// BL-782's liveness scenarios already use - and the probe is the REAL
// expedite_cli.bb --probe-liveness path with EXPEDITE_PROBE_FILE unset. That
// entry point refuses to run with the seam set precisely so a caller cannot
// stub the process table it is supposed to be reading, and no swarm is
// launched to satisfy any of it (qa_e2e step 6).
//
// Driving the pure counter directly would report green for a fix that was
// never wired into the probe - the shape BL-1235's architect bounce caught
// two days before this was written.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');

const FEATURE_NAME =
  'BL-1250 the expeditor observes one role agent per role, whatever processes a role runs';

// The pack the defect was measured against, so the scenario that says "a whole
// pack" means the real eight.
const PACK = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'qa'];

/** @type {Set<import('node:child_process').ChildProcess>} */
const liveDecoys = new Set();

function killChild(child) {
  if (!child || child.killed) return;
  try {
    if (child.pid) process.kill(child.pid, 'SIGKILL');
  } catch { /* already gone */ }
  try {
    child.kill('SIGKILL');
  } catch { /* already gone */ }
}

function reapDecoys() {
  for (const child of liveDecoys) killChild(child);
  liveDecoys.clear();
}

// BL-782's QA D1 lesson, inherited deliberately: each scenario gets a fresh
// ctx, so decoys are tracked at module scope and reaped in afterEach too, or
// one outline row's processes are still alive during the next row's probe.
afterEach(() => {
  reapDecoys();
});

function spawnDecoy(argv) {
  const child = spawn('bash', ['-c', `exec -a ${JSON.stringify(argv)} sleep 600`], { stdio: 'ignore' });
  child.unref();
  liveDecoys.add(child);
  child.once('exit', () => liveDecoys.delete(child));
  return child;
}

/**
 * A role's processes, in the order a launched role acquires them: the claude
 * agent (what makes the role observed), the zsh launcher above it, then any
 * wrapper. A pack row asking for one process per role therefore gets the
 * agent, which is the role being up.
 */
function roleProcesses(root, role, count) {
  const dir = `${root}/.swarmforge/launch`;
  const all = [
    `claude --settings ${dir}/${role}.claude-settings.json`,
    `zsh ${dir}/${role}.sh`,
    ...Array.from({ length: 8 }, (_, i) => `node ${dir}/${role}.wrapper${i}.js`),
  ];
  return all.slice(0, count);
}

function ensureRoot(ctx) {
  if (!ctx.bl1250.root) {
    ctx.bl1250.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1250-root-'));
    fs.mkdirSync(path.join(ctx.bl1250.root, '.swarmforge', 'launch'), { recursive: true });
  }
  return ctx.bl1250.root;
}

function launchPack(ctx, roles, perRole) {
  const root = ensureRoot(ctx);
  ctx.bl1250.roles = roles;
  for (const role of roles) {
    for (const argv of roleProcesses(root, role, perRole)) spawnDecoy(argv);
  }
  // Let the process table catch up before ps reads it.
  spawnSync('sleep', ['0.3']);
}

function probe(ctx) {
  const env = { ...process.env };
  delete env.EXPEDITE_PROBE_FILE;
  const res = spawnSync('bb', [CLI, '--probe-liveness', ensureRoot(ctx)], {
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  if (res.status !== 0) {
    throw new Error(`expedite_cli --probe-liveness exited ${res.status}:\n${res.stdout}${res.stderr}`);
  }
  return JSON.parse(res.stdout.trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a recorded process table for a project root$/, (ctx) => {
    reapDecoys();
    ctx.bl1250 = { root: null, roles: [], expectedCount: null };
  });

  scoped(/^every role in the pack is running both its launcher and its agent$/, (ctx) => {
    launchPack(ctx, PACK, 2);
    ctx.bl1250.expectedCount = PACK.length;
  });

  scoped(/^every role in the pack is running its launcher$/, (ctx) => {
    const root = ensureRoot(ctx);
    ctx.bl1250.roles = PACK;
    for (const role of PACK) spawnDecoy(`zsh ${root}/.swarmforge/launch/${role}.sh`);
    spawnSync('sleep', ['0.2']);
  });

  scoped(/^two of the roles have no agent running$/, (ctx) => {
    const root = ensureRoot(ctx);
    // Every role BUT two also gets its agent; the two left with only the
    // launcher are the ones whose agent died.
    for (const role of PACK.slice(2)) {
      spawnDecoy(`claude --settings ${root}/.swarmforge/launch/${role}.claude-settings.json`);
    }
    spawnSync('sleep', ['0.3']);
    ctx.bl1250.missing = 2;
    ctx.bl1250.expectedCount = PACK.length - 2;
  });

  scoped(/^a pack of (\d+) roles each running (\d+) processes of its own$/, (ctx, roles, processes) => {
    const nRoles = Number(roles);
    const perRole = Number(processes);
    // KNOWN_VALUES for the outline: a row outside these bounds would silently
    // build a pack the fixture cannot express (there are only 8 named roles,
    // and roleProcesses tops out at 10).
    assert.ok(nRoles >= 1 && nRoles <= PACK.length, `bl1250: unsupported <roles> value "${roles}"`);
    assert.ok(perRole >= 1 && perRole <= 10, `bl1250: unsupported <processes> value "${processes}"`);
    launchPack(ctx, PACK.slice(0, nRoles), perRole);
    ctx.bl1250.expectedCount = nRoles;
  });

  scoped(/^a role process belonging to a different project root is also running$/, (ctx) => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1250-other-'));
    ctx.bl1250.otherRoot = otherRoot;
    // A whole neighbouring pack, not one stray process: the failure this
    // guards against (BL-782) counts every swarm on the host.
    for (const role of ['coder', 'qa', 'specifier']) {
      spawnDecoy(`zsh ${otherRoot}/.swarmforge/launch/${role}.sh`);
      spawnDecoy(`claude --settings ${otherRoot}/.swarmforge/launch/${role}.claude-settings.json`);
    }
    spawnSync('sleep', ['0.3']);
  });

  scoped(/^the expeditor probes the live set$/, (ctx) => {
    ctx.bl1250.probeResult = probe(ctx);
  });

  scoped(/^the observed role-agent count equals the number of roles in the pack$/, (ctx) => {
    const st = ctx.bl1250;
    assert.equal(
      st.probeResult['role-agents'],
      st.expectedCount,
      `expected ${st.expectedCount} role agents for ${st.roles.length} roles, got: ${JSON.stringify(st.probeResult)}`
    );
    reapDecoys();
  });

  scoped(/^the observed role-agent count is short by the two missing roles$/, (ctx) => {
    const st = ctx.bl1250;
    assert.equal(
      st.probeResult['role-agents'],
      PACK.length - st.missing,
      `expected ${PACK.length - st.missing} role agents with ${st.missing} agents dead, got: ${JSON.stringify(st.probeResult)}`
    );
  });

  scoped(/^the live-set delta is empty$/, (ctx) => {
    const st = ctx.bl1250;
    assert.equal(
      st.probeResult['role-agents'],
      8,
      `the expected live set says 8 role agents; the probe observed ${st.probeResult['role-agents']}`
    );
    reapDecoys();
  });

  scoped(/^the live-set delta is not empty$/, (ctx) => {
    const st = ctx.bl1250;
    assert.notEqual(
      st.probeResult['role-agents'],
      8,
      `a pack missing ${st.missing} agents reported the full 8 - the half-launch verdict is falsified`
    );
    reapDecoys();
  });
}

module.exports = { registerSteps };
