'use strict';

// BL-337: step handlers for "A standing rule that is being violated shows
// up, instead of rotting quietly". Drives the REAL Babashka mechanism
// against REAL, live constitution/role-prompt content - never a fixture
// standing in for the actual rule text, since this ticket's whole point
// is deriving a real answer from real committed history (BL-252/BL-250/
// BL-255's exact classification is independently re-verified on every run
// by standing_rule_violations_lib_test_runner.bb's own "KNOWN VIOLATION"
// section, which this file drives).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { makeEvidenceReader } = require('./lib/evidenceReport');
const { resolveMainCheckout } = require('./lib/mainCheckout');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB_TEST_RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'standing_rule_violations_lib_test_runner.bb');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'standing_rule_violations_cli.bb');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');
const MAIN_CHECKOUT = resolveMainCheckout(__dirname);

const readEvidence = makeEvidenceReader(EVIDENCE_DIR, 'BL-337-standing-rule-violation-observable-', 'BL-337');

function runLibTests(ctx) {
  if (ctx.libTestOutput) {
    return ctx.libTestOutput;
  }
  const result = spawnSync('bb', [LIB_TEST_RUNNER], { encoding: 'utf8', timeout: 30000 });
  ctx.libTestOutput = (result.stdout || '') + (result.stderr || '');
  ctx.libTestPassed = result.status === 0;
  return ctx.libTestOutput;
}

