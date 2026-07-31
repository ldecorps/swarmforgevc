# BL-716 architect bounce — dns-05 amendment lands mid-review

## What happened

- Cleaner forwarded commit `a5454da79f` for BL-716 (`git_handoff` received
  21:53:48Z). At that point `specs/features/BL-716-bubble-lets-talk-tunnel-hostname-dns.feature`
  had scenarios dns-01..dns-04 only.
- Reviewed `a5454da79f` against those four scenarios and the three declared
  invariants: BridgeClient/TalkEngine DNS-and-tunnel-failure classification is
  correct, invariants 1-3 hold, no architecture-boundary or dependency-gate
  violations (parcel touches only `android/app/...` + `strings.xml`, no
  `extension/src` files). Forwarded to hardender (`git_handoff`,
  `commit: a5454da79f`) before the item below was seen — it was still queued
  behind the git_handoff in FIFO order within the same priority tier.
- Next queued item: a `note` from coder — "BL-716 in your inbox is stale,
  dns-05 amendment inbound; hold review." Merging `main` surfaced
  `862a05f79` (specifier, committed 23:07:11Z): **BL-716: amend in-flight
  acceptance with discovery scenario dns-05**, landed on `main` *before*
  cleaner's forward but never picked up because cleaner's merge predated it.

## The gap

New scenario dns-05 (`specs/features/BL-716-bubble-lets-talk-tunnel-hostname-dns.feature`):

```
Scenario: Bubble can discover a new pairing URL without manual log hunting
  Given the public tunnel hostname has changed since the phone last paired
  When discovery runs via the chosen channel (deep link, stable hostname, or fixed discovery doc)
  Then Bubble's stored bridge base URL matches the live host URL
  And a Let's Talk turn no longer fails solely on the stale hostname
```

`a5454da79f` implements only the failure-classification/UX half of this ticket
(Phase.ERROR, friendly DNS/tunnel messages, `connection_error_hint` string).
It explicitly does **not** implement any discovery channel — the coder's own
commit message says so ("No deep-link/discovery-document build-out
attempted — out of scope for a queue-jump defect fix per the ticket's own
'do not redesign' note"), which was the *correct* call against the
pre-amendment contract (dns-01..04 only needed the manual Settings -> Edit
pairing path, already wired). dns-05 changes that: the ticket description's
"App discovery" section already names the near-term channel — **(2) Deep
link / App Link from the existing Telegram notify** — so this is actionable
without a further specifier round-trip.

Per "Amending An In-Flight Ticket's Spec" (workflow.prompt) and the
specifier's own amendment commit message: "dns-05 adds work: its step
handler must land in the same parcel or the acceptance runner hard-fails on
an unhandled scenario (BL-233)." Neither the deep-link mechanism nor a step
handler for dns-05 exists in `a5454da79f`.

## Disposition

- **D1** (class `acceptance`, blamed role: coder): dns-05 requires a deep-link
  (or equivalent) discovery mechanism writing `CompanionPrefs`' bridge base
  URL from the Telegram-notified pairing link, plus a step handler for dns-05
  wired in the same parcel. Not present in `a5454da79f`. Bounced to coder.
- The hardener was already handed `a5454da79f` before this was discovered; a
  `note` follows telling it to hold/disregard that forward — a corrected
  parcel (this ticket, re-reviewed once dns-05 lands) will follow through the
  normal chain.
- No architecture-boundary, dependency-gate, or other invariant issue found
  in `a5454da79f` itself — that portion of the work stands and should be kept
  by the coder, not redone.

By architect.
