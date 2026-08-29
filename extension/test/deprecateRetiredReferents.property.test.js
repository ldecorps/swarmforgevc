'use strict';

// BL-1193's declared invariant: "A retired-token hold's reason always names a
// token that is itself the marked-RETIRED referent on its source doc line,
// never a merely co-occurring word."
//
// Generator reach: the defect lives in the DISTANCE between a marker and the
// words that merely share its line, so every generated line CONSTRUCTS that
// distance - a decoy word (and often a decoy path) sits earlier on the line
// than the real referent, exactly as the live table row does. Drawing lines
// without a decoy would make the property vacuous: an extractor that returned
// the first word on the line would pass every one of them. The decoy is
// therefore always present, and the assertion is two-sided - the referent IS
// returned and the decoy is NOT.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { extractRetiredReferents } = require('../out/tools/deprecate-check');

// Ordinary project vocabulary that must never be mistaken for a retired
// surface. "Mint" is the word that actually held BL-1190, BL-1193 and BL-1206.
const DECOYS = ['Mint', 'Expedite', 'Promotion', 'Hygiene', 'Coordinator', 'Backlog'];
const DECOY_PATHS = ['backlog_hygiene_lib.bb', 'promotion_gates_lib.bb', 'handoff_lib.bb'];
const REFERENTS = ['type: bug', 'legacy-verb', 'swarm_old_lib.bb', 'stale_conf_key', 'old-mode'];
const ARROWS = ['->', '=>', '→', '⇒'];

test('property: the referent is extracted and the co-occurring words never are', () => {
  let sawMapping = 0;
  let sawPredication = 0;
  let sawAnnouncement = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...DECOYS),
      fc.constantFrom(...DECOY_PATHS),
      fc.constantFrom(...REFERENTS),
      fc.constantFrom(...ARROWS),
      fc.constantFrom('is', 'was', 'is now', 'has been'),
      fc.constantFrom('mapping', 'predication', 'announcement'),
      (decoy, decoyPath, referent, arrow, copula, shape) => {
        let line;
        if (shape === 'mapping') {
          sawMapping += 1;
          line = `| ${decoy} hygiene (\`${decoyPath}\`) | \`${referent}\` ${arrow} \`RETIRED-SURFACE …\` |`;
        } else if (shape === 'predication') {
          sawPredication += 1;
          line = `${decoy} hygiene lives in \`${decoyPath}\`. The \`${referent}\` surface ${copula} RETIRED.`;
        } else {
          sawAnnouncement += 1;
          line = `${decoy} hygiene (\`${decoyPath}\`) note — RETIRED: \`${referent}\``;
        }
        const found = extractRetiredReferents(line);
        assert.deepEqual(found, [referent], `wrong referent for ${shape}: ${line}`);
        assert.ok(!found.includes(decoy), `the co-occurring word ${decoy} was extracted`);
        assert.ok(!found.includes(decoyPath), `the co-occurring path ${decoyPath} was extracted`);
      }
    ),
    { numRuns: 300 }
  );
  // Reachability floors: all three marker shapes must actually be generated,
  // asserted rather than hoped for. A run that drew only mappings would say
  // nothing about the two prose shapes.
  assert.ok(sawMapping > 40, `expected mapping lines, saw ${sawMapping}`);
  assert.ok(sawPredication > 40, `expected predication lines, saw ${sawPredication}`);
  assert.ok(sawAnnouncement > 40, `expected announcement lines, saw ${sawAnnouncement}`);
});

test('property: a line that merely mentions the marker retires nothing', () => {
  let sawMention = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...DECOYS),
      fc.constantFrom(...DECOY_PATHS),
      fc.constantFrom(
        'the description still names **RETIRED** behaviour',
        'mint `RETIRED-TICKET-TYPE` and re-run the gate',
        'see the RETIRED marker convention',
        '`RETIRED-TICKET-TYPE`, rename the type'
      ),
      (decoy, decoyPath, mention) => {
        sawMention += 1;
        const line = `- ${decoy} hygiene (\`${decoyPath}\`): ${mention}`;
        assert.deepEqual(
          extractRetiredReferents(line),
          [],
          `a line that retires nothing produced a token: ${line}`
        );
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(sawMention > 150, `expected mention-only lines, saw ${sawMention}`);
});