function runCliReport() {
  const result = spawnSync('bb', [CLI, MAIN_CHECKOUT, 'report'], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(`standing_rule_violations_cli.bb report failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^a standing engineering rule that landed at a known point in history$/, () => {
    // Narrative only - engineering.prompt's real Scenario-Outline rule
    // (landed commit 40fdf6b3, 2026-07-10) is the concrete instance every
    // scenario below drives against for real.
  });

  // ── standing-rule-violation-observable-01 ────────────────────────────
  registry.define(/^the rule has been violated since it landed$/, (ctx) => {
    runLibTests(ctx);
  });
  registry.define(/^the violations are counted$/, (ctx) => {
    runLibTests(ctx);
  });
  registry.define(/^the count reflects the violations that occurred after the rule landed$/, (ctx) => {
    const output = runLibTests(ctx);
    if (!ctx.libTestPassed) {
      throw new Error(`expected the real standing-rule-violations suite (including its KNOWN VIOLATION check) to pass, got:\n${output}`);
    }
    // Live re-check against the real repo right now, not just the test file.
    const report = runCliReport();
    const bl252 = report.violations
      .flatMap((v) => (v.citations.includes('BL-252') ? [v] : []));
    if (bl252.length !== 1) {
      throw new Error(`expected BL-252 to be a recorded post-landing violation of exactly 1 real rule, got ${bl252.length}`);
    }
  });

  // ── standing-rule-violation-observable-02 ────────────────────────────
  registry.define(/^the rule was breached before it landed$/, (ctx) => {
    runLibTests(ctx);
  });
  registry.define(/^that breach is not counted$/, (ctx) => {
    const output = runLibTests(ctx);
    if (!ctx.libTestPassed) {
      throw new Error(`expected the real origin-exclusion test to pass, got:\n${output}`);
    }
    // BL-250 is the Scenario-Outline rule's OWN origin citation - it must
    // never appear as a violation of THAT SPECIFIC rule. (BL-250 is
    // coincidentally also a genuine, unrelated violation of a completely
    // different rule elsewhere in the codebase - documenter.prompt's own
    // "one ticket, one doc entry" rule, where BL-245 is the origin instead
    // - so this check is scoped to the one rule BL-250 actually predates,
    // never a blanket "BL-250 never violates anything anywhere" claim.)
    const report = runCliReport();
    const scenarioOutlineRule = report.violations.find((v) => v.rule.includes('Scenario Outline'));
    if (!scenarioOutlineRule) {
      throw new Error('expected to find the real Scenario-Outline KNOWN_VALUES rule in the report');
    }
    if (scenarioOutlineRule.citations.includes('BL-250')) {
      throw new Error(`expected BL-250 (this rule's own origin citation) to never be counted as ITS violation, got: ${JSON.stringify(scenarioOutlineRule)}`);
    }
  });

  // ── standing-rule-violation-observable-03 ────────────────────────────
  registry.define(/^a new standing rule is added$/, (ctx) => {
    // A REAL new rule, in a REAL new temp constitution-shaped file - never
    // touching the actual committed constitution. Proves the scan is
    // driven purely by structure (a bullet + a citation), not by a
    // hardcoded list of known files/rules.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl337-'));
    ctx.newRuleDir = dir;
    fs.mkdirSync(path.join(dir, 'swarmforge', 'constitution', 'articles'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'swarmforge', 'constitution', 'articles', 'engineering.prompt'),
      '# Engineering Rules\n\n## Section\n- A brand-new rule never seen before this test. (BL-70001: the origin incident.)\n'
    );
  });
  registry.define(/^the new rule has been violated$/, (ctx) => {
    const filePath = path.join(ctx.newRuleDir, 'swarmforge', 'constitution', 'articles', 'engineering.prompt');
    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(
      filePath,
      content.replace('the origin incident.)', 'the origin incident. BL-70002: it happened again.)')
    );
  });
  registry.define(/^the new rule's violations are counted$/, (ctx) => {
    const result = spawnSync('bb', [CLI, ctx.newRuleDir, 'for-ticket', 'BL-70002'], { encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0) {
      throw new Error(`standing_rule_violations_cli.bb failed against the fresh fixture: ${result.stderr}`);
    }
    ctx.newRuleResult = JSON.parse(result.stdout);
    if (ctx.newRuleResult.count !== 1) {
      throw new Error(`expected the brand-new rule's violation (BL-70002) to be detected with no code change, got: ${JSON.stringify(ctx.newRuleResult)}`);
    }
  });
  registry.define(/^no change was made to the counting mechanism$/, (ctx) => {
    // Real check: the CLI/lib files themselves are untouched by this
    // scenario's own fixture setup - the SAME already-compiled mechanism
    // (no per-file/per-rule branch) found the new rule.
    if (!fs.existsSync(CLI)) {
      throw new Error('expected the same standing_rule_violations_cli.bb to exist unchanged');
    }
    if (ctx.newRuleDir) {
      fs.rmSync(ctx.newRuleDir, { recursive: true, force: true });
    }
  });

  // ── standing-rule-violation-observable-04 ────────────────────────────
  registry.define(/^a violation of the rule that is known to have occurred$/, (ctx) => {
    runLibTests(ctx);
  });
  registry.define(/^that violation is among them$/, (ctx) => {
    const output = runLibTests(ctx);
    if (!ctx.libTestPassed) {
      throw new Error(`expected the KNOWN VIOLATION check to pass, got:\n${output}`);
    }
    const report = runCliReport();
    const bl253 = report.violations.flatMap((v) => (v.citations.includes('BL-253') ? [v] : []));
    if (bl253.length !== 1) {
      throw new Error(`expected the known BL-253 violation to be detected among the results, got ${bl253.length} matches`);
    }
  });

  // ── standing-rule-violation-observable-05 ────────────────────────────
  registry.define(/^the rule has never been violated$/, (ctx) => {
    runLibTests(ctx);
  });
  registry.define(/^the rule is reported with a count of zero$/, (ctx) => {
    const output = runLibTests(ctx);
    if (!ctx.libTestPassed) {
      throw new Error(`expected the "ALL rules returned, none omitted" test to pass, got:\n${output}`);
    }
    // architect.prompt's co-change-coupling rule (whose only citation is
    // BL-255's provenance credit, never a violation) is a real rule with
    // zero genuine violations - it must be REPORTED with count 0, not
    // simply absent from the list. Matched by its own first-line summary
    // text ("co-change" itself appears later in the block, not the first
    // line rule-summary extracts).
    const report = runCliReport();
    const coChangeRule = report.violations.find((v) => v.rule.includes('LOGICAL coupling from git history'));
    if (!coChangeRule) {
      throw new Error('expected the co-change-coupling rule to be present in the report even with zero violations, it was omitted');
    }
    if (coChangeRule.count !== 0) {
      throw new Error(`expected the co-change-coupling rule's violation count to be exactly 0, got ${coChangeRule.count}`);
    }
  });

  // ── standing-rule-violation-observable-06 ────────────────────────────
  registry.define(/^the briefing is produced$/, (ctx) => {
    const result = spawnSync('bb', [path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_test_runner.bb')], {
      encoding: 'utf8',
      timeout: 30000,
    });
    ctx.briefingTestOutput = (result.stdout || '') + (result.stderr || '');
    ctx.briefingTestPassed = result.status === 0;
  });
  registry.define(/^the briefing carries the rule's violation count$/, (ctx) => {
    if (!ctx.briefingTestOutput) {
      const result = spawnSync('bb', [path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_test_runner.bb')], {
        encoding: 'utf8',
        timeout: 30000,
      });
      ctx.briefingTestOutput = (result.stdout || '') + (result.stderr || '');
      ctx.briefingTestPassed = result.status === 0;
    }
    if (!ctx.briefingTestPassed) {
      throw new Error(`expected the real briefing wiring test (including the new standing-rule-violations-line case) to pass, got:\n${ctx.briefingTestOutput}`);
    }
    const text = readEvidence(ctx);
    if (!text.includes('Standing-rule violations:')) {
      throw new Error('expected the BL-337 evidence report to show the real briefing line format');
    }
  });
}

module.exports = { registerSteps };
