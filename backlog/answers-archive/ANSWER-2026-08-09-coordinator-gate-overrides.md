# Answer — 2026-08-08 briefing ask #3 (coordinator gate overrides)

**Human, 2026-08-09:** Yes — both overrides were the right call.

Confirmed:

1. Promoting **BL-852** past the orthogonality refusal against active BL-848
   (shared `epic:swarm-reliability`, zero real file overlap) — justified by
   live chase-sweep damage on the ambulance-held BL-722 handoff. Follow-up
   remains **BL-854** (advise instead of hard-block on epic-tag-only matches).

2. Hand-promoting **BL-852** and **BL-853** past the broken depth-cap fallback
   (`-1` misread as cap 5) — justified because auto-promote itself was
   refused by the bug BL-853 fixes. BL-853 has since shipped.

Gate overrides stay exceptional; do not treat them as routine once BL-854
lands.
