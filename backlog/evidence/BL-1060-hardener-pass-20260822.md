# BL-1060 hardener pass — 2026-08-22

**Parcel:** cleaner-forwarded commit `c39f7365db` ("Merge commit '48e38aaadd'
into swarmforge-cleaner"), merged into `swarmforge-hardender` cleanly (no
conflicts). Cleaner did no independent cleanup — the merge is a straight
pass-through of the coder's fix plus the specifier's scenario-05 amendment.

## Stage set

`required_stages: [coder, cleaner, hardender, qa]` — architect and documenter
are explicitly skipped with reasons recorded in the ticket's
`stage_skip_reasons` (no design/module change; no documentation surface
changes). Forwarding to **QA directly**, not documenter, per that recorded
routing.

## Fix scope

`extension/src/concierge/residentSpyTunnelNotify.ts` — both
`buildResidentSpyTunnelTopicButtons` and
`buildResidentSpyTunnelPrivateWebAppButtons` now read `urls.pairingHttpsUrl`
instead of `urls.pairingDeepLink` for the "Update Bubble pairing" button, so
Telegram's Bot API (http(s)/tg: only) accepts it. `pairingDeepLink` itself is
untouched, per the ticket's explicit scope boundary.

## Suites re-run directly (all green)

- `npx vitest run test/residentSpyTunnelNotify.test.js
  test/notifyResidentSpyTunnelCli.test.js` — 60/60 pass (fresh `npm run
  compile` first, since the merge touched TS source and `out/` is
  gitignored).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1060TelegramButtonUrlScheme.property.test.js` — 4/4 pass, run in the
  separate property lane, not folded into coverage/mutation.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh` on the feature) —
  9/9 pass, including the specifier's scenario-05 amendment (surface × app
  Scenario Outline replacing the impossible "Resident Spy on the topic
  keyboard" combination).

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1060-bubble-pairing-button-uses-a-scheme-telegram-rejects.feature \
      ./tmp/bl1060-mutation-workdir \
      specs/pipeline/steps/index.js \
      soft

Result: `outcome: pass`, **10/10 killed**, 0 survived, 0 errors, across all
three `Scenario Outline`s (01: 2 examples, 02: 2 examples, 05: 3 examples ×
2 columns = 6). The two `surface`/`app` KNOWN-VALUE checks in the step
handler correctly hard-fail on an unrecognized cell rather than passing
through — confirmed by the mutant output itself (`unknown mini app "resident
Spy"`, `unknown surface "Private DM"`), not a shape-based lookup that would
have silently ignored the flip. Manifest embedded in the feature file
(`tested_at` 2026-08-22T14:50:42Z). Mutation workdir removed; no
`gherkin-mutator`/`mutationWorker.js` processes left running.

## Independent non-vacuity check (ticket's own qa_e2e_procedure step 2)

Reverted `buildResidentSpyTunnelTopicButtons` back to `urls.pairingDeepLink`
by hand (single-writer discipline: no other suite was running against the
file at the time), recompiled, and re-ran the two unit-test files: **2
failures**, both naming the exact defect —
`scheme: 'swarmforge-bubble:'` on the "Update Bubble pairing" button,
including the scenario written specifically to hold the shipped defect
still (`the scheme check refuses the bare app-scheme URI, naming the
scheme`). Restored the source (`diff` against a pre-mutation copy: clean),
recompiled, re-ran clean (60/60). The guard is not decorative.

## CRAP (TypeScript file touched)

`node scripts/crapReport.js src/concierge/residentSpyTunnelNotify.ts`
(coverage scoped to the two touched-file test files, `npx vitest run
--coverage test/residentSpyTunnelNotify.test.js
test/notifyResidentSpyTunnelCli.test.js`):

    buildResidentSpyTunnelTopicButtons          complexity=1  CRAP=1.00
    buildResidentSpyTunnelPrivateWebAppButtons  complexity=1  CRAP=1.00

Both touched functions are well under the <=6 threshold. Two OTHER
functions in the same file (`syncResidentSpyTunnelUrl` CRAP=12.00,
`shouldNotifyResidentSpyTunnel` CRAP=8.00) are flagged, but confirmed
UNTOUCHED by this diff (`git diff <coder-base>..<parcel> -- residentSpyTunnelNotify.ts`
shows only the two button builders changed) — pre-existing debt, not a
regression, and per the differential-complexity rule there is nothing to
compare since neither was edited.

## DRY

`npm run dry` (jscpd over `extension/src`): 34 clones repo-wide, none in
`residentSpyTunnelNotify.ts`. No duplication introduced.

## Orphaned processes

Checked before and after every run (`pgrep -fl 'node --test|stryker|gherkin-mutator|mutationWorker'`)
— clean throughout. No leftover fixture temp dirs (both the acceptance step
handler and the property test track/clean their `mkdtempSync` roots
immediately after creation).

## Verdict

Hardened. The fix's two invariants (accepted-scheme button URLs; a test
that asserts the scheme property rather than an identifier) are proven by
60 unit assertions, a 4-case discovery-floored property test, 9/9
acceptance, and 10/10 Gherkin mutation kills across all three Outlines — no
survivors. Independently re-verified the guard is non-vacuous by reverting
the fix and watching it fail loud and specific. CRAP/DRY clean on the
touched code; two pre-existing CRAP-flagged functions in the same file are
untouched and out of scope. Forwarding directly to **QA** per the ticket's
recorded stage skip (architect and documenter both skipped).

By hardender.
