# Disposition (specifier 2026-08-25T16:05Z)

**Outcome:** minted BL-1139 (paused); human_approval pending.

---

# Raw intake — Auto-repair durable master-checkout drift (BL-839 follow-on)

Status: **new intake, not minted.** Capture only (human via Cursor
2026-08-25 ~16:20 CEST). Specifier: mint and spec.

## Why this is in front of you

Telegram **Alerts** (Operator topic) keeps firing **MASTER CHECKOUT DRIFT**
with `:staged-for-reversion` on daemon-executed scripts, e.g.:

- `swarmforge/scripts/handoffd.bb`
- `swarmforge/scripts/push_sweep_lib.bb`

Alarm text (verbatim class): the code the daemons are RUNNING is not the
code that LANDED on `main`. A QA-approved, merged fix can be silently not
in effect while its ticket sits closed. Staged paths are one `git commit`
away from landing the reversion on `main`.

BL-839 shipped the **detector only**. Its ticket and how-to explicitly
deferred repair: an auto-restore was out of scope because it can discard
uncommitted work without asking ("surfaced, not swept"). Follow-ons
BL-1122 / BL-1134 / BL-1137 only **mute** false STAGED WARNs while a
commit/add is in flight — they do not clear durable drift.

Human ask (2026-08-25, after the live alert screenshot): **the swarm must
deal with durable daemon-script drift without human intervention.**

## Goal

1. Mint a defect/enhancement ticket (next free id) as the **BL-839 repair
   slice** — not a remint of BL-839 itself (done).
2. Spec: when durable drift is detected on the **daemon-executed path
   closure** (`resolve-daemon-executed-paths` from
   `master_checkout_drift_lib.bb`) and **no** `commit-in-flight?` signal,
   restore those paths from `main` (`git checkout main -- <path>`), then
   re-check.
3. Spec: on successful restore, emit a **one-shot** Operator note
   (`MASTER CHECKOUT DRIFT RESTORED: …` naming paths) — do not leave a
   repeating WARN for a problem that was fixed.
4. Spec: after successful restore, **bounce** handoffd + supervisor via the
   existing chokepoint `start_handoff_daemon.sh` (or
   `restart-handoffd-group!` / equivalent), deferred so the current sweep
   tick can finish. Disk restore alone does not update in-memory
   `load-file` state.
5. Spec fail-closed: if restore fails or re-check is still `:drift` /
   `:unknown`, keep the existing WARN.
6. Preserve mid-commit mute: never repair (and keep current alarm rules)
   while `commit-in-flight?` is true.
7. Keep `check-master-checkout-drift!` **read-only**; put mutation in a
   separate repair verb so BL-839 invariant 1 on the check itself stays true.

## Locked human decisions

1. Auto-repair **is wanted** for durable daemon-script drift — do not leave
   this as human-only recovery (overrides BL-839's original "detect only"
   approval for this follow-on slice).
2. Scope is the **daemon-executed closure only** — not arbitrary dirty
   paths under the master checkout.
3. Policy: restore from `main` (discard uncommitted/staged drift on those
   paths). Intentional changes to daemon scripts belong on `main` via the
   normal land path or a declared BL-848 hotfix — not as lingering master
   WIP.
4. Repair must not run during an in-flight `git add` / `git commit` /
   `index.lock` window (reuse BL-1122/1134/1137 detection).
5. Successful repair must bounce handoffd so running code matches disk.
6. Prefer extending `master_checkout_drift_lib.bb` +
   `master-checkout-drift-sweep!` in `handoffd.bb` over a new daemon.

## Non-goals

- Moving daemons off the working tree onto a committed ref (larger change;
  separate ticket if wanted — already called out in BL-839 out_of_scope).
- Auto-committing drifted content onto `main` (that would land reversions).
- Repairing non-daemon paths (backlog YAML, docs, extension, etc.).
- Weakening the mid-commit mute (false STAGED WARNs during agent commits
  stay muted; durable drift still repaired when the window closes).

## Preferred direction (specifier may refine mechanics, not the ask)

Extend the existing drift sweep:

1. Classify (existing check).
2. If durable `:drift` and not in-flight → restore drifted daemon paths
   from `main`.
3. Re-classify → RESTORED note + deferred bounce, or WARN if still dirty.
4. Acceptance: fixture/property proves restore + no WARN on success;
   in-flight proves no restore; restore failure still WARNs; repair never
   touches paths outside the daemon-executed set.

## Related

- `backlog/done/BL-839-master-checkout-drift-from-main-on-daemon-executed-scripts.yaml`
  (detect-only; approval_context explicitly defers auto-repair)
- `docs/how-to/BL-839-master-checkout-drift-alarm.md`
- `swarmforge/scripts/master_checkout_drift_lib.bb`
- `swarmforge/scripts/handoffd.bb` (`master-checkout-drift-sweep!`)
- BL-1122 / BL-1134 / BL-1137 (in-flight mute only)
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` (sanctioned intentional
  change path)
- `swarmforge/scripts/start_handoff_daemon.sh` (bounce chokepoint)
- Live trigger: Telegram Alerts screenshot 2026-08-25 ~16:11 CEST,
  MASTER CHECKOUT DRIFT STAGED on `handoffd.bb` + `push_sweep_lib.bb`

## Acceptance sketch

- Feature: durable staged/uncommitted drift on a daemon-executed script →
  path matches `main` after the sweep; Operator gets RESTORED note once;
  no repeating DRIFT WARN for that episode.
- Feature: same drift while commit-in-flight → no checkout/restore; mute
  rules unchanged.
- Feature: after successful restore, handoffd group is bounced through
  `start_handoff_daemon.sh` (or documented equivalent).
- Feature: restore IO failure or residual drift → WARN still emitted.
- Property: repair candidates ⊆ `resolve-daemon-executed-paths`; check
  path remains write-free.
