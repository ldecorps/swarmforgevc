# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-15T23:56:58.564592796Z","feature_name":"A natural-language approval ends the negotiation and never mutates the contract","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-442-negotiation-approval-not-objection.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: A natural-language approval ends the negotiation and never mutates the contract

# BL-442 (bug): the first real FES onboarding run, 2026-07-15. The human replied "All agreed" in the
# negotiation topic. negotiationTelegramRouting.ts's AGREEMENT_PATTERN is anchored single-word
# (/^\s*(agree|agreed|approve|approved|lgtm|yes)[.!]?\s*$/i), so the two-word "All agreed" failed the
# match and fell through to the objection path (classifyNegotiationReply -> {action:'objection'}). The
# revision then ran a round and objectToContract BLIND-APPENDED the reply as a new boundary line
# ("- 'Per operator objection: All agreed'", FES commit 4b6f32b), so the AGREED contract carried a junk
# clause fabricated from the approval itself (stripped by hand, 329d101). Two defects, both fixable:
# (a) common natural-language approvals must not route down the objection path; when ambiguous, ASK in
# the topic rather than mutate; (b) the revision must NEVER verbatim-append objection text as a contract
# clause - a revision that cannot derive a change from the reply posts "couldn't derive a change -
# rephrase?" and leaves the contract untouched.
#
# Scope (verify at build time): extension/src/onboarding/negotiationTelegramRouting.ts (approval-intent
# classification) and extension/src/onboarding/contractNegotiation.ts (objectToContract must not append
# raw objection text). This is a correctness fix to the classification and the revision, not a new
# feature. BL-344 is the parent feature; its own spec named this exact failure class.

# Hardener (BL-234 equivalent-mutant note): a soft Gherkin mutation pass over
# this outline's <reply> examples casing-flips one character of each value
# ("All agreed" -> "AlL agreed", "ok" -> "oK", etc.) and every mutant SURVIVES
# - by design, not a gap. AGREEMENT_PATTERN (negotiationTelegramRouting.ts) is
# case-insensitive (`/i`), so isAgreementText provably treats every casing of
# a recognized word identically; no assertion could ever differentiate the
# mutant from the original without penalizing a real human typing "OK"
# instead of "ok". Verified: all 5 example values, all 5 survivors are pure
# casing mutations of an already-recognized word (confirmed via the tool's
# own mutation descriptions). Recorded here per the equivalent-mutant carve-
# out rather than forced into an artificial kill.
# BL-442 negotiation-approval-not-objection-01
Scenario Outline: A common natural-language approval ends the negotiation and runs no revision round
  Given a contract is out for negotiation in the topic
  When the authorized human replies "<reply>"
  Then the reply is classified as approval
  And no revision round runs
  And the contract is left unchanged

  Examples:
    | reply       |
    | All agreed  |
    | agreed      |
    | ok          |
    | approve     |
    | lgtm        |

# BL-442 negotiation-approval-not-objection-02
Scenario: An ambiguous reply is asked about in the topic rather than mutating the contract
  Given a contract is out for negotiation in the topic
  When the authorized human sends a reply whose intent cannot be confidently classified
  Then a clarifying question is posted back in the topic
  And the contract is left unchanged

# BL-442 negotiation-approval-not-objection-03
Scenario: A revision that cannot derive a change posts back to rephrase and never appends the text
  Given a contract is out for negotiation in the topic
  When an objection arrives from which no concrete contract change can be derived
  Then the topic is told the change could not be derived and asked to rephrase
  And no line containing the raw objection text is appended to the contract

# BL-442 negotiation-approval-not-objection-04
Scenario: A revision never writes raw objection text as a contract boundary line
  Given a contract is out for negotiation in the topic
  When any objection is processed into a revision
  Then no contract boundary or clause is the verbatim objection text
