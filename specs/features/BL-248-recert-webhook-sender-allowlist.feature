Feature: the recert inbound-email webhook accepts proposals only from allowlisted senders

  # Operator request 2026-07-10 (via architect). Today handleInboundEmailWebhook
  # (extension/src/notify/recertInboundWebhook.ts) authenticates the svix signature
  # + timestamp freshness and then parses subject/body — but never checks WHO sent
  # the email. So any email that reaches the recert address and parses commits a
  # recertification proposal. This adds a sender allowlist as the authorization
  # layer. The allowlist is a dep passed into the deployment-agnostic core (like
  # the svix `secret`), sourced from the serverless env — the function cannot read
  # this host's .swarmforge/. FLAGS FOR HUMAN REVIEW: (1) empty/missing allowlist
  # fails CLOSED (rejects all) — a deliberate secure default that changes today's
  # accept-all behavior; (2) the reject status code (403 vs a quiet 200 "ignored")
  # is an architect call.

  Background:
    Given the recert inbound-email webhook with a configured sender allowlist
    And a validly-signed, fresh request whose email parses as a recertification proposal

  # BL-248 allowlisted-sender-commits-01
  Scenario: a valid recert email from an allowlisted sender still commits a proposal
    Given the request's sender is on the allowlist
    When the webhook handles the request
    Then a proposal is committed

  # BL-248 non-allowlisted-rejected-02
  Scenario: a recert email from a non-allowlisted sender is rejected
    Given the request's sender is not on the allowlist
    When the webhook handles the request
    Then no proposal is committed
    And the sender rejection is logged

  # BL-248 sender-match-case-insensitive-03
  Scenario Outline: sender matching is case-insensitive on the email address
    Given the allowlist contains "ops@example.com"
    And the request's sender is "<sender>"
    When the webhook handles the request
    Then the recert proposal is "<outcome>"

    Examples:
      | sender           | outcome       |
      | ops@example.com  | committed     |
      | OPS@Example.com  | committed     |
      | evil@example.com | not committed |

  # BL-248 empty-allowlist-fail-closed-04
  Scenario: an empty or missing allowlist rejects every sender (fail closed)
    Given the sender allowlist is empty
    When the webhook handles the request
    Then no proposal is committed
