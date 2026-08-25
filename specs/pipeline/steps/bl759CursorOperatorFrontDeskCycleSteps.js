'use strict';

// BL-759: Cursor-operator ↔ front-desk import cycle broken. Drives the REAL
// dependency-gate and the extracted drain helpers — no semantics change.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The Cursor-operator modules no longer cycle back into the front-desk bot';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO, 'extension');
const GATE = path.join(EXT, 'out', 'tools', 'dependency-gate.js');
const {
  isPipelineEmpty,
  resolveLiveRoles,
} = require(path.join(EXT, 'out', 'tools', 'telegramPipelineDrain'));
const { controlDrainTimeoutMs } = require(path.join(EXT, 'out', 'tools', 'telegramControlCore'));

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runGate(args = []) {
  const r = spawnSync('node', [GATE, ...args], { cwd: EXT, encoding: 'utf8' });
  return {
    status: r.status,
    out: (r.stdout || '') + (r.stderr || ''),
  };
}

function collectResolvedImports(moduleFile) {
  // Follows static require/import edges from compiled out/ via a small node walk.
  const start = path.join(EXT, 'out', 'tools', moduleFile.replace(/\.ts$/, '.js'));
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) {
      continue;
    }
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    const re = /require\("(\.[^"]+)"\)/g;
    let m;
    while ((m = re.exec(text))) {
      const next = path.normalize(path.join(path.dirname(file), m[1] + (m[1].endsWith('.js') ? '' : '.js')));
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen].map((f) => path.relative(path.join(EXT, 'out', 'tools'), f));
}

function mkSwarm(parcels) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl759-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  // Column order matches swarmState.parseRolesTsv / telegramFrontDeskBotCli fixtures.
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${root}\t_\tcoder\tclaude\n`
  );
  const newDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  const inProc = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(newDir, { recursive: true });
  fs.mkdirSync(inProc, { recursive: true });
  if (parcels === "a parcel in one role's inbox/new") {
    fs.writeFileSync(path.join(newDir, 'x.handoff'), 'type: awake\nto: coder\npriority: 50\n');
  } else if (parcels === "a parcel in one role's in_process") {
    fs.writeFileSync(path.join(inProc, 'x.handoff'), 'type: awake\nto: coder\npriority: 50\n');
  }
  return root;
}

function registerSteps(registry) {
  scoped(registry, /^this repository's own sources and its pinned dependency-rule ruleset$/, (ctx) => {
    ctx.repo = REPO;
    assert.ok(fs.existsSync(GATE), 'dependency-gate.js missing — compile first');
  });

  scoped(registry, /^the dependency-rule gate is run over the whole repository$/, (ctx) => {
    ctx.gate = runGate();
  });

  scoped(registry, /^the gate passes with no forbidden edge reported$/, (ctx) => {
    assert.equal(ctx.gate.status, 0, ctx.gate.out);
    assert.match(ctx.gate.out, /PASSED/);
    assert.doesNotMatch(ctx.gate.out, /FAILED/);
  });

  scoped(registry, /^the resolved imports of (.+) are collected, following re-exports$/, (ctx, module) => {
    ctx.imports = collectResolvedImports(module.trim());
  });

  scoped(registry, /^the front-desk bot module is not among them$/, (ctx) => {
    const hit = ctx.imports.some((f) => f.includes('telegram-front-desk-bot'));
    assert.equal(hit, false, `front-desk bot found in imports: ${ctx.imports.join(', ')}`);
  });

  scoped(registry, /^a swarm whose live roles hold (.+)$/, (ctx, parcels) => {
    ctx.swarmRoot = mkSwarm(parcels);
    ctx.parcels = parcels;
  });

  scoped(registry, /^a drain-stop checks whether any parcel is still in flight$/, (ctx) => {
    ctx.empty = isPipelineEmpty(ctx.swarmRoot);
  });

  scoped(registry, /^pipeline emptiness reports (.+)$/, (ctx, verdict) => {
    if (verdict === 'empty') {
      assert.equal(ctx.empty, true);
    } else if (verdict === 'not empty') {
      assert.equal(ctx.empty, false);
    } else {
      throw new Error(`unknown verdict ${verdict}`);
    }
  });

  scoped(registry, /^the drain-timeout environment variable is (.+)$/, (ctx, envValue) => {
    ctx.envValue = envValue === 'unset' ? undefined : envValue;
  });

  scoped(registry, /^a drain-stop works out how long it may keep waiting$/, (ctx) => {
    ctx.timeout = controlDrainTimeoutMs(ctx.envValue);
  });

  scoped(registry, /^the resolved drain timeout is (.+)$/, (ctx, timeoutText) => {
    if (timeoutText === 'the 10-minute default') {
      assert.equal(ctx.timeout, 10 * 60 * 1000);
    } else if (timeoutText === '5000 ms') {
      assert.equal(ctx.timeout, 5000);
    } else {
      throw new Error(`unknown timeout text ${timeoutText}`);
    }
  });
}

module.exports = { registerSteps };
