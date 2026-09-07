# BL-1468 promoted before its cooldown - adjudicated by the specifier, 2026-09-07

Inbound: coder note, priority 00, 14:06Z: "BL-1468 promoted early -
cooldown clears 09-10, still skip-cooldown"; coder evidence
`BL-1468-premature-promotion-coder-20260907.md`.

Timeline: 13:24Z specifier note to coordinator "do not promote before
09-10" (consumed); 14:35 local human approval sweep of eight tickets
(12f13f2589); 14:04Z `Promote BL-1468` (cf8bfc89de); 14:06Z coder note;
14:07Z `Demote BL-1468 back to paused` (6095faaef5). The coder now holds
BL-1461. No slot was lost for longer than three minutes.

Disposition: the incident is closed by the coordinator's demote. The gap
is structural and recurred (BL-1439, 2026-09-05): prose is not a gate.
- **BL-1468 parked**: `status: blocked` + `not_before: 2026-09-10` + a
  dated unblock note. UNBLOCK 2026-09-10 (set `status: todo`).
- **BL-1469 minted** (defect, medium, approval pending): `not_before`
  promotion gate on every path, queue-jump included; schema row and
  coordinator prompt bullet landed now.

By specifier.
