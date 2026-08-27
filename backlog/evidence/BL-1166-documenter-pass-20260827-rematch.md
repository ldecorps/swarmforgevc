# BL-1166 — documenter pass — 20260827 rematch

## Inbound

Hardener tip `eca7d7f1a1`. Merge ancestry on `swarmforge-documenter`.
Task `BL-1166-bubble-authored-docs-index-and-first-pages`.

## Living docs

Restored Specification Last Updated and architecture note (lost during
merge-ups). How-to and index link unchanged from prior pass.

## Pipeline wiring

Materialized `bl1166_operator_docs_mutation_sweep.sh` and hardener rematch
evidence. Removed duplicate `bl1166OperatorDocsSteps` registration in
`specs/pipeline/steps/index.js`.

## Pre-QA

Ticket acceptance resolves to
`specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature`.

By documenter.
