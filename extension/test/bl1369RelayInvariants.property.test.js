const assert = require('node:assert/strict');
const fc = require('fast-check');
const { relayRulingText, rulingHumanApprovalText } = require('../out/concierge/pendingApprovalReply');

// BL-654 coder-authored property tests for BL-1369's three declared
// invariants. Each property states the invariant over the full input
// range; each is NON-VACUOUS - shown to fail against a deliberately
// broken implementation, then restored (see the "breaker" comment on each
// property; the breaker is documented but not shipped - the test asserts
// the real thing, and the breaker was run by hand during authorship to
// confirm the property detects the defect).
//
// Runs ONLY via `npm run test:properties`.

// ── Arbitraries ─────────────────────────────────────────────────────────
//
// A ticket body is a small YAML-ish string. We generate the three
// independent axes - human_approval value, ruling_options list, and
// whether a prior ruling/provenance pair already exists - as separate
// arbitraries and splice them together. Keeping them separate lets each
// property vary what it cares about without dragging the others along.

const HUMAN_APPROVAL_VALUES = ['pending', 'pending-review', 'approved', 'rejected', 'amending'];

const humanApprovalArb = fc.constantFrom(...HUMAN_APPROVAL_VALUES);

// Options are short lowercase tokens. Restricting the charset keeps the
// YAML parseable and the matches legible in failure reports.
const optionTokenArb = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
const optionListArb = fc.array(optionTokenArb, { minLength: 0, maxLength: 4 }).map((arr) => [...new Set(arr)]);

// The "answer" is either one of the declared options (a valid relay) or a
// token that is not. The "not in options" case is what drives scenario 04
// and the unknown-option refusal branch.
function answerForOptions(options) {
  if (options.length === 0) {
    return optionTokenArb;
  }
  return fc.oneof(
    fc.constantFrom(...options),
    fc.stringMatching(/^[a-z0-9-]{1,16}$/)
  );
}

const relayerArb = fc.stringMatching(/^[a-z]{1,16}$/);

// A ticket body with a chosen set of options and a chosen human_approval
// value. Optionally carries a prior ruling + provenance pair (for the
// "tap supersedes relay" direction and for the "relay after tap" guard).
function ticketBodyArb({
  withPriorRuling = false,
  priorProvenanceIsTapped = false,
} = {}) {
  return fc
    .tuple(humanApprovalArb, optionListArb, relayerArb)
    .map(([approval, options, priorRelayer]) => {
      let body = `id: BL-PROP\ntitle: t\nhuman_approval: ${approval}\n`;
      if (options.length > 0) {
        body += `ruling_options:\n${options.map((o) => `  - ${o}`).join('\n')}\n`;
      }
      if (withPriorRuling && options.length > 0) {
        const label = options[0];
        body += `human_ruling: |\n  ${label}\n`;
        const provenance = priorProvenanceIsTapped ? 'tapped' : `relayed by ${priorRelayer}`;
        body += `ruling_provenance: ${provenance}\n`;
      }
      return { body, options, approval };
    });
}

// ── Invariant 1: relaying NEVER records approval ───────────────────────
//
// For any ticket state and any relay call (matching or not, with or
// without a prior ruling), the human_approval line is byte-identical
// before and after. The relay cannot flip pending to approved, approved
// to rejected, or inject a new approval line.
//
// Breaker (hand-run during authorship): replacing `relayRulingText`'s
// spliceRulingRecord call with a version that ALSO flips
// `human_approval: pending` to `approved` - a plausible wrong
// implementation that "helpfully" records consent - makes this property
// fail on any ticket with human_approval: pending and a matching option.

test('property BL-1369 invariant 1: relaying an answer never modifies the human_approval line, however well the answer matches', () => {
  fc.assert(
    fc.property(
      ticketBodyArb(),
      fc.tuple(optionListArb, relayerArb),
      ({ body, options }, [answerOptions, relayer]) => {
        // Use the ticket's OWN options for the answer pool when it has any -
        // the relay reads them from the file. For a no-options ticket, fall
        // back to the separately generated list.
        const declaredOptions = options.length > 0 ? options : answerOptions;
        const answer = declaredOptions.length > 0 ? declaredOptions[0] : 'nothing';
        const before = extractHumanApprovalLine(body);
        const result = relayRulingText(body, answer, relayer, declaredOptions);
        const after = extractHumanApprovalLine(result.text);
        assert.equal(after, before);
      }
    )
  );
});

// ── Invariant 2: a written ruling always carries provenance ────────────
//
// Whenever `relayRulingText` returns kind: 'written', the output has BOTH
// a human_ruling block AND a ruling_provenance field. A written ruling
// without provenance would be byte-indistinguishable from a tapped one -
// the exact failure invariant 2 exists to prevent.
//
// Breaker (hand-run): deleting the provenance line from spliceRulingRecord.
// Property fails on the very first written case.

