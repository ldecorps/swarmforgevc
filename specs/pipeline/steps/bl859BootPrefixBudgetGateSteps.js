'use strict';

// BL-859: step handlers for the boot-prefix budget gate feature. Drives the
// real boot_prefix_budget_gate.sh / prompt_engine_lib.bb directly - never a
// re-implementation of the measurement. Synthetic constitution trees live
// under a fresh tmp dir per scenario (never the real repo tree), per the
// ticket's injected-tree-root testability invariant.
//
// BL-654 stated reason (invariant 2 - "the gate is testable against a
// synthetic constitution tree ... via an injected tree root - no
// *_FORCE_RESULT env bypass and no process.chdir"): this invariant admits no
// fast-check property-test encoding. A property test quantifies a claim over
// a GENERATED state space; this invariant instead constrains the SHAPE of
// the implementation itself - that testability is achieved by parameter
// injection, not by an environment-variable bypass or a cwd mutation. There
// is no varying input to generate over; the claim is true or false by
// construction, once. That is exactly BL-654's non-encodability hatch (an
// invariant that quantifies over process/shape, not a pure module's
// input->output behavior) - the same shape as BL-715's precedent for this
// exact kind of invariant.
//
// The substitute is what this file (and boot_prefix_budget_gate_lib_test_
// runner.bb) demonstrate structurally: every scenario above drives the gate
// against an explicit synthetic root parameter (buildTreeOfExactSize's
// tmp dir), never a real-repo mutation, no `*_FORCE_RESULT` env var appears
// anywhere in boot_prefix_budget_gate_lib.bb/.bb CLI/this file, and no
// `process.chdir`/`cd` call is made to redirect the gate at a fixture - the
// root is always an explicit argument threaded through measure()/verdict().
// Invariant 1 (measured through the same composer, never re-derived) has its
// own generated-state-space property test in
// boot_prefix_budget_gate_property_runner.bb, which is the invariant that
// DOES admit a fast-check encoding.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const GATE_SH = path.join(SWARMFORGE_SCRIPTS, 'boot_prefix_budget_gate.sh');
const PROMPT_ENGINE_LIB = path.join(SWARMFORGE_SCRIPTS, 'prompt_engine_lib.bb');
const SPECIFIER_PROMPT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'roles', 'specifier.prompt');

// "the specifier role prompt" is a common Given across prose-content tickets
// (bl633, bl654, bl680, bl681); registry.resolve()'s unscoped fallback
// returns the first match in registration order, so an unscoped registration
// here would never fire. Scoped to THIS feature's title (bl680/bl681's
// precedent for the same collision), it wins only when this feature runs.
const FEATURE_NAME = 'A boot-prefix budget gate the specifier runs before committing an amendment';

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-boot-prefix-budget-'));
  }
  return ctx.targetPath;
}

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

// Calibrates against the REAL gate script (never a hand-derived join
// arithmetic) so a synthetic tree lands on an exact target size: build an
// empty-article tree, read its baseline size from the gate's own output,
// then pad one article file by the remaining delta.
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
  // ── budget-verdict-01: verdict follows the measured size ─────────────────
  registry.define(/^a constitution tree whose boot prefix measures (\d+) characters$/, (ctx, chars) => {
    ensureTargetPath(ctx);
    buildTreeOfExactSize(ctx.targetPath, Number(chars));
  });

  registry.define(/^the boot prefix budget gate runs$/, (ctx) => {
    ctx.gateResult = runGate(ctx.targetPath);
  });

  registry.define(/^the gate exits (\d+)$/, (ctx, expectedExit) => {
    if (ctx.gateResult.status !== Number(expectedExit)) {
      throw new Error(
        `expected gate exit ${expectedExit}, got ${ctx.gateResult.status}: ${ctx.gateResult.stdout}`
      );
    }
  });

  // ── measures-what-boot-composes-02 ────────────────────────────────────────
  registry.define(/^the constitution tree as it stands in the repository$/, (ctx) => {
    ctx.targetPath = undefined; // no root arg -> the gate measures the real repo
  });

  registry.define(/^the size it reports equals the stable prefix length the prompt engine composes$/, (ctx) => {
    const result = ctx.gateResult || runGate(undefined);
    const reported = parseMeasuredSize(result.stdout);
    const oracle = Number(
      execFileSync('bb', ['-e', `(load-file "${PROMPT_ENGINE_LIB}") (println (count (prompt-engine-lib/stable-prefix-text)))`], {
        encoding: 'utf8',
      }).trim()
    );
    if (reported !== oracle) {
      throw new Error(`gate reported ${reported} chars but prompt_engine_lib/stable-prefix-text measures ${oracle}`);
    }
  });

  // ── reference-bodies-excluded-03 ──────────────────────────────────────────
  registry.define(/^a constitution tree with a reference file under "([^"]+)"$/, (ctx, refRelPath) => {
    ensureTargetPath(ctx);
    buildTreeOfExactSize(ctx.targetPath, 500);
    ctx.withoutRefSize = parseMeasuredSize(runGate(ctx.targetPath).stdout);
    const refDir = path.join(ctx.targetPath, refRelPath);
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'deep.md'), 'x'.repeat(5000));
  });

  registry.define(/^the reported size excludes that reference file's body$/, (ctx) => {
    const withRefSize = parseMeasuredSize(ctx.gateResult.stdout);
    if (withRefSize !== ctx.withoutRefSize) {
      throw new Error(
        `expected the reference/ file to be excluded (size unchanged at ${ctx.withoutRefSize}), got ${withRefSize}`
      );
    }
  });

  // ── actionable-remedy-04 ──────────────────────────────────────────────────
  registry.define(/^a constitution tree (\d+) characters over the budget$/, (ctx, overBy) => {
    ensureTargetPath(ctx);
    const BUDGET = 44000;
    buildTreeOfExactSize(ctx.targetPath, BUDGET + Number(overBy));
    ctx.over = Number(overBy);
  });

  registry.define(/^the gate output states the measured size, the budget, and the number of characters to move$/, (ctx) => {
    const { stdout } = ctx.gateResult;
    const measured = 44000 + ctx.over;
    for (const expected of [String(measured), '44000', String(ctx.over)]) {
      if (!stdout.includes(expected)) {
        throw new Error(`expected gate output to include "${expected}", got: ${stdout}`);
      }
    }
  });

  // ── specifier-mandated-05 ─────────────────────────────────────────────────
  registry.defineScoped(
    /^the specifier role prompt$/,
    (ctx) => {
      ctx.specifierPromptText = fs.readFileSync(SPECIFIER_PROMPT, 'utf8');
    },
    FEATURE_NAME
  );

  registry.define(/^it is read for the amendment-commit procedure$/, () => {
    // No-op: the read already happened in the Given step above.
  });

  registry.define(
    /^it names the boot prefix budget gate as a required step before committing a boot-inlined article change$/,
    (ctx) => {
      const text = ctx.specifierPromptText;
      if (!/boot_prefix_budget_gate\.sh/.test(text) || !/required step/.test(text)) {
        throw new Error('specifier.prompt does not name boot_prefix_budget_gate.sh as a required step');
      }
      if (!/before committing/i.test(text)) {
        throw new Error('specifier.prompt does not tie the gate to the amendment-commit moment');
      }
    }
  );
}

module.exports = { registerSteps };
