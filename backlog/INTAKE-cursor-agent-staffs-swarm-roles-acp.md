# INTAKE — Staff real swarm roles with Cursor agent (Cursor SDK / ACP)

**Date:** 2026-07-30  
**Urgency:** high (human-requested; unlocks Cursor as a first-class pack agent)  
**Type:** feature  
**Epic hint:** swarm-intelligence-layer / model-routing (BL-545 / BL-542) — specifier
places it; do not invent a parallel epic without checking those trackers  
**Source:** human via Cursor (2026-07-30)

## Human ask (verbatim intent)

Be able to use a **Cursor agent** to staff **real swarm agent roles** (pack
`window` seats — coder, specifier, QA, …), via **Cursor SDK / ACP**, not only
the offline `/pilot` expedition that wears every hat while the swarm is
stopped.

Include an explicit note for the **Model Steward** to **certify** the Cursor
agent/model path before it is treated as production-routable.

## What exists today (do not confuse)

| Surface | What it is | Not this ticket |
|---------|------------|-----------------|
| `/pilot` (BL-696/699) | One Cursor agent walks pipeline hats **offline**; swarm must be stopped | Offline expeditor, not a live pack seat |
| Pack `window <role> <agent> …` | Live tmux seat; launcher supports known agents (`claude`, `aider`, `codex`, …) | **No `cursor` agent** today — `swarmforge.sh` rejects unsupported agents |
| ACP spike intake | `.swarmforge/operator/INTAKE-acp-spike-one-seat-structured-driving.md` — ACP-host-in-a-pane for an **ACP-native CLI** (e.g. Vibe/Qwen); explicitly out of scope for Claude Code seats | Adjacent spike; this intake is **Cursor-specific** seat staffing |
| Model Steward (BL-547+) | Registry + `certify` / `decertify`; ModelFactory consumes certified entries | Must gate Cursor before ordinary routing |

## Desired capability

1. **Pack line** (or equivalent launch contract) can name Cursor as the agent for
   a role, e.g. conceptually:
   `window coder cursor coder …` (exact agent token + argv shape is the
   specifier’s call — must match launcher + `roles.tsv` conventions).
2. That seat participates in the **real** handoff loop: mail, poke/wake,
   `ready_for_next` / rotation (mono-router or classic), same gates as other
   agents — not a side channel that bypasses coordinator routing.
3. Transport is **Cursor SDK and/or ACP** (structured session/prompt, stop
   reason, tool/permission events preferred over pane-tail heuristics). Prefer
   reusing the ACP-host-in-a-pane direction from the existing ACP spike where
   it fits; do not fork a third control model without a written reason.
4. Human observability survives (transcript in pane or equivalent babysitter-
   visible surface).

## Model Steward certification (required note — do not skip)

**Before** Cursor is eligible for ordinary pack routing / ModelFactory
assignment / “just use cursor for role X” operator defaults:

- Register the Cursor agent identity in the Model Steward registry as
  `candidate` (provider/model id to be chosen honestly — e.g. a
  `cursor/<agent-or-model>` form that matches how the seat actually bills and
  identifies itself; do not invent fake Anthropic ids).
- Run the project’s **swarm-compliance / stewardship** bar the steward already
  owns (compliance battery / evaluate / certify path — see
  `docs/how-to/BL-547-model-steward-overview.md` and BL-547 children). Cursor
  must pass the same class of checks other agents get: protocol follow-
  through, handoff helpers, asks-when-blocked posture, etc.
- Only then `model_steward_cli.bb certify …` (or the then-current certify
  verb). **Uncertified Cursor must not be silently routable** on mono-router /
  full-forge production packs.
- Document any Cursor-specific residual (prompt injection / bootstrap limits
  under ACP, remote-control differences vs Claude `/rc`, cost attribution).

Specifier: put this certification gate in acceptance / invariants so coder
cannot “wire the launcher and call it done.”

## Suggested delivery slices (specifier to cut)

A. **Spike / contract** — prove one role (recommend **coder** or **documenter**)
   completes a real parcel with Cursor as the seat agent; falsifiable: handoff
   in → work → handoff out without human ferrying.
B. **Launcher + agent runtime** — `cursor` (name TBD) accepted by
   `swarmforge.sh` / ensure / poke path; ACP or SDK host process.
C. **Steward registration + certify path** — candidate → compliance evidence →
   certified; refuse pack apply while candidate unless an explicit
   `SWARMFORGE_*` escape for spike-only hosts.
D. **Pack/docs** — how-to: when to use Cursor seats vs `/pilot` vs Claude;
   update unsupported-agent errors to point here.

## Relation to other intakes

- **Distinct from** `INTAKE-telegram-redeploy-clarity.md` (operator bounce UX).
- **Distinct from** `INTAKE-bl607-role-ask-outbox-strips-roleQuestion.md` (ask delivery defect).
- **Complements** `INTAKE-acp-spike-one-seat-structured-driving.md` — that spike
  picks an ACP-native CLI; this ticket staffs **Cursor**. Share ACP-host
  machinery if both land; do not merge them into one ticket if sizing blows up.
- **Not** a substitute for BL-698 `/pilot` — pilot stays the offline
  multi-hat path.

## Non-goals

- Replacing every Claude seat on day one
- Making `/pilot` the live swarm (swarm stays multi-role orchestration)
- Skipping Model Steward and “just try Cursor in prod”
- Building a second Telegram console for Cursor seats

## Acceptance sketch

- A pack can declare at least one pipeline role with agent = Cursor; launch
  brings up a live seat that receives handoffs.
- That seat completes ≥1 real ticket slice end-to-end under mono-router or a
  minimal classic pack.
- Model Steward has a registry entry; status is `certified` only after an
  evidence artifact exists; ModelFactory / pack apply refuses uncertified
  Cursor for non-spike packs.
- How-to documents Cursor seats vs `/pilot`, and points steward at the certify
  steps.
