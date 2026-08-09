const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');

// BL-643 invariant 2 (property authorship rests with the coder, first pass -
// BL-654): "No agent's behaviour is described as authored when it was
// reverse-engineered from code: an agent with no role prompt is marked as
// such wherever it is described."
//
// Two things must hold for EVERY agent in the reference table that has no
// role prompt (not just the one worked example in acceptance scenario 04):
//   1. The table's own "Role prompt" cell marks the absence structurally
//      ("— none —"), never a blank cell that could read as an oversight.
//   2. Wherever this document set gives that agent its own named section
//      of descriptive prose (a "## Agent" / "### Agent" heading in either
//      the reference table or the class explanation doc) - as opposed to a
//      bare mention in a taxonomy list - that section explicitly disclaims
//      authorship rather than leaving the reader to assume it.
//
// Most no-prompt agents (Negotiation Relay, Resident Spy Tunnel, Cursor
// Bridge, Front Desk Operator, Babysitter) get no such dedicated section
// today - condition 2 is then vacuously satisfied for them, which is
// itself correct: a bare table row makes no authorship claim to correct.
// Front Desk and the Onboarder DO get a dedicated section, so this is
// where the property has real bite. Excluded from the "no role prompt"
// domain: the Expeditor, whose behaviour is genuinely authored - just in
// the BL-567 docs, not a `.prompt` role file - so marking it "derived from
// code" would itself be a false claim, not a correction of one.
const {
  parseReferenceTable,
  isDeliberatelyAbsent,
  CLASS_DOC_PATH,
  REF_TABLE_PATH,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');

const AUTHORED_ELSEWHERE_EXCEPTIONS = new Set(['Expeditor']);

const DISCLAIMER_PATTERNS = [/derived from (its |reading the shipped )?code/i, /not (from )?an authored/i];

function findNamedSections(docText, agentName) {
  const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Allow an optional leading "The " so a heading like "## The Onboarder:
  // what shipped" is still recognized as the Onboarder's own section.
  const headingRe = new RegExp(`^#{2,3}\\s+(?:The\\s+)?${escaped}\\b`, 'm');
  const sections = [];
  let searchFrom = 0;
  for (;;) {
    const rest = docText.slice(searchFrom);
    const m = headingRe.exec(rest);
    if (!m) {
      break;
    }
    const startIdx = searchFrom + m.index;
    const afterHeadingLine = docText.indexOf('\n', startIdx) + 1;
    const nextHeadingOffset = docText.slice(afterHeadingLine).search(/^#{2,3}\s+/m);
    const endIdx = nextHeadingOffset === -1 ? docText.length : afterHeadingLine + nextHeadingOffset;
    sections.push(docText.slice(startIdx, endIdx));
    searchFrom = endIdx;
  }
  return sections;
}

function buildNoPromptDomain() {
  const { rows } = parseReferenceTable();
  return rows.filter((row) => isDeliberatelyAbsent(row['Role prompt']) && !AUTHORED_ELSEWHERE_EXCEPTIONS.has(row.Agent));
}

// A section naming the agent is only in scope for THIS invariant if it is
// actually discussing role-prompt authorship - an agent can have a named
// section about an unrelated irregularity (Negotiation Relay's missing
// stop path, say) that has nothing to do with whether its behaviour reads
// as authored, and such a section makes no authorship claim to correct.
const AUTHORSHIP_TOPIC_PATTERN = /role prompt|authored/i;

function checkNoPromptAgentRow(row, classDoc, refTableText) {
  if (!isDeliberatelyAbsent(row['Role prompt'])) {
    throw new Error(`bl643 invariant 2: row "${row.Agent}" is in the no-prompt domain but its cell no longer reads "— none —"`);
  }
  const sections = [...findNamedSections(classDoc, row.Agent), ...findNamedSections(refTableText, row.Agent)].filter((s) =>
    AUTHORSHIP_TOPIC_PATTERN.test(s)
  );
  for (const section of sections) {
    const matched = DISCLAIMER_PATTERNS.some((re) => re.test(section));
    if (!matched) {
      throw new Error(`bl643 invariant 2: row "${row.Agent}" has a dedicated prose section discussing role-prompt authorship with no disclaimer: ${JSON.stringify(section.slice(0, 200))}`);
    }
  }
}

test('property: every no-role-prompt agent is marked absent in the table, and disclaimed wherever it gets dedicated prose', () => {
  const domain = buildNoPromptDomain();
  assert.ok(domain.length > 0, 'fixture assumption broken: expected at least one no-role-prompt agent in the table');
  const classDoc = fs.readFileSync(CLASS_DOC_PATH, 'utf8');
  const refTableText = fs.readFileSync(REF_TABLE_PATH, 'utf8');
  fc.assert(
    fc.property(fc.constantFrom(...domain), (row) => {
      checkNoPromptAgentRow(row, classDoc, refTableText);
    }),
    { numRuns: domain.length * 20 }
  );
});

test('property: the checker is non-vacuous - a fabricated authored-sounding section fails, and the real docs have none', () => {
  const brokenClassDoc = `## Front Desk

The Front Desk has its own authored role prompt describing exactly how it
should greet every human warmly.
`;
  const fabricatedRow = { Agent: 'Front Desk', 'Role prompt': '— none —' };
  assert.throws(
    () => checkNoPromptAgentRow(fabricatedRow, brokenClassDoc, ''),
    /discussing role-prompt authorship with no disclaimer/,
    'checker did not catch a section that implies authored behaviour with no disclaimer - the property test would be vacuously true'
  );

  const domain = buildNoPromptDomain();
  const classDoc = fs.readFileSync(CLASS_DOC_PATH, 'utf8');
  const refTableText = fs.readFileSync(REF_TABLE_PATH, 'utf8');
  for (const row of domain) {
    assert.doesNotThrow(() => checkNoPromptAgentRow(row, classDoc, refTableText), `real row "${row.Agent}" unexpectedly failed the disclaimer check`);
  }
});