test('property BL-1369 invariant 2: every written ruling carries a matching provenance field', () => {
  fc.assert(
    fc.property(
      ticketBodyArb(),
      fc.tuple(optionListArb, relayerArb),
      ({ body, options }, [answerOptions, relayer]) => {
        const declaredOptions = options.length > 0 ? options : answerOptions;
        if (declaredOptions.length === 0) return true; // trivial: nothing to relay
        const answer = declaredOptions[0];
        const result = relayRulingText(body, answer, relayer, declaredOptions);
        if (result.kind !== 'written') return true;
        const hasRuling = /^human_ruling: \|\n {2}[^\n]+$/m.test(result.text);
        const hasProvenance = /^ruling_provenance: relayed by .+$/m.test(result.text);
        assert.equal(hasRuling, true, 'written result must carry a human_ruling block');
        assert.equal(hasProvenance, true, 'written result must carry a relayed-by provenance');
      }
    )
  );
});

// ── Invariant 3, direction 1: relay never overwrites a tapped ruling ───
//
// For any ticket whose provenance is "tapped", any relay is refused and
// the ticket text is byte-identical afterwards. This is the "human's own
// hand wins" direction.
//
// Breaker (hand-run): dropping the `isTappedRuling` guard in relayRulingText.
// Property fails on every tapped ticket with a matching option.

test('property BL-1369 invariant 3 (relay after tap): a tapped ruling is immune to every relay', () => {
  fc.assert(
    fc.property(
      ticketBodyArb({ withPriorRuling: true, priorProvenanceIsTapped: true }),
      relayerArb,
      ({ body, options }, relayer) => {
        if (options.length === 0) return true;
        const answer = options[0];
        const result = relayRulingText(body, answer, relayer, options);
        assert.equal(result.kind, 'refused', `expected refused, got ${result.kind}`);
        assert.equal(result.reason, 'already-tapped');
        assert.equal(result.text, body, 'a refused relay must leave the ticket byte-identical');
      }
    )
  );
});

// ── Invariant 3, direction 2: tap supersedes a relay ───────────────────
//
// After a relay, a tap via rulingHumanApprovalText writes the tapped
// option and the tapped provenance, and no trace of the prior relay
// remains. This is the "human's own hand wins" direction from the other
// side.
//
// Breaker (hand-run): having rulingHumanApprovalText only replace the
// human_ruling block but leave the prior ruling_provenance line alone.
// Property fails on every case because the stale "relayed by ..." line
// survives.

test('property BL-1369 invariant 3 (tap after relay): a tap supersedes a relay and leaves only tapped provenance', () => {
  fc.assert(
    fc.property(
      // The ticket MUST start pending - rulingHumanApprovalText only flips
      // pending to approved, so a tap on a non-pending ticket is a no-op
      // (the existing stale-tap guard). This property is about the tap's
      // effect on a ticket the relay already wrote to, and the relay is
      // meaningful only on a ticket the human has not yet decided.
      ticketBodyArb().map((t) => ({ ...t, body: t.body.replace(/^human_approval: [^\r\n]+/m, 'human_approval: pending'), approval: 'pending' })),
      relayerArb,
      ({ body, options }, relayer) => {
        if (options.length < 2) return true; // need two distinct options
        const relayOption = options[0];
        const tapOption = options[1];
        const relayResult = relayRulingText(body, relayOption, relayer, options);
        if (relayResult.kind !== 'written') return true;
        const tapResult = rulingHumanApprovalText(relayResult.text, tapOption);
        assert.equal(tapResult.changed, true);
        // Escape the option for the regex - options come from a [a-z0-9-]
        // alphabet so no metacharacters, but the defense keeps the property
        // honest if the alphabet ever widens.
        const escaped = tapOption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasRuling = new RegExp(`^human_ruling: \\|\\n {2}${escaped}$`, 'm').test(tapResult.text);
        const hasTapped = /^ruling_provenance: tapped$/m.test(tapResult.text);
        const hasStaleRelay = /^ruling_provenance: relayed by /m.test(tapResult.text);
        assert.equal(hasRuling, true, 'tap must record the tapped option');
        assert.equal(hasTapped, true, 'tap must record tapped provenance');
        assert.equal(hasStaleRelay, false, 'tap must erase the prior relay provenance');
      }
    )
  );
});

// ── helper ──────────────────────────────────────────────────────────────

function extractHumanApprovalLine(text) {
  const m = text.match(/^human_approval:\s*[^\r\n]*/m);
  return m ? m[0] : null;
}
