'use strict';

// BL-1227: the boot prefix budget gate must have a LIVE check that measures
// the real repository and can go red on later growth (BL-883 pinned the
// prior live scenario to its own fix commit, which is exactly why this
// overran a fourth time). Drives the real boot_prefix_budget_gate.sh /
// prompt_engine_lib.bb / boot_prefix_budget_gate_lib_test_runner.bb —
// never a re-implementation of the measurement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATE_SH = path.join(SWARMFORGE_SCRIPTS, 'boot_prefix_budget_gate.sh');
const PROMPT_ENGINE_LIB = path.join(SWARMFORGE_SCRIPTS, 'prompt_engine_lib.bb');
const LIVE_TEST_RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'boot_prefix_budget_gate_lib_test_runner.bb');
const SUITE_MANIFEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'suite-manifest.tsv');
const REFERENCE_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'reference');
const CONSTITUTION_ARTICLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles');
const PROJECT_PROMPT = path.join(CONSTITUTION_ARTICLES_DIR, 'project.prompt');

const FEATURE = 'The boot prefix budget is enforced by a check that measures the live repository';

function runGate(root) {
  const args = root ? [root] : [];
  const result = spawnSync('bash', [GATE_SH, ...args], { encoding: 'utf8' });
  return { stdout: (result.stdout || '').trim(), status: result.status };
}

function parseMeasuredSize(stdout) {
  const m = stdout.match(/ok — (\d+)\/\d+ chars|measured (\d+) chars/);
  if (!m) {
    throw new Error(`could not parse measured size from gate output: ${stdout}`);
  }
  return Number(m[1] || m[2]);
}

