'use strict';

// BL-1902: step handlers for "Reverse-hop copies and QA's merge-up broadcast
// retire: the live pack declares no back-one or back-all window, and the
// ceremony library composes no merge-up note, so a parcel's forward and QA's
// approval wake only the role that acts (roles on parcel lines merge neither)".
//
// The scenarios read the live pack and the live ceremony library directly.
// No fixture, no CLI driver: the pack conf and the .bb lib are the artifacts
// under test, and reading them is the acceptance check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  "BL-1902 Reverse-hop copies and QA's merge-up broadcast retire";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PACK_CONF = path.join(REPO_ROOT, 'swarmforge', 'packs', 'full-forge.conf');
const CEREMONY_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ceremony_handoff_lib.bb');

function readWindowLines() {
  const text = fs.readFileSync(PACK_CONF, 'utf8');
  return text.split('\n').filter((l) => l.startsWith('window '));
}

function ceremonyNames() {
  const out = execFileSync('bb', ['-e', `(load-file "${CEREMONY_LIB}") (println (clojure.string/join " " (sort (ceremony-handoff-lib/ceremony-names))))`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  return out.trim().split(/\s+/).filter(Boolean);
}

function composeBookkeep(ticket, commit) {
  const out = execFileSync(
    'bb',
    ['-e', `(load-file "${CEREMONY_LIB}") (let [{:keys [draft error]} (ceremony-handoff-lib/compose {:ceremony "bookkeep" :ticket "${ticket}" :commit "${commit}"})] (if error (println (str "ERROR: " error)) (println draft)))`],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 }
  );
  return out.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 1: the live pack declares no reverse hop ──────────────────

  scoped(/^the window lines of swarmforge\/packs\/full-forge\.conf are read$/, (ctx) => {
    ctx.bl1902 = { windows: readWindowLines() };
  });

  scoped(/^no window declares back-one or back-all$/, (ctx) => {
    const { windows } = ctx.bl1902;
    for (const w of windows) {
      assert.ok(
        !w.includes('back-one') && !w.includes('back-all'),
        `a window still declares a reverse hop: ${w}`
      );
    }
  });

  scoped(/^the pack still declares its 8 role windows$/, (ctx) => {
    const { windows } = ctx.bl1902;
    assert.equal(
      windows.length,
      8,
      `expected 8 role windows, found ${windows.length}: ${windows.join('\n')}`
    );
  });

  // ── Scenario 2: the ceremony library composes no merge-up ──────────────

  scoped(/^the ceremony handoff library lists its ceremonies$/, (ctx) => {
    ctx.bl1902 = { names: ceremonyNames() };
  });

  scoped(/^it lists no merge-up ceremony$/, (ctx) => {
    const { names } = ctx.bl1902;
    assert.ok(
      !names.includes('merge-up'),
      `the ceremony library still defines merge-up: ${names.join(', ')}`
    );
  });

  scoped(/^the bookkeep ceremony still composes the coordinator's note for a ticket and commit$/, (ctx) => {
    const draft = composeBookkeep('BL-042', 'a1b2c3d4e5');
    assert.ok(!draft.startsWith('ERROR'), `bookkeep compose failed: ${draft}`);
    assert.ok(draft.includes('type: note'), `the bookkeep draft is not a note:\n${draft}`);
    assert.ok(draft.includes('to: coordinator'), `the bookkeep draft does not go to the coordinator:\n${draft}`);
    assert.ok(draft.includes('priority: 00'), `the bookkeep draft is not priority 00:\n${draft}`);
    assert.ok(draft.includes('BL-042'), `the bookkeep message does not name the ticket:\n${draft}`);
    assert.ok(draft.includes('a1b2c3d4e5'), `the bookkeep message does not name the commit:\n${draft}`);
  });
}

module.exports = { registerSteps };
