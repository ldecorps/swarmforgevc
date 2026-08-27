# BL-1174 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner `6f43d78339` (ambulance patient). Cherry-picked tip-pure coder
`7995fe5e05` (17 paths) + cleaner evidence. Feature file from `main`.

## Scope

`/deprecate` soft verbs: ranked scan, one retirement per confirm (or refuse),
dry/check modes, hard-tier seat gate, docs/deprecated stubs. Wires into
telegram control/cursor operator cores (shared BL-698 verb surface).

## Architecture

- New cohesive module tree under `extension/src/tools/deprecate/` with thin
  `deprecate.ts` barrel — policy/scan/retire pure; CLI and telegram exec are
  adapters.
- Dep-gate **PASSED** on deprecate + telegram operator touch points.
- Co-change with telegram operator cores expected for verb registration —
  not a boundary leak. (Suspected coupling to `telegram-front-desk-bot.ts`
  is pre-existing operator surface.)

## Invariants (BL-654)

| invariant | encoding |
|---|---|
| One retirement per run (or refuse) | P1 |
| Living docs must not keep withdrawn behaviour | P4 (deprecated stub + index link) |
| Never auto-close tickets | P3 (backlog YAML untouched) |
| Hard-tier multi-document reasoner only | P2 |
| `mutation_cost: high` / BL-1001 no easy spill | Ticket YAML already `mutation_cost: high` (claim-path); runtime dual-enforced by P2 |

## Gates

| Gate | Result |
|---|---|
| Dep-gate | **PASSED** |
| Unit (deprecate + telegram cores) | **78/78** |
| Properties | **4/4** |
| Acceptance | **5/5** |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