// Same calibration technique as bl859BootPrefixBudgetGateSteps.js: build an
// empty-article tree, read its baseline size from the gate's own output,
// then pad by the remaining delta so the tree lands on an exact target size.
function buildTreeOfExactSize(root, targetChars) {
  const articlesDir = path.join(root, 'swarmforge', 'constitution', 'articles');
  fs.mkdirSync(articlesDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'PIPELINE.md'), '');
  const articlePath = path.join(articlesDir, '01_article.md');
  fs.writeFileSync(articlePath, '');
  const baseline = parseMeasuredSize(runGate(root).stdout);
  const padLen = targetChars - baseline;
  if (padLen < 0) {
    throw new Error(`target ${targetChars} too small for this tree shape (baseline ${baseline})`);
  }
  fs.writeFileSync(articlePath, 'x'.repeat(padLen));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the stable boot prefix is composed through prompt-engine-lib's own composer$/, (ctx) => {
    ctx.bl1227 = {};
  });

  scoped(/^the repository at the BL-1227 fix commit$/, (ctx) => {
    // The real, current working-tree repository — this feature's own
    // acceptance run against it IS "the fix commit" state.
    ctx.bl1227.root = undefined;
  });

  scoped(/^the BL-1227 fix commit$/, (ctx) => {
    ctx.bl1227.root = undefined;
  });

  scoped(/^the stable prefix is composed from the real repository tree$/, (ctx) => {
    ctx.bl1227.result = runGate(undefined);
    ctx.bl1227.measured = parseMeasuredSize(ctx.bl1227.result.stdout);
  });

  scoped(/^the stable prefix length is at most (\d+) characters$/, (ctx, maxChars) => {
    assert.ok(
      ctx.bl1227.measured <= Number(maxChars),
      `expected measured size <= ${maxChars}, got ${ctx.bl1227.measured}`
    );
  });

  scoped(/^the budget gate exits 0$/, (ctx) => {
    assert.equal(ctx.bl1227.result.status, 0, `expected gate exit 0:\n${ctx.bl1227.result.stdout}`);
  });

  // ── scenario 03: non-vacuity across a range of synthetic sizes ───────────

  scoped(/^a constitution tree whose composed prefix is (\d+) characters$/, (ctx, chars) => {
    ctx.bl1227.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1227-synthetic-'));
    buildTreeOfExactSize(ctx.bl1227.root, Number(chars));
  });

  scoped(/^the live budget check runs against that tree$/, (ctx) => {
    ctx.bl1227.result = runGate(ctx.bl1227.root);
  });

  scoped(/^the check exits (\d+)$/, (ctx, expectedExit) => {
    assert.equal(
      ctx.bl1227.result.status,
      Number(expectedExit),
      `expected exit ${expectedExit}, got ${ctx.bl1227.result.status}: ${ctx.bl1227.result.stdout}`
    );
  });

  scoped(/^a failing report states the measured size and the 44000 budget$/, (ctx) => {
    if (ctx.bl1227.result.status === 0) {
      return; // nothing to check on the passing row
    }
    const measured = parseMeasuredSize(ctx.bl1227.result.stdout);
    assert.ok(ctx.bl1227.result.stdout.includes(String(measured)), ctx.bl1227.result.stdout);
    assert.ok(ctx.bl1227.result.stdout.includes('44000'), ctx.bl1227.result.stdout);
  });

  // ── scenario 04: no normative rule text lost ──────────────────────────────

  scoped(/^a passage removed from a boot-inlined article by the BL-1227 fix commit$/, (ctx) => {
    // A representative passage this ticket's own commit moved verbatim —
    // Article 3.6's CLI-path bullet, distinctive enough that a false match
    // elsewhere in the tree would itself be a real defect.
    ctx.bl1227.passage =
      'until then the coordinator uses the checklist in\n  `coordinator.prompt`. CLI failure fails closed — same posture as BL-262.';
    ctx.bl1227.slimArticle = path.join(CONSTITUTION_ARTICLES_DIR, '03_backlog.md');
    ctx.bl1227.pointerFile = '03-backlog-detailed.md';
  });

  scoped(/^the reference directory is searched for that passage$/, (ctx) => {
    const files = fs.readdirSync(REFERENCE_DIR).filter((f) => fs.statSync(path.join(REFERENCE_DIR, f)).isFile());
    ctx.bl1227.matches = files.filter((f) => fs.readFileSync(path.join(REFERENCE_DIR, f), 'utf8').includes(ctx.bl1227.passage));
  });

  scoped(/^the passage appears verbatim in exactly one file under the reference directory$/, (ctx) => {
    assert.equal(
      ctx.bl1227.matches.length,
      1,
      `expected exactly one reference/ file containing the passage, got: ${JSON.stringify(ctx.bl1227.matches)}`
    );
  });

  scoped(/^the slim article retains a pointer naming that file$/, (ctx) => {
    const slimText = fs.readFileSync(ctx.bl1227.slimArticle, 'utf8');
    assert.ok(
      slimText.includes(ctx.bl1227.pointerFile),
      `expected ${ctx.bl1227.slimArticle} to point at ${ctx.bl1227.pointerFile}`
    );
    assert.equal(ctx.bl1227.matches[0], ctx.bl1227.pointerFile);
  });

  // ── scenario 05: reachable without hand-invocation ────────────────────────

  scoped(/^the standing verification entry point runs$/, (ctx) => {
    const manifest = fs.readFileSync(SUITE_MANIFEST, 'utf8');
    const row = manifest
      .split('\n')
      .find((l) => l.startsWith('boot_prefix_budget_gate_lib_test_runner.bb\t'));
    assert.ok(row, 'expected boot_prefix_budget_gate_lib_test_runner.bb to be listed in suite-manifest.tsv');
    assert.match(row, /\tstanding\t/, `expected the "standing" lane, got: ${row}`);

    const clean = execFileSync('bb', [LIVE_TEST_RUNNER], { encoding: 'utf8' });
    ctx.bl1227.entryPointCleanOutput = clean;
    ctx.bl1227.entryPointCleanStatus = 0;
  });

  scoped(/^the live budget check against the real repository is among the checks it runs$/, (ctx) => {
    assert.match(
      ctx.bl1227.entryPointCleanOutput,
      /LIVE repo's boot prefix is at or under/,
      ctx.bl1227.entryPointCleanOutput
    );
    assert.match(ctx.bl1227.entryPointCleanOutput, /ALL PASS/, ctx.bl1227.entryPointCleanOutput);
  });

  scoped(/^an over-budget real repository makes that entry point report failure$/, () => {
    const original = fs.readFileSync(PROJECT_PROMPT, 'utf8');
    fs.appendFileSync(PROJECT_PROMPT, 'x'.repeat(3000));
    try {
      const result = spawnSync('bb', [LIVE_TEST_RUNNER], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `expected the entry point to fail over budget:\n${result.stdout}${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /LIVE repo's boot prefix/);
    } finally {
      fs.writeFileSync(PROJECT_PROMPT, original);
    }
  });
}

module.exports = { registerSteps };
