'use strict';

// BL-1099: pure helpers for the give-up cooldown scenario retirement.
// Acceptance steps and property tests drive these — never a second
// reimplementation of the coverage / dead-registration proofs.

const COVERAGE_CASES = Object.freeze([
  Object.freeze({ elapsed: 'has elapsed', processState: 'dead' }),
  Object.freeze({ elapsed: 'has elapsed', processState: 'still alive' }),
  Object.freeze({ elapsed: 'has not elapsed', processState: 'dead' }),
  Object.freeze({ elapsed: 'has not elapsed', processState: 'still alive' }),
]);

const KNOWN_ELAPSED = Object.freeze({
  'has elapsed': true,
  'has not elapsed': true,
});

const KNOWN_PROCESS_STATE = Object.freeze({
  dead: true,
  'still alive': true,
});

function knownElapsed(label) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ELAPSED, label)) {
    throw new Error(`bl1099: unrecognized <elapsed> value "${label}"`);
  }
  return label;
}

function knownProcessState(label) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PROCESS_STATE, label)) {
    throw new Error(`bl1099: unrecognized <process state> value "${label}"`);
  }
  return label;
}

// Split a feature file into { name, body } scenario blocks. Outline Examples
// stay inside body so a single Examples row is visible to the case matcher.
function listScenarios(featureText) {
  const lines = String(featureText).split(/\r?\n/);
  const scenarios = [];
  let current = null;
  for (const line of lines) {
    const m = /^\s*Scenario(?: Outline)?:\s*(.+)\s*$/.exec(line);
    if (m) {
      if (current) scenarios.push(current);
      current = { name: m[1].trim(), body: '' };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) scenarios.push(current);
  return scenarios;
}

const NOT_ELAPSED_RE = /has not yet elapsed|has not elapsed yet/;
const ELAPSED_RE = /give-up cooldown has elapsed|cooldown has elapsed|has elapsed/;
const DECISION_RE =
  /still given up|no replacement is spawned|respawned with a fresh restart budget|re-arm|leaves the child down|resets its attempt count and starts/;
const ELAPSED_REARM_RE =
  /respawned with a fresh restart budget|re-arm|resets its attempt count and starts/;

function bodyMentionsNotElapsed(body) {
  return NOT_ELAPSED_RE.test(body);
}

function bodyMentionsElapsed(body) {
  // "has elapsed" alone also matches "has not elapsed" — exclude those.
  return !bodyMentionsNotElapsed(body) && ELAPSED_RE.test(body);
}

function bodyMentionsProcessState(body, processState) {
  return processState === 'dead' ? /\bdead\b/.test(body) : /still alive/.test(body);
}

function bodyHasProcessStateExample(body, processState) {
  // Scenario Outline Examples column whose cells include the state token.
  const examples = body.match(/Examples:[\s\S]*?(?=\n\s*#|\n\s*Scenario|\s*$)/);
  if (!examples) return false;
  return processState === 'dead' ? /\|\s*dead\s*\|/.test(examples[0]) : /still alive/.test(examples[0]);
}

function bodyCitesProcessState(body, processState) {
  return bodyMentionsProcessState(body, processState) || bodyHasProcessStateExample(body, processState);
}

function bodyAssertsSupervisorDecision(body) {
  return DECISION_RE.test(body);
}

/**
 * Does this scenario assert the supervisor's decision for one matrix cell?
 * When cooldown has elapsed the decision is re-arm for either process state
 * (BL-1088), so one elapsed+re-arm scenario covers both elapsed rows.
 */
function scenarioCoversCase(scenario, elapsed, processState) {
  const { body } = scenario;
  if (!bodyAssertsSupervisorDecision(body)) return false;
  if (elapsed === 'has not elapsed') {
    return bodyMentionsNotElapsed(body) && bodyCitesProcessState(body, processState);
  }
  if (!bodyMentionsElapsed(body)) return false;
  // Elapsed: process state is orthogonal to the re-arm decision. An explicit
  // process-state mention still matches; otherwise any elapsed re-arm covers.
  return bodyCitesProcessState(body, processState) || ELAPSED_REARM_RE.test(body);
}

function findScenarioCoveringCase(featureTexts, elapsed, processState) {
  const e = knownElapsed(elapsed);
  const p = knownProcessState(processState);
  for (const text of featureTexts) {
    for (const scenario of listScenarios(text)) {
      if (scenarioCoversCase(scenario, e, p)) return scenario.name;
    }
  }
  return null;
}

function missingCoverageCases(featureTexts) {
  return COVERAGE_CASES.filter((c) => findScenarioCoveringCase(featureTexts, c.elapsed, c.processState) === null);
}

/**
 * Extract literal step-pattern sources from a BL-303-style
 * `registry.define(/^...$/)` handler file. Alternations stay as the regex
 * source so callers can expand them.
 */
function extractDefinePatternSources(handlerSource) {
  const out = [];
  const re = /registry\.define\(\s*\/\^((?:\\.|[^$/])*)\$\//g;
  let m;
  while ((m = re.exec(handlerSource)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function expandAlternationFragments(patternSource) {
  // Turn "foo (a|b) bar" into ["foo a bar", "foo b bar"]. Nested alts are
  // out of scope for the BL-303 handler shapes.
  const m = /^(.*)\(([^()]+)\)(.*)$/.exec(patternSource);
  if (!m) return [patternSource.replace(/\\([.^$*+?()[\]{}|\\])/g, '$1')];
  const [, pre, alts, post] = m;
  return alts.split('|').map((alt) => `${pre}${alt}${post}`.replace(/\\([.^$*+?()[\]{}|\\])/g, '$1'));
}

function patternReferencedInFeatureTexts(patternSource, featureTexts) {
  const corpus = featureTexts.join('\n');
  return expandAlternationFragments(patternSource).some((frag) => corpus.includes(frag));
}

function orphanedRegistrations(handlerSource, featureTexts) {
  return extractDefinePatternSources(handlerSource).filter(
    (src) => !patternReferencedInFeatureTexts(src, featureTexts)
  );
}

function hasScenarioNamed(featureText, nameSubstring) {
  return listScenarios(featureText).some((s) => s.name.includes(nameSubstring));
}

module.exports = {
  COVERAGE_CASES,
  knownElapsed,
  knownProcessState,
  listScenarios,
  findScenarioCoveringCase,
  missingCoverageCases,
  extractDefinePatternSources,
  expandAlternationFragments,
  patternReferencedInFeatureTexts,
  orphanedRegistrations,
  hasScenarioNamed,
  scenarioCoversCase,
};
