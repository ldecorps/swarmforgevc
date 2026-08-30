'use strict';

// BL-1277 acceptance: two step files registering the same step text unscoped
// make the earlier-loading one answer that text for BOTH features. These
// handlers drive the SAME guard core the vitest lane and the property lane
// drive (extension/test/helpers/stepCollisionGuard.js) - never a restatement
// of its rule, which is what invariant 2 forbids.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'stepCollisionGuard.js');
const TMP = path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'tmpDir.js');

const FEATURE_NAME = "BL-1277 no step file answers another feature's steps by accident";

// Scenario Outline placeholders are validated against explicit known values,
// never passed through: an Examples row that drifts to text no handler
// understands must fail loudly rather than silently exercise nothing.
const KNOWN_SCOPINGS = new Set(['unscoped', 'scoped to its own feature']);
const KNOWN_VERDICTS = new Set(['refuses', 'passes']);

function stepFileSource(text, scoping) {
  const pattern = `/^${text}$/`;
  const registration =
    scoping === 'unscoped'
      ? `registry.define(${pattern}, () => {});`
      : `registry.defineScoped(${pattern}, () => {}, 'a feature of its own');`;
  return `'use strict';\nmodule.exports = { registerSteps(registry) { ${registration} } };\n`;
}

function workRoot(ctx) {
  if (!ctx.bl1277) {
    const { mkSharedTmpDir } = require(TMP);
    ctx.bl1277 = { root: mkSharedTmpDir('bl1277-acceptance-'), files: [] };
  }
  return ctx.bl1277.root;
}

function writeStepFile(ctx, text, scoping) {
  assert.ok(KNOWN_SCOPINGS.has(scoping), `unknown scoping example value "${scoping}"`);
  const root = workRoot(ctx);
  const file = path.join(root, `step${ctx.bl1277.files.length}Steps.js`);
  fs.writeFileSync(file, stepFileSource(text, scoping));
  ctx.bl1277.files.push(file);
  return file;
}

// No vitest sweep runs here, so the temp tree is removed by this file, on
// every path that created one (BL-420/BL-971).
function discard(ctx) {
  if (ctx.bl1277 && ctx.bl1277.root) {
    fs.rmSync(ctx.bl1277.root, { recursive: true, force: true });
    ctx.bl1277.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^a step file registers the step text "(.+)" unscoped$/, (ctx, text) => {
    writeStepFile(ctx, text, 'unscoped');
  });

  scoped(/^a second step file registers the step text "(.+)" (.+)$/, (ctx, text, scoping) => {
    writeStepFile(ctx, text, scoping);
  });

  scoped(/^three step files each register the step text "(.+)" unscoped$/, (ctx, text) => {
    for (let i = 0; i < 3; i += 1) {
      writeStepFile(ctx, text, 'unscoped');
    }
  });

  scoped(/^the step files this repository actually ships$/, (ctx) => {
    ctx.bl1277 = { root: null, files: null, shipped: true };
  });

  scoped(/^the step-file collision guard runs$/, (ctx) => {
    const guard = require(GUARD);
    // The shipped case goes through the child-process entry point, because
    // that is how the standing unit guard runs it; the synthetic cases run
    // in-process. Same collisionVerdict either way.
    ctx.bl1277.verdict = ctx.bl1277.shipped
      ? guard.shippedCollisionVerdict()
      : guard.collisionVerdict(ctx.bl1277.files);
    discard(ctx);
  });

  scoped(/^the guard (.+)$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown verdict example value "${verdict}"`);
    const { ok, message } = ctx.bl1277.verdict;
    if (verdict === 'passes') {
      assert.equal(ok, true, `expected the guard to pass, got:\n${message}`);
    } else {
      assert.equal(ok, false, 'expected the guard to refuse, but it passed');
    }
  });

  scoped(/^the refusal names the step text "(.+)"$/, (ctx, text) => {
    const { message } = ctx.bl1277.verdict;
    assert.ok(message.includes(`^${text}$`), `refusal does not name "${text}":\n${message}`);
  });

  scoped(/^the refusal names all three step files$/, (ctx) => {
    const { message, collisions } = ctx.bl1277.verdict;
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].files.length, 3);
    for (const file of collisions[0].files) {
      assert.ok(message.includes(file), `refusal does not name ${file}:\n${message}`);
    }
  });
}

module.exports = { registerSteps };
