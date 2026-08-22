'use strict';

// BL-968: step handlers for "step registry loads from a materialized
// non-repo tree". Scenarios 01/02 drive the SAME guard core the unit lane
// runs (extension/test/helpers/materializedRegistryGuard.js - one
// materialization + one verdict path, never a re-statement); 03 drives the
// REAL pre-QA gather + evaluate pair (pre_qa_gate_gather_lib.bb's
// gather-acceptance-contract-facts, acceptance_contract_gate_lib.bb's
// evaluate) over a commit minted from the current tree via a temp git
// index - no refs are moved, the commit object simply exists so the gate
// can `git show` it, which makes the scenario runnable both before this
// parcel's commit exists and when QA re-runs it at the cited commit; 04
// executes a REAL step from a fixed step file through the real registry
// and proves the main checkout resolves at execution time.
//
// NOTE (invariant 1 applies to this file too): everything below binds at
// step-execution time - module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  materializeCurrentPipeline,
  registryLoadVerdict,
  plantOffender,
} = require('../../../extension/test/helpers/materializedRegistryGuard');

const FEATURE = 'BL-968 step registry loads from a materialized non-repo tree';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TICKET_ID = 'BL-968';
const TICKET_YAML_REL = path.join('backlog', 'active', 'BL-968-step-registry-loadable-from-materialized-tree.yaml');

// The five load-time offenders this parcel fixed, with the lazy marker
// each must carry (and the eager marker each must NOT) at any commit the
// gate is asked to judge in scenario 03.
const FIXED_FILES = [
  { rel: 'specs/pipeline/steps/headlessDarkEmitterAuditSteps.js', lazy: "require('./lib/lazy')", eager: 'const MAIN_CHECKOUT = resolveMainCheckout(__dirname)' },
  { rel: 'specs/pipeline/steps/routingBreakEvenSteps.js', lazy: "require('./lib/lazy')", eager: 'const MAIN_CHECKOUT = resolveMainCheckout(__dirname)' },
  { rel: 'specs/pipeline/steps/standingRuleViolationsSteps.js', lazy: "require('./lib/lazy')", eager: 'const MAIN_CHECKOUT = resolveMainCheckout(__dirname)' },
  { rel: 'specs/pipeline/steps/devHostLauncherSteps.js', lazy: "require('./lib/lazy')", eager: 'const swarmEnsureSource = require' },
  { rel: 'specs/pipeline/steps/bl936Bl805PropertyLaneExercisesTheParcelGateSteps.js', lazy: "require('./lib/lazy')", eager: "const BB_BIN = execFileSync" },
];

function rmTreeQuietly(root) {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function materializeIntoCtx(ctx) {
  // Architect bounce D1: partial-materialization cleanup lives INSIDE
  // materializeCurrentPipeline (the only scope that has the root on the
  // throw path) - the helper either returns a valid tree or leaves no
  // temp dir behind, so there is nothing for this caller to guard.
  const made = materializeCurrentPipeline();
  ctx.guardRoot = made.root;
  ctx.pipelineDir = made.pipelineDir;
}

// Runs the guard verdict over ctx's tree and deletes the tree in the same
// step - the verdict object outlives the tree, the tree never outlives the
// scenario (fixture-in-finally discipline).
function verdictAndCleanup(ctx) {
  try {
    ctx.verdict = registryLoadVerdict(ctx.pipelineDir, ctx.guardRoot);
  } finally {
    rmTreeQuietly(ctx.guardRoot);
    ctx.guardRoot = null;
  }
}

// Mints a commit object of the CURRENT working tree's specs/ and
// backlog/active/ state on top of HEAD, through a throwaway index - the
// real repo index and every ref stay untouched.
function mintCurrentTreeCommit() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl968-mint-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, env, encoding: 'utf8' }).trim();
    git(['read-tree', 'HEAD']);
    git(['add', '-A', '--', 'specs', 'backlog/active']);
    const tree = git(['write-tree']);
    return git(['commit-tree', tree, '-p', 'HEAD', '-m', 'BL-968 scenario-03 scratch commit (current tree, no ref)']);
  } finally {
    rmTreeQuietly(scratch);
  }
}

