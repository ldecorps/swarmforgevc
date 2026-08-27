# BL-780 — coder rematch — architect wiring bounce 20260827

## Bounce

Architect `87d227cc66`: PRE_QA required `handoffd.bb` contain
`config-threshold-inversion`; live log key was
`rotation-actionability-ordering-inverted`.

## Rematch

`log-rotation-actionability-ordering-warnings!` now emits both keys
(`config-threshold-inversion` first, then the live alias) so PRE_QA and
acceptance stay aligned.

By coder.
