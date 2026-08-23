# BL-1071 review goal 4 — specifier ruling (2026-08-23)

Coder report: "observe! catch drops the exception; throwing observer is
silent." **Confirmed, and unlike goal 3 this one is a real defect, not a
latent one. It is in scope for THIS parcel, not a follow-up.**

## Confirmed, verified independently

`babysitter_check.bb:967-968`:

    cp-observe (try (control-plane-lib/observe! (str state-dir) socket)
                    (catch Exception _ {:classification :unknown}))

The exception is bound to `_` and dropped — nothing logged, nothing carried.
`check-control-plane` (`babysitterd_sweep_lib.bb:426-442`) then emits a
finding **only** `(when (= :control-plane-missing control-plane-classification))`.
Neither `babysitterd_sweep_lib.bb` nor `control_plane_lib.bb` mentions
`:unknown` at all. So a throwing observer produces **no finding whatsoever** —
the control plane reads as healthy by omission.

That is invariant 3 violated verbatim: "a probe that cannot be read is
reported unavailable, which is its own answer — never reported as a healthy
reading and never as an absence." It is also the incident's own shape: a
silent mechanism failure that leaves auto-heal dead while everything looks
fine.

## Why this is in scope here and not a narrow follow-up

Goal 7 asks for follow-ups, but two things put this one inside the parcel:

1. **Goal 4's own text authorises it** — "confirm that is deliberate and that
   a throwing observer is visible somewhere, **or make it so**."
2. **The stamp cannot honestly pass while it stands.** Invariant 3 is declared
   ON this ticket, and the architect reviews each declared invariant as its
   own pass. Stamping off a diff that violates a declared invariant, with a
   follow-up ticket standing in for the fix, is how a ticket comes to read as
   complete while its declared property is false.

## Shape — direction, not mandate

`check-control-plane` is the **only probe in its own file that goes silent**.
Three siblings already do this correctly and cite invariant 3 while doing it:
`proc-gather-<role>` (line 112), `memory` (line 202), and
`pipeline-code-on-main` (line 368), all severity `UNAVAILABLE`. Follow that
existing convention rather than inventing one:

- Bind the exception instead of `_`, and carry its reason into the finding —
  BL-572/BL-662, show the actual failure reason, never a bare status.
- Emit a `control-plane` finding at severity `UNAVAILABLE` when the
  observation could not be made.
- **Attach no repair to it.** An unreadable observation is not evidence the
  plane is missing, so it must not trigger `./swarm ensure`. This matches the
  file's own posture at line 93, where UNAVAILABLE gather reports stay
  repair-free.

## Spec amendment — this DOES change what you build

The feature file had a hole aligned exactly with the code defect, and it is
mine: scenario 01 lists "the control-plane observation" as a failing probe but
asserts only that the sweep survives (invariant 1), so a silently dropped
observation passes 01 unchanged; scenario 05 gates invariant 3 but only for
the process table. Invariant 3 was therefore ungated for the one probe that
actually fails silently.

Added **scenario 06 "an observation that throws is reported unavailable,
never silence"**. Gherkin lint clean. Its step handler must land in THIS
parcel — `specs/pipeline/runtime.js` throws on any scenario with no handler
(BL-233), so the acceptance gate fails until it exists.

IR-DRY re-run after the amendment: 2 findings, both kept. "no control-plane
recovery is started" vs "no second recovery is started" are different claims
(no recovery at all under an unknown state, versus no *second* recovery inside
the cooldown). The other is the pre-existing missing/reported-missing contrast
already dispositioned in the ticket. The ticket's "1 finding -> 0 resolved"
note predates scenario 06 and is superseded by this paragraph.

Goals 1, 2, 5 and 6 are untouched by this ruling; goal 3 was ruled
confirmed-latent, no change (see the goal 3 evidence file).

By specifier.
