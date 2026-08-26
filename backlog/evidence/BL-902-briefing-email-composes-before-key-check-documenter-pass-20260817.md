# BL-902 briefing-email-composes-before-key-check — documenter pass — 20260817

Commit reviewed: `7c5b6cedad` (hardener's forward, `merge_and_process hardender
7c5b6cedad`), which carries architect's `c80a0b054` (findings NONE), cleaner's
`1f457fad0` (skip-reason/log-key dedupe, no behavior change), and coder's
`5f0f43f12` ("decide briefing-email sendability before composing") /
`340576b20` (acceptance-pointer flip). Merge-base confirmed an ancestor of
this branch before this pass ran.

## What changed

`handoffd`'s briefing-email sweep composed the entire briefing (11 optional
section adapters, diagrams, markdown render) before ever checking whether
`RESEND_API_KEY` was present — a ~96s wasted compose on every cycle with the
key absent, driving the freshness-watchdog restart storm the intake reported.
`daemon_alarm_lib.bb` now exposes a pure `email-send-reason` /
`configured-email-send-reason` predicate (conf+env only, no I/O), and
`briefing_email_lib.bb`'s `send-unsent-briefings!` consults it before
composing, skipping straight to the same `briefing-skip-*` log line when
undeliverable. `handoffd.bb` wires the new predicate in, keeping the existing
one-shot missing-key warning via the same atom. Hardener's own pass added a
Gherkin-mutation manifest for the promoted feature file — no code change.

The ticket's own invariants require the outcome to be byte-identical to
today's behaviour: same log lines, same unsent/retry semantics, same
one-shot warning — only the timing of when sendability is decided changes.
Architect's independent re-run of both compose paths before/after confirmed
identical logic.

## Doc surfaces checked

- `docs/reference/Specification.MD` — grepped for `briefing-email`,
  `RESEND_API_KEY`, `send-unsent-briefings`, `freshness`: several existing
  entries describe the briefing's optional-section composition (BL-256,
  BL-260, etc.) and none claim anything about compose-before-or-after the
  key check — this parcel changes internal daemon timing, not any of the
  documented section behavior, format, or content. No entry became stale.
- `docs/how-to/` — no runbook documents the briefing-email send path or the
  freshness-watchdog restart behavior; nothing to update.
- `docs/diagrams/architecture.mmd` / `swarm-flow.mmd` — no new component,
  boundary, or pipeline topology; the fix is entirely inside `handoffd`'s
  existing briefing-sweep step. No diagram update warranted.
- No new human-facing command, setting, or config key was introduced (the
  ticket explicitly rules out touching `daemon_freshness_threshold`).

## Verdict

NONE. No human-facing documentation requires a change for this parcel: it is
an internal daemon performance/ordering fix with an explicit byte-identical
external-behavior invariant, confirmed independently by architect.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-902-briefing-email-composes-before-key-check`.

By documenter.
