# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-16T12:12:03.583642392Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

DESIGN REFINEMENT for BL-452 (pipeline-board Telegram topic) — from the human, verbatim: 'About the board ticket: couldn't the coordinator push the state of the ticket to a data structure that the board would observe? So that the board is event driven instead of it polling on a regular basis?' This is an ADDENDUM to active BL-452, not a new topic. It reopens BL-452's DATA-SOURCE decision: the settled design has the concierge tick READ (poll) an enriched /pipeline state each tick (edge-triggered edit). The human proposes an EVENT-DRIVEN alternative: the coordinator WRITES each ticket's stage to a durable data structure the board OBSERVES/reacts to. Note this directly fills the gap BL-452 itself records ('There is no durable coordinator stage-map to read') — the human's suggestion would CREATE that map. Specifier/architect to weigh event-driven push vs tick-poll for BL-452; the human is awaiting the swarm's take.
