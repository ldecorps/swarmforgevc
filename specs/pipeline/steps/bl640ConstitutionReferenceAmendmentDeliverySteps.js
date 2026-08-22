'use strict';

// BL-640: step handlers for "a constitution reference amendment reaches
// every role before it next acts". Scenarios 01/02 drive the REAL
// ready_for_next.bb pre-turn freshness guard against a disposable fixture
// git repo (test_reference_freshness_guard.sh) - never a parallel
// reimplementation of the guard. Scenarios 04/06 drive the REAL
// prompt-engine-lib/stable-prefix-text against a materialized synthetic
// root (bl640_prompt_stability_check.bb) to prove this ticket's guard
// (which lives entirely outside compose) never regresses PromptEngine's
// existing no-growth / top-level-delivery properties. Scenario 03 reads
// the REAL repo's own constitution files directly - it is a claim about
// THIS repo's current prose for one specific, named historical amendment
// (the 2026-07-25 bounce-revert pair), not a generic mechanism.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD_FIXTURE = path.join(SCRIPTS_DIR, 'test', 'test_reference_freshness_guard.sh');
const STABILITY_CHECK = path.join(SCRIPTS_DIR, 'test', 'bl640_prompt_stability_check.bb');
const FEATURE = 'a constitution reference amendment reaches every role before it next acts';

