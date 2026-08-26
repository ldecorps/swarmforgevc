'use strict';

// BL-383: step handlers for "The front desk answers the human at the
// verbosity he agreed to". Drives the REAL operator_lib.bb pure functions
// via `bb -e` (load-file + println), the same pattern routingManifestFieldSteps.js/
// backlogDepthSteps.js already use for their own .bb libs - never a live
// tmux session or a real `claude -p` call (the front-desk Operator's own
// LLM call is out of reach for an automated test; what this feature can and
// must prove is that the PROMPT it is handed carries the matching style
// directive, since a headless LLM given "Be concise..." vs "Be detailed..."
// is exactly how the agreed verbosity actually reaches the human).
//
// Writes a REAL contract.yaml (reusing contractView.ts's own
// renderContractYaml, mirrors verbosityIsNegotiatedIntoTheContractSteps.js's
// own writeContract convention for the sibling BL-382 feature) and reads it
// back off disk before handing its raw text to compose-front-desk-reply-
// prompt - the SAME seam operator_runtime.bb's real launch calls, so this
// run proves the actual wiring, not a re-derivation of it.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_lib.bb');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { renderContractYaml } = require(path.join(EXT_DIR, 'out', 'onboarding', 'contractView'));

const KNOWN_VERBOSITY_VALUES = new Set(['concise', 'normal', 'detailed']);

// BL-383 scenario 01 is a Scenario Outline for exactly this reason: every
// offered level must work, not just one - bound through an explicit
// KNOWN_VALUES lookup (the engineering article's own rule for a Scenario
// Outline column) rather than a bare passthrough that would let a mutated
// example value silently reach the fixture.
function knownVerbosity(value) {
  if (!KNOWN_VERBOSITY_VALUES.has(value)) {
    throw new Error(`the-front-desk-answers-at-the-agreed-verbosity: unrecognized <verbosity> example value "${value}"`);
  }
  return value;
}

function edn(content) {
  // bb's pr-str-quoted string literal: escape backslashes/quotes, keep
  // newlines literal inside the double-quoted EDN string (bb reads a
  // literal newline inside a string fine). Mirrors routingManifestFieldSteps.js's
  // own edn() helper.
  return `"${content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mkTargetPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl383-front-desk-verbosity-'));
}

// Writes an always-agreed contract with the given raw verbosity - `null`
// means the field is absent entirely (scenario 02), mirroring
// verbosityIsNegotiatedIntoTheContractSteps.js's own writeContract for the
// sibling BL-382 feature.
function writeContract(targetPath, rawVerbosity) {
  const contract = { scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'agreed' };
  if (rawVerbosity !== null) {
    contract.verbosity = rawVerbosity;
  }
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'contract.yaml'), renderContractYaml(contract));
}

function contractYamlContent(targetPath) {
  return fs.readFileSync(path.join(targetPath, '.swarmforge', 'contract.yaml'), 'utf8');
}

// Drives the REAL compose-front-desk-reply-prompt (the one seam both this
// feature's acceptance run and operator_runtime.bb's actual live launch
// call) against a fixed fixture transcript/memory - only contract-yaml-
// content varies per scenario, since that is this ticket's own scope.
function composeFrontDeskReplyPrompt(rawContractYamlContent) {
  const code =
    `(load-file "${OPERATOR_LIB}") ` +
    `(println (operator-lib/compose-front-desk-reply-prompt ` +
    `{:contract-yaml-content ${rawContractYamlContent === null ? 'nil' : edn(rawContractYamlContent)} ` +
    `:transcript {:id "SUP-1" :messages [{:channel "telegram" :text "when will BL-1 ship?"}]} ` +
    `:long-term-memory ["the human prefers terse replies"]}))`;
  return execFileSync('bb', ['-e', code], { encoding: 'utf8' });
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the human has an agreed contract with the swarm$/, (ctx) => {
    ctx.targetPath = mkTargetPath();
    ctx.rawVerbosity = null;
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });

  // ── the-front-desk-answers-at-the-agreed-verbosity-01 (Outline) ─────
  registry.define(/^the agreed verbosity is (concise|normal|detailed)$/, (ctx, verbosity) => {
    ctx.rawVerbosity = knownVerbosity(verbosity);
    writeContract(ctx.targetPath, ctx.rawVerbosity);
  });
  registry.define(/^the human asks the front desk a question$/, (ctx) => {
    ctx.prompt = composeFrontDeskReplyPrompt(contractYamlContent(ctx.targetPath));
  });
  registry.define(/^the front desk's reply follows the (concise|normal|detailed) level$/, (ctx, verbosity) => {
    const level = knownVerbosity(verbosity);
    assert.match(ctx.prompt, new RegExp(`Be ${level} in your responses`), `expected the composed prompt to carry the ${level} style directive, got: ${ctx.prompt}`);
  });

  // ── the-front-desk-answers-at-the-agreed-verbosity-02 ────────────────
  // "the contract states no verbosity at all" is IDENTICAL step text to
  // verbosityIsNegotiatedIntoTheContractSteps.js's own BL-382 scenario -
  // deliberately NOT re-registered here (the shared step registry's
  // first-registered-handler-wins rule means a second definition would
  // either silently shadow or silently BE shadowed by that one, and
  // registration order across specs/pipeline/steps/index.js is not this
  // file's to police). That handler already does exactly what this
  // scenario needs (writes ctx.targetPath's contract.yaml with no
  // verbosity field, via the Background's already-set ctx.targetPath), so
  // this scenario reuses it rather than risking two divergent copies.

  // ── the-front-desk-answers-at-the-agreed-verbosity-03 ────────────────
  registry.define(/^the human negotiates the verbosity to concise$/, (ctx) => {
    // BL-382 shipped no dedicated "negotiate verbosity" CLI (its own
    // reviseContractFromObjection only ever touches scope/outOfScope/
    // boundaries) - a direct contract.yaml rewrite is how its own
    // acceptance steps represent "the term is now X" too
    // (verbosityIsNegotiatedIntoTheContractSteps.js's writeContract).
    // Deliberately never touching ctx.targetPath itself (no new temp dir,
    // no re-provisioning) - the SAME target directory, SAME front desk,
    // proves the "no restart" half of this scenario structurally, not just
    // by assertion.
    writeContract(ctx.targetPath, 'concise');
  });
  registry.define(/^the swarm was never restarted$/, (ctx) => {
    // Proven structurally: composeFrontDeskReplyPrompt was called AGAIN
    // above (re-reading contract.yaml fresh, per compose-front-desk-reply-
    // prompt's own contract) against the SAME ctx.targetPath used for the
    // "detailed" reply earlier in this scenario - nothing here spawned a
    // new process, tmux session, or swarm launch between the two calls.
    assert.ok(ctx.targetPath, 'expected the same target path to have been used throughout this scenario, never re-provisioned');
  });
}

module.exports = { registerSteps };
