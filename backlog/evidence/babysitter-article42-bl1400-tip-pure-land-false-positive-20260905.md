# Article 4.2 escalation adjudication — BL-1400 tip-pure land

**Finding:** babysitter health sweep flagged `3cb48de0b22613edabb68732144fe9c8ba22cd08`
("BL-1400: tip-pure land -- own paths only, replayed onto origin/main"),
touching `extension/src/tools/check-feature-handler-registration.ts`,
`extension/test/bl1400NestedHandlerIsSeen.property.test.js`,
`extension/test/checkFeatureHandlerRegistrationCli.test.js`,
`specs/pipeline/steps/bl1400NestedHandlerIsSeenSteps.js` — pipeline code
landed on `main` outside QA (Article 4.2/BL-247).

**Investigation (2026-09-05):**
- `bash swarmforge/scripts/is_qa_ancestor.sh 3cb48de0b2` → rc=0,
  "approved: 3cb48de0b2 is a land-step replay of approved source
  d7722ab39e ... BL-1334". Approved land-approval record already existed —
  no race needed this time.
- `git merge-base --is-ancestor 3cb48de0b2 swarmforge-QA` → not an ancestor
  (expected tip-pure signature); `... origin/main` → is an ancestor.
- No bounce record for this sha or ticket.

**Verdict:** false positive — standard tip-pure-land ancestry shape,
already recorded as approved. Same class as
[[article42-predicate-is-ancestry-only-qa-handland-always-flags]].

**Action taken:** none — no revert, no escalation to the human. Recorded
here so any re-delivery of this sha's escalation is recognized as already
owned.
