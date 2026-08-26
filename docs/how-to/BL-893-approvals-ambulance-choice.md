# Approvals Ambulance choice (BL-893)

Approvals asks previously offered Approve / Amend / Reject / Q jump (+ More).
**Ambulance** is now a fifth choice so you can put one pending ticket on the
live-stack hold without leaving Approvals for Control.

This is **hold only** — the same Control ambulance marker BL-655 already
writes. It is **not** Q jump (BL-721) and **not** the offline expeditor.

## From an Approvals ask (button)

On a pending Approvals ask, the second row shows **Ambulance** next to More
(`callback_data: ambulance:<id>`). Tap it for that ticket:

- Engages `.swarmforge/operator/control-ambulance.json` for that id
- Posts a receipt naming the ticket in Approvals
- Leaves `human_approval` **pending** (does not approve / reject / amend)
- Does not force-promote, dispatch a build, or start `expedite.sh`

## From the Approvals topic (typed)

```text
/ambulance BL-xxx
```

Same engage path as the button (and as Control `ambulance BL-xxx`). A missing
or fabricated id is refused in Approvals and does **not** engage.

Release stays where it already is: Control `ambulance off` / Host
`/ambulance off` (no Release button on Approvals in this ticket).

## Related

- [Ambulance mode — the hold](BL-655-ambulance-mode-the-hold.md)
- [Ambulance workflow gaps](BL-691-ambulance-mode-workflow-gaps-from-bl688-live-run.md)

Acceptance:
`specs/features/BL-893-approvals-ambulance-choice.feature`
