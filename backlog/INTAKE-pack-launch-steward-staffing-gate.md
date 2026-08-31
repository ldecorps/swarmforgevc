# INTAKE — Pack launch must refuse a seat whose model is not steward-certified for that role

**Source:** human via Cursor, 2026-08-31 ~15:16 BST  
**Priority:** high — live BoB pack staffed QA with a model that is not on the QA role-matrix  
**Epic:** `swarm-intelligence-layer` (Model Steward / ModelFactory orbit; sibling to BL-1127 staffing bar)

## Human ask (verbatim)

> Model steward should certify before a model staffs a swarm role.
> Yes go ahead [mint intake + restaff QA off nemotron]

## Why this is broken today

1. **ModelFactory** `assign` / cold-apply / BL-669 failover already consult
   `assignment-eligible?` (global `certified` status).
2. **Pack `window` lines bypass that path.** A pack can pin any
   `agent`/`--model`/`--openai-api-base` and `./swarm --pack …` will staff
   the seat with **no steward consult**.
3. **Global `certified` ≠ certified for the role.** Live example
   2026-08-31: `opencode/nemotron-3-ultra-free` is registry-`certified` on a
   thin coder HTTP-200 scorecard, but:
   - `QA-gate` is still `human-verdict-pending`
   - it does **not** appear on `model-steward role-matrix QA`
   - yet `bob-multi-provider-mono-router` / `bob-multi-provider-forge` pin
     QA to that model
4. Live consequence: QA (aider/nemotron) printed a BL-1303 TASK and idled /
   auth-thrashed instead of `merge_and_process` — wrong tool for the gate
   role.

Precedent: **BL-1127** local-coder battery staffing gate before Ollama pack
launch (`local_coder_battery_staffing_gate.sh`). This intake asks for the
same shape for **every pack window**, not only local coder.

## Desired invariant

Before a swarm launch (or mono-router rotate that materialises a role's
launch script) staffs role R with provider/model M:

- Steward must rank M for R (role-matrix entry with battery/scorecard
  evidence), **and**
- the role's compliance gate for R must be decided pass (not
  `human-verdict-pending`), **and**
- `assignment-eligible?` holds (or an explicit operator escape
  `--override-uncertified` / env skip, same spirit as
  `LOCAL_CODER_BATTERY_SKIP_GATE=1`).

Refuse loudly: name role, provider/model, which gate failed, and the
steward CLI the operator should run. Do not staff and hope.

Out of scope for the first slice (say so in the ticket if you split):
auto-running the full compliance battery at launch time. Capture stays
operator/steward-assigned; the gate only **reads** evidence.

## Immediate mitigation (operator, same session)

- Restaff live QA off `nemotron-3-ultra-free` onto a QA role-matrix top
  (`cursor/auto` or `anthropic/claude-sonnet-5`) until this gate lands.
- Steward task already filed:
  `.swarmforge/operator/NOTE-steward-certify-nemotron-qa-20260831.md`

## Suggested acceptance sketch

- Feature: pack parse / launch refuses a fixture pack whose QA window names
  a model absent from the QA role-matrix or with pending QA-gate.
- Escape hatch documented and tested (override does not silent-pass).
- How-to cross-link from BL-547 and BL-1127.
- Live Bob packs either pass the gate or are rewritten to matrix-ranked
  seats before merge.

## Do not

- Treat global `certified` alone as sufficient for every role.
- Hand-edit `docs/reference/model-compatibility.md` (regen via
  `compat-docs`).
- Scope-creep into recruiter discovery; this is a **staffing refuse**, not
  a new qualify path.
