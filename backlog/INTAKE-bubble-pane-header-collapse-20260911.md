# Intake: Bubble's ticket-header card needs a collapse control

Filed by the human via Claude Code (2026-09-11T18:02Z, Bubble screenshots
attached). RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## The ask

Human, verbatim: "any chance to add a collapse button on the header? the
description is so verbose we can see the panes below." (typo "dewxription"
in the original, read as "description.")

## What was observed (screenshots, Bubble at bble.musicalsifu.com)

The ticket-header card at the top of the Bubble screen (currently showing
BL-1525's title plus its full `description`/`notes`-style prose — the
`daemon_cycle_guard_lib_test_runner.bb` spawn-subtree paragraph, several
hundred words, attributed "Architect · Sonnet 5 · entered 3m ago") renders
at FULL HEIGHT with no way to shrink it. On a phone screen this pushes the
COORDINATOR / RESIDENT pane grid below it entirely off the visible area —
the second screenshot shows the same card expanded further (a `+`/`-` size
toggle exists and was already tried) with the pane grid still not reachable
without scrolling past the whole description.

## What is wanted

A collapse/expand control on the header card itself (distinct from the
existing `-`/`+` text-size toggle visible in the second screenshot, which
changes font size, not visibility) so the long description can be minimized
to a title-only or few-line summary, keeping the live pane grid
(COORDINATOR, RESIDENT, and any other live panes) on-screen without
scrolling on a phone-sized viewport.

## Surface

This is Bubble, the LIVE holistic UI (token auth, live pane status) per
Local Engineering Architecture Rule 5 — not the static backlog-dashboard
PWA. Per Article 1.10, look-and-feel review of Bubble is the art-director's
domain (design brief), which the specifier mints tickets from; route
accordingly if art-director is staffed, or spec it directly if not.
