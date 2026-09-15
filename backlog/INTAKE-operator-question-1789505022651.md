# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-15T20:43:42.651919115Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

CORRECTION (2026-09-15, same operator, same ask): the line below says
"routed to the expedite lane" - that is the WRONG lane and this correction
supersedes it. Per STEERING.md's own `human-requested` classification rule
("Do not launder a human request through `expedite`; tag it for what it
is"), a human-requested priority ask is `direction: queue-jump` (JumpQ),
never Article 3.2.4 `expedite` (that lane is severity-gated and reserved
for genuine critical/high defects the specifier classifies on its own
anti-inflation definition - this ask does not qualify itself for it).
Mint the resulting ticket(s) as `direction: queue-jump` with JumpQ-tier
priority, per the established convention documented in STEERING.md
(precedent: `INTAKE-prioritize-local-ollama-remaining-20260825.md`) -
`human_approval: approved` bundled in as part of that same convention,
same as that precedent. JumpQ pulls ahead of ordinary paused work; it does
NOT outrank a genuinely Article 3.2.4-expedited high/critical defect
already queued.

URGENT - human asks this be minted at top priority as a queue-jump (JumpQ), not queued behind other paused work. One systemic anti-pattern is minting a fresh high-severity unowned-red defect every day or two: property test files that SAMPLE a case space N times (N=3,6,12,20) and then assert every arm/case was reached, so each carries a real seed-miss probability (1-in-23 to 1-in-600) and flakes red in a QA lane run with no owner. Four tickets of this exact shape in the last few days, all fixed the same way: BL-1578, BL-1579 (landed), BL-1580 (active), BL-1581 (paused) - fix is always 'iterate the cases by construction, keep the floor asserted at its value'. Census as of 2026-09-15: grep -rl 'reach floor|reached.*floor|both arms.*reached' extension/test/*.property.test.js returns 48 of 407 property files. Requested: (1) a census sweep ticket - one pass over the 48, apply the construction-not-sampling fix to each, land as one or a few parcels (precedent: BL-1445's census of script git_handoff senders), removing any standing-reds.tsv rows in the same lands; (2) a preventive gate - a check that flags a NEW property test with this shape (low run count asserting full reach) at send time so the class stops growing. Operator relaying the human's explicit priority ask; the human judged this has to get done quickly.
