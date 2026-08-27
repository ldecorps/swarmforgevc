Feature: Webhook-signature test fixtures carry no scanner-tripping secret literal

  # GitGuardian flagged a "Stripe Webhook Secret" (a whsec_-prefixed value) across
  # 26 commits of swarmforgevc. Every occurrence is a TEST fixture / evidence-doc
  # literal for BL-217's svix-style inbound-email signature check — the production
  # receiver (recertInboundWebhook.ts) injects the secret via deps.secret and never
  # hardcodes it. The whsec_ prefix is shared by Svix and Stripe, hence the label.
  # The fix: fixtures build their secret at runtime from an obviously-fake seed
  # (exactly like the existing wrongSecret line in svixSignature.test.js), so no
  # committed file contains a whsec_ high-entropy literal for a scanner to catch,
  # and a guard keeps it that way. Rotation of the live secret, IF it was ever a
  # real one, is a provider-dashboard action the operator performs separately.

  # BL-225 no-literal-secret-01
  Scenario: no tracked file embeds a whsec_ high-entropy secret literal
    Given the repository working tree
    When it is scanned for a webhook signing-secret literal (a "whsec_" prefix directly followed by a long base64 token)
    Then no tracked file contains one

  # BL-225 tests-still-verify-02
  Scenario: the svix signature tests still pass with a runtime-built fixture secret
    Given the signature tests build their fixture secret at runtime from an obviously-fake seed
    When the test suite runs
    Then the signature accept and reject tests pass exactly as before

  # BL-225 evidence-redacted-03
  Scenario: the BL-217 bounce evidence doc no longer embeds the literal secret
    Given the BL-217 inbound-webhook bounce evidence document
    Then its reproduction snippet builds the secret at runtime or shows a redacted placeholder, never a whsec_ literal

# Non-behavioral gates:
#  - Regression guard (owns scenario -01): a committed check greps the tree for
#    /whsec_[A-Za-z0-9+/]{20,}/ and fails if any match exists, so a future fixture
#    cannot silently reintroduce a scanner-tripping literal. Runtime-constructed
#    forms ('whsec_' + Buffer.from(fakeSeed).toString('base64')) do not match and
#    are the sanctioned pattern.
#  - Behavior-preserving: the HMAC secret still base64-decodes to real bytes, so
#    verifySvixSignature accept/reject and the replay/timestamp tests are unchanged;
#    tests stay instant, no real timers.
#  - Operator action (NOT pipeline work): mark the GitGuardian incident resolved /
#    false positive. NO rotation needed — the value is confirmed to be Svix's
#    own public docs example secret, never a live credential (quoting it here
#    would reintroduce the same scanner-tripping literal this feature exists
#    to remove). History rewrite is out of scope (no real secret to purge);
#    this neutralization is the whole fix.
