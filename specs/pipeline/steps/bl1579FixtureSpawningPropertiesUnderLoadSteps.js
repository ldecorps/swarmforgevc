'use strict';

// BL-1579: step handlers for "Two fixture-spawning property files are green
// under lane load" (specifier-authored feature, lands with this handler in
// the same parcel - BL-233, BL-1371). Scenario 01 drives the REAL property
// files as real vitest subprocesses (the bl1578SampledReachFloorsConstructedSteps.js
// shape) - never a reimplementation of their generators. Scenario 02 reads
// the REAL evidence file this parcel writes - never a restatement of its
// content in the handler.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1579 Two fixture-spawning property files are green under lane load';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const FILES = {
  'extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js': {
    rel: 'test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
    basename: 'bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
  },
  'extension/test/bl1323StampOffInvariants.property.test.js': {
    rel: 'test/bl1323StampOffInvariants.property.test.js',
    basename: 'bl1323StampOffInvariants.property.test.js',
  },
};

function runProperty(rel) {
  return spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', rel], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  });
}

function state(ctx, file) {
  const known = FILES[file];
  if (!known) {
    throw new Error(`unknown file example value: "${file}"`);
  }
  ctx.bl1579 = ctx.bl1579 || {};
  if (!ctx.bl1579[file]) {
    const result = runProperty(known.rel);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    ctx.bl1579[file] = { result, output };
  }
  return ctx.bl1579[file];
}

// Every evidence file this parcel could write for a given basename - either
// a "reproduced and fixed" file or a "retired, no repro" file. The handler
// reads whichever exists rather than assuming one shape (BL-1579's own
// acceptance criteria are disjunctive: fix-with-text OR retire-with-evidence).
function evidenceCandidates(basename) {
  return fs
    .readdirSync(EVIDENCE_DIR)
    .filter((f) => f.startsWith('BL-1579-') && f.endsWith('.md'))
    .map((f) => path.join(EVIDENCE_DIR, f))
    .filter((full) => fs.readFileSync(full, 'utf8').includes(basename));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each property file, run alone, is green ────────────────
  scoped(/^(.+) runs alone under the properties config$/, (ctx, file) => {
    state(ctx, file);
    ctx.bl1579lastFile = file;
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const files = Object.keys(ctx.bl1579 || {});
    for (const file of files) {
      const s = ctx.bl1579[file];
      assert.equal(s.result.status, 0, `expected ${file} to pass, got:\n${s.output.slice(-4000)}`);
    }
  });

  // ── Scenario 02: the parcel's evidence records the outcome per file ─────
  scoped(/^the parcel's evidence for (.+) is read$/, (ctx, file) => {
    const known = FILES[file];
    if (!known) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    const candidates = evidenceCandidates(known.basename);
    assert.ok(candidates.length > 0, `no BL-1579 evidence file mentions ${known.basename}`);
    ctx.bl1579evidence = ctx.bl1579evidence || {};
    ctx.bl1579evidence[file] = candidates.map((c) => fs.readFileSync(c, 'utf8')).join('\n---\n');
    ctx.bl1579lastEvidenceFile = file;
  });

  scoped(
    /^it records the failing test name and the assertion or timeout message verbatim from a lane run under concurrent load and the change that removed it, or it records at least 5 loaded lane runs and 20 runs alone all green and the register row retired on that evidence$/,
    (ctx) => {
      const file = ctx.bl1579lastEvidenceFile;
      const text = ctx.bl1579evidence[file];

      const firedRoute = /assertion|timeout/i.test(text) && /removed|fixed|remedy/i.test(text);
      const retiredRoute = /\b5\b.*loaded lane run/is.test(text) && /\b20\b.*(alone|runs alone)/is.test(text) && /retired/i.test(text);

      assert.ok(
        firedRoute || retiredRoute,
        `evidence for ${file} names neither a fired-and-fixed red nor a retired-on-green-runs outcome:\n${text.slice(0, 2000)}`,
      );
    },
  );
}

module.exports = { registerSteps };
