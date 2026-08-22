const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-654: BL-815's own declared invariant - "Every failure in the inventory
// ends the slice with a recorded classification and the isolation evidence
// behind it; none is left as an unexamined 'environmental'." This quantifies
// over the evidence MARKDOWN document's own completeness, not a pure code
// module's behavior - the closest executable encoding available is parsing
// that document and confirming every inventoried failure carries a
// recognized, specific classification token, never a bare "environmental".

const EVIDENCE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'backlog',
  'evidence',
  'BL-815-unit-suite-timeout-classification-20260817.md'
);

const REQUIRED_FAILURE_IDENTIFIERS = [
  'byte-identical reports',
  'localStorage.setItem',
  'renders exactly the two maintained diagrams',
  'main() runs in-process against the real repo',
  'the compiled CLI runs standalone as a subprocess',
];

const RECOGNIZED_CLASSIFICATION_TOKENS = ['Real slowdown past the 20s budget', 'Load-induced starvation'];

/** Pure: throws with a specific reason if `evidence` leaves any of
 * REQUIRED_FAILURE_IDENTIFIERS unclassified, or classifies one as a bare
 * "environmental". Never throws for a genuinely complete document. */
function assertEveryFailureClassified(evidence) {
  const classificationStart = evidence.indexOf('## Classification');
  const consequenceStart = evidence.indexOf('## Consequence');
  if (classificationStart === -1 || consequenceStart === -1 || consequenceStart <= classificationStart) {
    throw new Error('evidence file is missing a well-formed ## Classification section');
  }
  const classificationSection = evidence.slice(classificationStart, consequenceStart);

  for (const identifier of REQUIRED_FAILURE_IDENTIFIERS) {
    if (!evidence.includes(identifier)) {
      throw new Error(`evidence file never mentions inventoried failure "${identifier}"`);
    }
  }

  const rows = classificationSection.split('\n').filter((l) => l.trim().startsWith('|'));
  // header + separator + one row per inventoried failure
  const dataRows = rows.slice(2);
  if (dataRows.length !== REQUIRED_FAILURE_IDENTIFIERS.length) {
    throw new Error(
      `expected ${REQUIRED_FAILURE_IDENTIFIERS.length} classification rows, got ${dataRows.length}:\n${classificationSection}`
    );
  }
  for (const row of dataRows) {
    if (/\|\s*environmental\s*\|/i.test(row)) {
      throw new Error(`a bare "environmental" classification is never sufficient (BL-815's own invariant): ${row}`);
    }
    if (!RECOGNIZED_CLASSIFICATION_TOKENS.some((tok) => row.includes(tok))) {
      throw new Error(`row carries no recognized classification token: ${row}`);
    }
  }
}

test('BL-815 invariant: every inventoried failure carries a recorded, specific classification, never a bare "environmental"', () => {
  const evidence = fs.readFileSync(EVIDENCE_PATH, 'utf8');
  assert.doesNotThrow(() => assertEveryFailureClassified(evidence));
});

// Non-vacuity (BL-654): prove the checker actually rejects an incomplete
// document, against three distinct deliberately-broken shapes - never
// touches the real evidence file, so nothing needs restoring.
test('BL-815 invariant checker: non-vacuous against deliberately broken evidence', () => {
  const real = fs.readFileSync(EVIDENCE_PATH, 'utf8');

  const droppedRow = real.replace(
    /\| 7 \| Real slowdown past the 20s budget \(marginal\) \|[^\n]*\n/,
    ''
  );
  assert.throws(() => assertEveryFailureClassified(droppedRow), /expected 5 classification rows/);

  const bareEnvironmental = real.replace(
    /\| Real slowdown past the 20s budget \(marginal\) \| 19254ms isolated[^\n]*\|/,
    '| environmental |'
  );
  assert.throws(() => assertEveryFailureClassified(bareEnvironmental), /bare "environmental"/);

  const missingSection = real.replace('## Classification', '## Renamed Away');
  assert.throws(() => assertEveryFailureClassified(missingSection), /missing a well-formed/);
});
