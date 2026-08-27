# BL-1027 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `7876a46b04` (on coder `7689f4d731`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Mint-time hygiene adds `:dangling-acceptance` beside BL-922's unreadable
check: when `acceptance-pointer-gate-lib/applicable?` says the line is a
real pointer and the path is absent from the working tree, refuse naming
ticket + path. Wired through `specifier_backlog_hygiene_gate` and the
repo-wide epic/milestone audit. Cleaner restored `violations-for-file`
arity with optional `repo-root`.

## Architecture

- Matches HOW: extend existing mint gate; consult `applicable?` (invariant
  1 — one checkability predicate); working-tree probe (not git cat-file);
  report all offenders in one run; absence / prose / glob / nested none
  never refused (invariant 2).
- BL-626 / BL-880 unchanged (consulted only).
- BL-922 block-scalar check still fires (scenario 03).

## Gates

| Gate | Result |
|---|---|
| Unit (`backlog_hygiene_lib_test_runner.bb`) | all passed |
| Properties (`bl1027_…_property_runner.bb`) | all passed |
| Acceptance (BL-1027) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer`.

By architect.
