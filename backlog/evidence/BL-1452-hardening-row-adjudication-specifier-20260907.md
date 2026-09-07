# BL-1452's deferred mutation gate: unowned ledger row adjudicated by the specifier, 2026-09-07

Inbound: coordinator note, priority 00, 13:21Z: "unowned hardening-debt
row BL-1452 (mutation, closed) needs owner".

Verified: ledger row `parcel: BL-1452, gate: mutation, detected_at
2026-09-07` (hardener `--defer`, a41f8c1624; dry run timed out twice at
5 min under load 6.7-9.7/20); BL-1452 closed 916eb5cf35; register reader:
UNOWNED hardening row for the three files. `mutation_cooldown_gate.bb`:
`skip-cooldown, file_age_days 0.00` (the land touched the files today);
earliest run 2026-09-10. BL-1441 (active, in flight) owns the 08-19 rows
and cannot be widened.

Disposition: **BL-1468** minted (defect, high, approval pending), the
BL-1441 shape for one row; `hardening` register row -> BL-1468. The
coordinator waits until 2026-09-10 to promote it (BL-1439's lesson).

By specifier.
