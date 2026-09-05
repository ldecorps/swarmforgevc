'use strict';

// BL-1427: step handlers driving the REAL check_bb_scripts_load.sh (BL-1395)
// against a fixture tree, never a reimplementation of its probe/loop logic.
// Every scenario builds <tree-root>/swarmforge/scripts holding ONLY fixture
// scripts and runs the guard with `--all` ("examines the whole tree").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bb_scripts_load.sh');

const FEATURE = 'BL-1427 The load guard covers every script it lists and runs none of them';

function mkFixtureTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1427-fixture-'));
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  return { root, scriptsDir };
}

function writeScript(scriptsDir, basename, body) {
  fs.writeFileSync(path.join(scriptsDir, basename), body);
}

function runGuard(root) {
  return spawnSync('bash', [GUARD, root, '--all'], { encoding: 'utf8' });
}

let currentRoot = null;
afterEach(() => {
  if (currentRoot) {
    fs.rmSync(currentRoot, { recursive: true, force: true });
    currentRoot = null;
  }
});

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture tree whose swarmforge scripts directory holds only fixture scripts$/, (ctx) => {
    ctx.bl1427 = mkFixtureTree();
    currentRoot = ctx.bl1427.root;
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^a fixture script that reads stdin when it loads$/, (ctx) => {
    writeScript(
      ctx.bl1427.scriptsDir,
      'aaa_stdin_reader.bb',
      "(ns aaa-stdin-reader)\n(def _slurped (slurp *in*))\n"
    );
  });

  scoped(/^a fixture script sorted after it whose body has a reader error$/, (ctx) => {
    ctx.bl1427.laterFile = 'zzz_reader_error.bb';
    writeScript(ctx.bl1427.scriptsDir, ctx.bl1427.laterFile, "(ns zzz-reader-error)\n(defn broken [] (+ 1 2}\n");
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^four loadable fixture scripts and nothing else$/, (ctx) => {
    for (let i = 1; i <= 4; i += 1) {
      writeScript(ctx.bl1427.scriptsDir, `loadable_${i}.bb`, `(ns loadable-${i})\n(def x ${i})\n`);
    }
  });

  // ── Shared When/Then across scenarios 01/02 ─────────────────────────────
  scoped(/^the script load guard examines the whole tree$/, (ctx) => {
    ctx.bl1427.result = runGuard(ctx.bl1427.root);
  });

  scoped(/^the guard refuses naming the later script$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1427.result;
    const all = `${stdout}\n${stderr}`;
    if (status === 0) {
      throw new Error(`expected the guard to refuse, got exit 0: ${all}`);
    }
    if (!all.includes(ctx.bl1427.laterFile)) {
      throw new Error(`expected the refusal to name ${ctx.bl1427.laterFile}: ${all}`);
    }
  });

  scoped(/^the guard passes reporting four scripts analysed$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1427.result;
    const all = `${stdout}\n${stderr}`;
    if (status !== 0) {
      throw new Error(`expected the guard to pass, got exit ${status}: ${all}`);
    }
    if (!/\b4 changed Babashka script\(s\) analysed/.test(stdout)) {
      throw new Error(`expected the pass line to report 4 analysed, got: ${stdout}`);
    }
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  const ENTRY_EXAMPLES = {
    '(apply -main *command-line-args*)': '(apply -main *command-line-args*)',
    '(-main)': '(-main)',
    '(-main *command-line-args*)': '(-main *command-line-args*)',
  };

  scoped(/^a loadable fixture CLI whose -main writes a marker file and whose last form is (.+)$/, (ctx, entryToken) => {
    if (!Object.prototype.hasOwnProperty.call(ENTRY_EXAMPLES, entryToken)) {
      throw new Error(`unknown <entry>: ${entryToken}`);
    }
    ctx.bl1427.marker = path.join(ctx.bl1427.root, 'marker.txt');
    const body =
      `(ns marker-cli)\n` +
      `(defn -main [& args] (spit ${JSON.stringify(ctx.bl1427.marker)} "ran"))\n` +
      `${ENTRY_EXAMPLES[entryToken]}\n`;
    writeScript(ctx.bl1427.scriptsDir, 'marker_cli.bb', body);
  });

  scoped(/^the guard passes$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1427.result;
    if (status !== 0) {
      throw new Error(`expected the guard to pass, got exit ${status}: ${stdout}\n${stderr}`);
    }
  });

  scoped(/^the marker file was never written$/, (ctx) => {
    if (fs.existsSync(ctx.bl1427.marker)) {
      throw new Error(`expected ${ctx.bl1427.marker} to not exist - the entry call must never run`);
    }
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────
  scoped(/^a fixture CLI whose -main calls a function defined nowhere and whose last form is an apply of -main$/, (ctx) => {
    writeScript(
      ctx.bl1427.scriptsDir,
      'broken_cli.bb',
      "(ns broken-cli)\n(defn -main [& args] (this-symbol-does-not-exist-anywhere))\n(apply -main *command-line-args*)\n"
    );
  });

  scoped(/^the guard refuses naming the file and the unresolved symbol$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1427.result;
    const all = `${stdout}\n${stderr}`;
    if (status === 0) {
      throw new Error(`expected the guard to refuse, got exit 0: ${all}`);
    }
    if (!all.includes('broken_cli.bb')) {
      throw new Error(`expected the refusal to name broken_cli.bb: ${all}`);
    }
    if (!all.includes('this-symbol-does-not-exist-anywhere')) {
      throw new Error(`expected the refusal to name the unresolved symbol: ${all}`);
    }
  });
}

module.exports = { registerSteps };
