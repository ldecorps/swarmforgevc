'use strict';

// BL-534: thin-main CRAP-visible CLI gate acceptance steps.
// Drives the REAL compiled thin-main-gate.js against scratch fixtures.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-534 thin-main CRAP-visible CLI gate';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_JS = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'thin-main-gate.js');

function ensure(ctx) {
  if (!ctx.bl534) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl534-thin-main-'));
    fs.mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'bridge'), { recursive: true });
    ctx.bl534 = { root, report: '', status: null };
  }
  return ctx.bl534;
}

function cleanup(ctx) {
  const st = ctx.bl534;
  if (!st?.root) return;
  fs.rmSync(st.root, { recursive: true, force: true });
  st.root = null;
}

function writeToolsMain(ctx, name, body) {
  const st = ensure(ctx);
  const filePath = path.join(st.root, 'src', 'tools', name);
  fs.writeFileSync(filePath, body);
  st.target = filePath;
  return filePath;
}

function runGateWithRoot(ctx, modeArgs) {
  const st = ensure(ctx);
  const script = `
    const gate = require(${JSON.stringify(GATE_JS)});
    const args = ${JSON.stringify(modeArgs)};
    const parsed = gate.parseArgs(args);
    const outcome = gate.runThinMainGate(parsed, ${JSON.stringify(st.root)});
    if (outcome.text) process.stdout.write(outcome.text + '\\n');
    process.exit(outcome.exitCode);
  `;
  const result = spawnSync('node', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  st.status = result.status;
  st.report = `${result.stdout || ''}${result.stderr || ''}`;
  return st;
}

function fatMain() {
  return `export function main(): void {
  if (process.argv.length > 1) {
    if (process.env.X) {
      console.log('fat');
    }
  }
}
`;
}

function thinMain() {
  return `export function main(): void {
  console.log('thin');
}
`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a TypeScript tools file under extension\/src\/tools\/ whose exported main has cyclomatic complexity (greater than 2|at most 2)$/,
    (ctx, complexity) => {
      const st = ensure(ctx);
      st.complexity = complexity;
      const body = complexity === 'greater than 2' ? fatMain() : thinMain();
      writeToolsMain(ctx, 'fixture-main.ts', body);
    }
  );

  scoped(/^the thin-main gate runs in parcel mode on that path$/, (ctx) => {
    const st = ensure(ctx);
    runGateWithRoot(ctx, [st.target]);
  });

  scoped(/^the gate exit code is ([01])$/, (ctx, exit) => {
    const st = ensure(ctx);
    assert.equal(st.status, Number(exit), `report:\n${st.report}`);
  });

  scoped(/^the report names that file and main$/, (ctx) => {
    const st = ensure(ctx);
    try {
      assert.match(st.report, /fixture-main\.ts/);
      assert.match(st.report, /main/);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the report does not flag that thin main$/, (ctx) => {
    const st = ensure(ctx);
    try {
      assert.doesNotMatch(st.report, /fixture-main\.ts/);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a host-layer TypeScript module path under extension\/src\/bridge\/$/, (ctx) => {
    const st = ensure(ctx);
    const bridgePath = path.join(st.root, 'src', 'bridge', 'host.ts');
    fs.writeFileSync(bridgePath, fatMain());
    st.target = bridgePath;
  });

  scoped(/^the report stays empty for that path$/, (ctx) => {
    const st = ensure(ctx);
    assert.doesNotMatch(st.report, /host\.ts/);
  });

  scoped(/^the process status is success$/, (ctx) => {
    const st = ensure(ctx);
    try {
      assert.equal(st.status, 0, st.report);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(
    /^extension\/thin-main-allowlist\.txt lists the basename of a tools file whose main is non-thin$/,
    (ctx) => {
      const st = ensure(ctx);
      writeToolsMain(ctx, 'grandfathered.ts', fatMain());
      writeToolsMain(ctx, 'fresh-fat.ts', fatMain());
      fs.writeFileSync(path.join(st.root, 'thin-main-allowlist.txt'), 'grandfathered.ts\n');
    }
  );

  scoped(/^the thin-main gate scans the full tools tree$/, (ctx) => {
    runGateWithRoot(ctx, []);
  });

  scoped(/^that allowlisted file does not cause a non-zero exit by itself$/, (ctx) => {
    const st = ensure(ctx);
    // Re-run with only the allowlisted file present.
    fs.rmSync(path.join(st.root, 'src', 'tools', 'fresh-fat.ts'), { force: true });
    runGateWithRoot(ctx, []);
    assert.equal(st.status, 0, st.report);
    assert.doesNotMatch(st.report, /grandfathered\.ts/);
  });

  scoped(/^a non-allowlisted non-thin main still fails the gate$/, (ctx) => {
    const st = ensure(ctx);
    try {
      writeToolsMain(ctx, 'fresh-fat.ts', fatMain());
      runGateWithRoot(ctx, []);
      assert.notEqual(st.status, 0, st.report);
      assert.match(st.report, /fresh-fat\.ts/);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
