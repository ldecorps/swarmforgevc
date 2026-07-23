# BL-606 — architect PASS (after three send-backs)

**Parcel reviewed:** `4e0d1f2bde` (cleaner), fast-forward onto `62d8d206a`
(architect bounce #3), so bounce #3 is an ancestor and lineage holds.
**Verdict:** PASS — forward to hardender.

---

## Bounce #3 re-verification — FIXED, correctly

Bounce #3: a reviewer's plain hand-written bounce carries no
`rejection_reason` / `reroute_reason` header, so the header-keyed guard was
inert on the common bounce path and the bounce was rewritten *forward*, onto
the bouncer itself.

The fix takes the recommended remediation exactly: direction is now derived
from the **sender's own canonical-order position**
(`required_stages_lib.bb/routes-forward?` + `sender-position`), with
`specifier` special-cased to −1 so the ordinary entry send still routes, and
any other non-canonical sender (coordinator/unknown) resolving to identity.
The header guard is retained for the operator salvage paths, as advised.

Both repros re-run against the **real** `swarm_handoff.bb` send path in a
fresh sandbox (not the parcel's own fixtures), flag ON:

| repro | ticket `required_stages` | send | delivered `to:` | `routing_skipped` |
|---|---|---|---|---|
| D | `[coder, cleaner, architect, hardender, QA]` | QA bounces → documenter | `documenter` | none |
| E | `[architect, documenter, QA]` | architect bounces → coder | `coder` | none |

Previously D delivered to `QA` and E to `architect` — each bounce landing back
on its own sender, an unbreakable self-bounce loop. **Fixed**, and the trail no
longer misreports a defeated bounce as a forward skip.

### Forward routing is not disabled by the fix — four positive controls

| sender → literal `to:` | ticket set | delivered | recorded `skipped=` |
|---|---|---|---|
| coder → cleaner | `[coder, qa]` | `QA` | `cleaner,architect,hardender,documenter` |
| hardender → documenter | documenter omitted | `QA` | `documenter` |
| specifier → coder | `[architect, documenter, QA]` | `architect` | `coder,cleaner` |
| coder → cleaner | cleaner required | `cleaner` | *(no rewrite — correct)* |

Row 1 matches the ticket's own QA procedure step 2 verbatim. Row 3 proves the
`specifier` −1 special case is load-bearing, not decorative.

### The new coverage is genuinely load-bearing

Bounce #3 asked for coverage of both repros. Delivered as feature scenario 09
(2 examples) plus 6 direct unit assertions. Break-then-fix: neutering
`routes-forward?` to a constant `true` fails **exactly** tests 17 and 18
(16 pass / 2 fail) and 6 unit assertions. Restored clean; `ALL PASS`.

---

## Gates

- **Dependency-rule gate (required hard gate, BL-259):** PASSED per-parcel and
  full-repo — no forbidden edges.
- **Purity boundary holds.** `required_stages_lib.bb` requires only
  `clojure.string`; no `slurp`/`spit`/`fs`/`sh`/`getenv`. Every read (conf,
  ticket yaml) and every write (envelope header, `routing-skips.jsonl`) lives
  in `swarm_handoff.bb`. The IO-bearing adapter depends inward on the pure
  policy module — correct direction.
- **Kill-switch default OFF and verified inert** at the real send path: with
  `required_stages_routing_enabled false`, a `[coder, qa]` ticket's
  coder → cleaner send still delivers `to: cleaner`, byte-identical to today.
- **`routing_skipped` is reserved.** A draft that writes it is rejected:
  *"header 'routing_skipped' is reserved and must not be written by agents."*
- **Ticket lookup is an exact `id:` match**, not a filename glob (BL-9005 vs
  BL-900 false collision guarded).
- **Suites:** acceptance 18/18; `required_stages_test_runner.bb` ALL PASS;
  `test_reroute.sh` / `test_redo_from.sh` ALL PASS (case 06 in each covers the
  salvage-path header guard); `npm run compile` clean.
- **Co-change (informational, never auto-bounce):** flags only BL-606's own
  cluster — the files that iterated together across the three bounce cycles.
  No coupling action warranted.
- **Property testing:** none warranted. The one property-shaped module in this
  parcel is babashka and the pinned fast-check harness cannot reach `.bb`.
  Stated rather than manufactured vacuously.

---

## Non-blocking observation for the specifier — QA is structurally un-droppable

Recorded, **not** bounced: the send-path behaviour is correct and is the safer
of the two readings. Carried forward because the operator's standing intent is
to flip the flag ON when this lands.

`next-required-stage` only ever forwards to a required stage **strictly after**
the current one. QA is last in canonical order, so when a declared set omits
QA the final hop resolves to `nil` and falls through to the literal recipient —
**QA receives the parcel and runs anyway.**

Verified: ticket `required_stages: [documenter]` (a valid non-code declaration,
`:qa-omission :accepted`) routes specifier → `documenter`, then
documenter → `QA` delivers to `QA`.

This means acceptance item #5 / scenario 05's *"runs without QA as a declared
non-code ticket"* is realized only in the decision layer — scenario 05 asserts
on `resolve-effective` alone and never on the send path.

**This is the right outcome, and should not be "fixed" into a real QA drop.**
QA is the integration point (BL-247): it lands the approved commit on `main`
and notifies the coordinator. A parcel that genuinely skipped QA would have
nobody to merge it and would strand. The tension is in the *spec* item, not the
code.

One consequence worth knowing: `ran-and-skipped` derives from the declaration,
i.e. **intent**, so for such a ticket it lists QA as skipped-by-routing when QA
in fact ran. The error direction is safe (over-reports skips — a false alarm,
never false assurance); the dangerous inverse is structurally impossible, since
`next-required-stage` never jumps a member of the effective set. `ran-and-skipped`
also has **no production caller** today — only the unit runner and the scenario 08
step handler — so nothing surfaces the discrepancy to a human yet.

Suggested disposition: a specifier follow-up to reconcile acceptance item #5
with BL-247 (either drop the "QA droppable" clause, or state explicitly that QA
omission is accepted at declaration time but never realized at dispatch), and to
decide whether the scenario 08 reporter should read the runtime trail rather
than the declaration.