function runGuardFixture() {
  const result = spawnSync('bash', [GUARD_FIXTURE], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function runStabilityCheck() {
  const result = spawnSync('bb', [STABILITY_CHECK], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureGuardResult(ctx) {
  if (!ctx.bl640?.guardResult) {
    ctx.bl640 = { ...(ctx.bl640 || {}), guardResult: runGuardFixture() };
  }
  return ctx.bl640.guardResult;
}

function ensureStabilityResult(ctx) {
  if (!ctx.bl640?.stabilityResult) {
    ctx.bl640 = { ...(ctx.bl640 || {}), stabilityResult: runStabilityCheck() };
  }
  return ctx.bl640.stabilityResult;
}

function requirePass(stdout, marker, description) {
  if (!stdout.includes(`PASS: ${marker}:`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

// ── scenario 03: the 2026-07-25 bounce-revert pair, read from the real repo
const INLINED_PATH = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'workflow.prompt');
const DETAILED_PATH = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'reference', 'workflow-detailed.prompt');

// Both files carry MANY rules; the bounce-revert pair is one `## `-headed
// section among several (the detailed file, for instance, separately and
// legitimately instructs an is-ancestor check for "Forwarded Commits Carry
// Their Lineage" - checking IS the correct behavior there). Scoping to just
// the named section is what keeps this a check of the specific 2026-07-25
// pair, not a blanket ban on ever mentioning ancestor checks anywhere.
function extractSection(text, headingPattern) {
  const lines = text.split('\n');
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) return null;
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => /^##\s/.test(line));
  const sectionLines = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return [lines[startIndex], ...sectionLines].join('\n');
}

function checkBounceRevertPairConsistency() {
  const inlined = fs.readFileSync(INLINED_PATH, 'utf8');
  const detailed = fs.readFileSync(DETAILED_PATH, 'utf8');

  const inlinedSection = extractSection(inlined, /Bounce Must Be Reverted/i);
  const detailedSection = extractSection(detailed, /Bounce Must Be Reverted/i);
  if (!inlinedSection) {
    throw new Error(`BL-640 scenario 03: could not find the bounce-revert rule in ${INLINED_PATH}`);
  }
  if (!detailedSection) {
    throw new Error(`BL-640 scenario 03: could not find the bounce-revert rule in ${DETAILED_PATH}`);
  }

  if (!/content is gone/i.test(inlinedSection)) {
    throw new Error('BL-640 scenario 03: inlined bounce-revert section no longer states the CONTENT-is-gone check');
  }
  if (!/content is gone/i.test(detailedSection)) {
    throw new Error('BL-640 scenario 03: elaboration bounce-revert section no longer states the CONTENT-is-gone check');
  }

  // Any mention of ancestor-checking WITHIN THIS SECTION must appear only
  // as a prohibition ("Do NOT check ... is-ancestor") - never as an actual
  // instruction to perform and rely on that check. This is the exact shape
  // of the pre-amendment defect: the elaboration told a reviewer to run a
  // check that can never pass. Prose wraps across lines, so "not"/"never"
  // is searched in a window AROUND the match (not just its own line) -
  // this repo's own text reads "Do NOT check\n`...is-ancestor...` that
  // check **can never be\nFALSE**", spanning three lines.
  const WINDOW = 120;
  let sawAncestorMention = false;
  const ancestorRegex = /is-ancestor/gi;
  let match;
  while ((match = ancestorRegex.exec(detailedSection)) !== null) {
    sawAncestorMention = true;
    const start = Math.max(0, match.index - WINDOW);
    const end = Math.min(detailedSection.length, match.index + match[0].length + WINDOW);
    const surrounding = detailedSection.slice(start, end);
    if (!/not|never/i.test(surrounding)) {
      throw new Error(`BL-640 scenario 03: found an ancestor-check mention with no prohibition nearby (contradiction risk): "${surrounding}"`);
    }
  }
  if (!sawAncestorMention) {
    throw new Error('BL-640 scenario 03: expected the elaboration bounce-revert section to still document why ancestor-checking is wrong, found no mention');
  }

  if (!/never by ancestry/i.test(inlinedSection)) {
    throw new Error('BL-640 scenario 03: inlined bounce-revert section no longer disclaims the ancestry check');
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^a constitution reference\/ file was amended on main$/, (ctx) => {
    ctx.bl640 = { ...(ctx.bl640 || {}) };
  }, FEATURE);

  registry.defineScoped(/^a role's worktree has not merged main since$/, (ctx) => {
    ctx.bl640 = { ...(ctx.bl640 || {}), staleWorktree: true };
  }, FEATURE);

  registry.defineScoped(/^a role is about to act on the subject that file elaborates$/, (ctx) => {
    ensureGuardResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^that role reads the reference\/ file for the amended subject$/, (ctx) => {
    ensureGuardResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^that role reads the amended text, not a stale copy$/, (ctx) => {
    const { stdout } = ensureGuardResult(ctx);
    requirePass(stdout, '01', 'a merged worktree to read the amended text and proceed');
  }, FEATURE);

  registry.defineScoped(/^the role either sees the amended text or refuses and reports the staleness$/, (ctx) => {
    const { stdout } = ensureGuardResult(ctx);
    // This ticket's bound mechanism never merges on the role's behalf
    // (out_of_scope: "this parcel must not touch the merge path") - the
    // guard's only outcome on drift is refuse-and-report, which is the
    // marker this asserts. See scenario 01 for the sees-amended-text half
    // of the disjunction, exercised once the worktree HAS merged.
    requirePass(stdout, '02', 'a stale worktree to refuse the turn and report the staleness');
  }, FEATURE);

  // ── scenario 03 ───────────────────────────────────────────────────────
  registry.defineScoped(/^the 2026-07-25 bounce-revert amendment pair \(inlined: verify content is gone; stale elaboration: verify ancestry is FALSE\)$/, () => {
    // no setup - scenario 03 reads the real repo's current files directly
  }, FEATURE);

  registry.defineScoped(/^a role reads both its inlined prompt and the reference\/ elaboration for that rule$/, (ctx) => {
    ctx.bl640 = { ...(ctx.bl640 || {}) };
  }, FEATURE);

  registry.defineScoped(/^the two never instruct contradictory verification steps$/, () => {
    checkBounceRevertPairConsistency();
  }, FEATURE);

  // ── scenario 04 ───────────────────────────────────────────────────────
  registry.defineScoped(/^no constitution file has changed since the last composed prompt$/, (ctx) => {
    ctx.bl640 = { ...(ctx.bl640 || {}) };
  }, FEATURE);

  registry.defineScoped(/^the prompt is composed again$/, (ctx) => {
    ensureStabilityResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^its byte size matches the prior baseline$/, (ctx) => {
    const { stdout } = ensureStabilityResult(ctx);
    requirePass(stdout, '04', 'a no-op recompose to match the prior byte size exactly');
  }, FEATURE);

  // ── scenario 06 ───────────────────────────────────────────────────────
  registry.defineScoped(/^a top-level articles\/\*\.prompt file is amended on main$/, (ctx) => {
    ctx.bl640 = { ...(ctx.bl640 || {}) };
  }, FEATURE);

  registry.defineScoped(/^the composed prompt is regenerated and a role respawns$/, (ctx) => {
    ensureStabilityResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the amended top-level rule is present in that role's inlined prompt$/, (ctx) => {
    const { stdout } = ensureStabilityResult(ctx);
    requirePass(stdout, '06', 'the amended top-level rule to reach the composed prompt');
  }, FEATURE);
}

module.exports = { registerSteps };
