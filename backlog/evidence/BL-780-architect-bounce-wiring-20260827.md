# BL-780 — architect bounce — required_wiring token — 20260827

**Context:** Invariant rematch tip `7d6962783` / ancestry `a240d48ecf` passed
architect gates (property + APS 5/5) but **PRE_QA gate** refuses forward:

`handoffd.bb does not contain "config-threshold-inversion"`

## Inventory

### D1 — `behavior` / required_wiring (blame: coder)

Ticket `required_wiring` names:
`swarmforge/scripts/handoffd.bb::config-threshold-inversion::startup warning…`

Live daemon logs:
`log! "rotation-actionability-ordering-inverted" …`

Acceptance is green against the live key; PRE_QA string-match is not.

**Remediation:** Emit the required_wiring token `config-threshold-inversion`
(keep or alias the inverted message body), **or** get specifier to retarget
`required_wiring` to the live log key. Do not leave PRE_QA red.

By architect.