function fileAtCommit(commit, rel) {
  return execFileSync('git', ['show', `${commit}:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── registry-materialized-load-01 ─────────────────────────────────────
  scoped(/^the current specs\/pipeline tree materialized into a temp dir that is not a git repository$/, (ctx) => {
    materializeIntoCtx(ctx);
    assert.ok(!fs.existsSync(path.join(ctx.guardRoot, '.git')), 'the materialized root must not be a git repository');
  });
  scoped(/^the contract step resolver runs against it$/, (ctx) => {
    verdictAndCleanup(ctx);
  });
  scoped(/^the resolver reports the registry loadable with no unresolved steps attributable to load failure$/, (ctx) => {
    assert.equal(
      ctx.verdict.loadable,
      true,
      `registry unloadable from the materialized tree: ${ctx.verdict.error}\n${ctx.verdict.detail || ''}`
    );
    assert.deepEqual(ctx.verdict.unresolved, [], `unexpected unresolved steps: ${JSON.stringify(ctx.verdict.unresolved)}`);
  });

  // ── registry-materialized-load-02 ─────────────────────────────────────
  scoped(/^a scratch registry tree containing a step file that runs a subprocess at module load$/, (ctx) => {
    materializeIntoCtx(ctx);
    try {
      ctx.offenderName = 'bl968AcceptancePlantedOffenderSteps';
      plantOffender(ctx.pipelineDir, {
        registerRelPath: ctx.offenderName,
        files: {
          [`${ctx.offenderName}.js`]: [
            "'use strict';",
            "const { execFileSync } = require('node:child_process');",
            "const MAIN = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: __dirname, encoding: 'utf8' });",
            'function registerSteps() {}',
            'module.exports = { registerSteps, MAIN };',
            '',
          ].join('\n'),
        },
      });
    } catch (err) {
      rmTreeQuietly(ctx.guardRoot);
      ctx.guardRoot = null;
      throw err;
    }
  });
  scoped(/^the standing guard runs against that tree$/, (ctx) => {
    verdictAndCleanup(ctx);
  });
  scoped(/^the guard fails naming that step file$/, (ctx) => {
    assert.equal(ctx.verdict.loadable, false, `expected the planted offender to make the registry unloadable, got: ${JSON.stringify(ctx.verdict)}`);
    assert.ok(
      (ctx.verdict.detail || '').includes(ctx.offenderName),
      `the guard's detail must NAME the offending step file ${ctx.offenderName}:\n${ctx.verdict.detail}`
    );
  });

  // ── registry-materialized-load-03 ─────────────────────────────────────
  scoped(/^a QA-bound git_handoff citing a commit whose registry contains the fixed step files$/, (ctx) => {
    ctx.citedCommit = mintCurrentTreeCommit().slice(0, 10);
    // Precondition, not hope: at the cited commit every fixed file binds
    // lazily and none carries its old eager load-time call.
    for (const { rel, lazy, eager } of FIXED_FILES) {
      const content = fileAtCommit(ctx.citedCommit, rel);
      assert.ok(content.includes(lazy), `${rel} at ${ctx.citedCommit} lacks its lazy marker '${lazy}'`);
      assert.ok(!content.includes(eager), `${rel} at ${ctx.citedCommit} still carries its eager load-time call '${eager}'`);
    }
    ctx.yamlPath = path.join(REPO_ROOT, TICKET_YAML_REL);
    assert.ok(fs.existsSync(ctx.yamlPath), `ticket yaml not found at ${ctx.yamlPath}`);
  });
  scoped(/^the pre-QA gate gathers and evaluates the send$/, (ctx) => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl968-gate-'));
    try {
      const script = path.join(scratch, 'gate.bb');
      fs.writeFileSync(
        script,
        [
          // load-file first, references only in LATER top-level forms (the
          // bb sci same-form visibility gotcha).
          `(load-file ${JSON.stringify(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pre_qa_gate_gather_lib.bb'))})`,
          "(require '[cheshire.core :as json])",
          '(let [[project-root cited-commit yaml-path ticket-id] *command-line-args*',
          '      yaml-content (slurp yaml-path)',
          '      facts (pre-qa-gate-gather-lib/gather-acceptance-contract-facts project-root cited-commit yaml-content)',
          '      verdict (acceptance-contract-gate-lib/evaluate (assoc facts :ticket-id ticket-id))]',
          '  (println (json/generate-string {:facts facts :verdict verdict})))',
          '',
        ].join('\n')
      );
      const res = spawnSync('bb', [script, REPO_ROOT, ctx.citedCommit, ctx.yamlPath, TICKET_ID], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 300000,
      });
      if (res.status !== 0) {
        throw new Error(`gather+evaluate failed (${res.status}): ${res.stderr || res.stdout}`);
      }
      ctx.gate = JSON.parse(res.stdout.trim().split('\n').pop());
    } finally {
      rmTreeQuietly(scratch);
    }
  });
  scoped(/^no step-registry-load warning is recorded$/, (ctx) => {
    const warnings = ctx.gate.verdict.warnings || [];
    const loadWarnings = warnings.filter((w) => w.includes('step registry could not be loaded'));
    assert.deepEqual(loadWarnings, [], `the gate still records the BL-968 registry-load warning: ${JSON.stringify(warnings)}`);
    assert.equal(ctx.gate.facts['registry-loadable?'], true, `registry not loadable at the cited commit: ${JSON.stringify(ctx.gate.facts)}`);
  });
  scoped(/^the acceptance-contract check produces a real verdict for the ticket$/, (ctx) => {
    // A REAL verdict means the evaluate else-branch ran: declaration read,
    // registry loaded, unresolved-steps actually consulted - not the
    // warn-and-skip path the defect forced on every send.
    assert.equal(ctx.gate.facts['declaration-readable?'], true, JSON.stringify(ctx.gate.facts));
    assert.ok(Array.isArray(ctx.gate.facts['unresolved-steps']), `unresolved-steps was never gathered: ${JSON.stringify(ctx.gate.facts)}`);
    assert.deepEqual(ctx.gate.verdict.findings, [], `this feature's own steps must all resolve at the cited commit: ${JSON.stringify(ctx.gate.verdict.findings)}`);
    assert.deepEqual(ctx.gate.verdict.warnings, [], `a real verdict carries no fail-open warning: ${JSON.stringify(ctx.gate.verdict.warnings)}`);
  });

  // ── registry-materialized-load-04 ─────────────────────────────────────
  scoped(/^a role-worktree checkout of the repository$/, () => {
    // In a linked worktree .git is a FILE (gitdir: pointer), in the master
    // checkout a directory - this scenario's claim is about lazy
    // resolution FROM a role worktree, so the context is asserted, not
    // assumed.
    const dotGit = path.join(REPO_ROOT, '.git');
    assert.ok(fs.statSync(dotGit).isFile(), `expected a role-worktree checkout (.git as a gitdir pointer file), got a directory at ${dotGit}`);
  });
  scoped(/^a scenario step from a fixed step file executes and needs the main checkout$/, async (ctx) => {
    const { createStepRegistry } = require('../stepRegistry');
    const fixed = require('./routingBreakEvenSteps');
    const reg = createStepRegistry();
    fixed.registerSteps(reg);
    // The chosen step runs the REAL park-cycle CLI with cwd set to the
    // lazily-resolved main checkout and asserts the live production
    // measurement parses - it throws unless resolution found the real
    // master checkout at THIS call. The other two fixed files'
    // main-checkout steps are currently red on live drift unrelated to
    // binding time (BL-336's audit-04 live-telemetry claim,
    // BL-337's KNOWN VIOLATION lib-test gate) - surfaced by note with this
    // parcel, deliberately not driven here.
    const stepText = 'that cost is not used';
    const resolved = reg.resolve(stepText);
    assert.ok(resolved, `fixed step file no longer registers "${stepText}"`);
    await resolved.handler({}, ...resolved.args);
    ctx.fixedStepRan = true;
  });
  scoped(/^it resolves the main checkout correctly at execution time$/, (ctx) => {
    assert.equal(ctx.fixedStepRan, true, 'the fixed step never executed');
  });
}

module.exports = { registerSteps };
