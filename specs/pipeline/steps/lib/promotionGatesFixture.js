'use strict';

// BL-1083: stands the REAL promotion gates up inside a fixture root.
//
// promoteToActive now takes its verdict from promotion_gates_cli.bb, and it
// fails CLOSED - a gate that fails open is not a gate. So any fixture that
// expects a promotion to succeed has to carry the gate, and any fixture that
// wants to watch a refusal has to carry it too.
//
// The copy list is DERIVED from the CLI's own transitive load-file closure
// (BL-973's helper), never written out by hand. Five hand-maintained copy
// lists drifted three times and reddened two acceptance features and a shell
// test; adding a sixth the same day that was fixed would be a poor joke.
//
// One helper, three consumers (bl490 and bl721's step handlers, and
// extension/test/backlogWriter.test.js) rather than three near-identical
// setups - the fixture is the same shape in all three, and a divergence
// between them would show up as one feature mysteriously passing.

const fs = require('node:fs');
const path = require('node:path');
const { computeClosure } = require('./operatorRuntimeBbClosure.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// The entry point the mover actually shells to. Everything it needs follows
// from this one name.
const GATE_ENTRY_POINT = 'promotion_gates_cli.bb';

/**
 * @param {string} targetPath  fixture root
 * @param {{maxDepth?: number}} [opts]  the cap the gates evaluate against;
 *   generous by default so a fixture that is not about the cap never trips it
 * @returns {string} targetPath, for chaining
 */
function installPromotionGates(targetPath, opts) {
  const maxDepth = opts && typeof opts.maxDepth === 'number' ? opts.maxDepth : 50;
  const scriptsDir = path.join(targetPath, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of computeClosure(REAL_SCRIPTS_DIR, GATE_ENTRY_POINT)) {
    const src = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
  }
  fs.writeFileSync(
    path.join(targetPath, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth ${maxDepth}\n`
  );
  // The gates read backlog/done/ for depends_on and backlog/active/ for the
  // depth count. A fixture missing either is testing a shape no real root has.
  fs.mkdirSync(path.join(targetPath, 'backlog', 'done'), { recursive: true });
  fs.mkdirSync(path.join(targetPath, 'backlog', 'active'), { recursive: true });
  return targetPath;
}

module.exports = { installPromotionGates, GATE_ENTRY_POINT, REAL_SCRIPTS_DIR };
