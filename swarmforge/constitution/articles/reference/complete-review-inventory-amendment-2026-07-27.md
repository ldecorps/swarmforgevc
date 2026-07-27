# AMENDMENT (INCORPORATED): Complete review inventory — one bounce per review pass

> **Status: INCORPORATED, 2026-07-27** (Article 5.1 step 2, by the specifier).
> The binding form now lives in **Article 4.4** (constitution
> `articles/04_quality_gates.md`), mirrored in **`architect.prompt`**
> ("Complete Review Inventory Before You Send Back"), **`QA.prompt`** (the
> bounce evidence contract's first bullet + the spec-failure routing table),
> and the **`cleaner`** / **`hardender`** / **`documenter`** "Recording A
> Send-Back" sections. This file is the adoption record and rationale — read
> Article 4.4, not this file, for the rule in force.
>
> **Origin:** operator directive, 2026-07-27, via
> `.swarmforge/operator/INTAKE-single-pass-review-bounce-all-violations.md`:
> roles bounce at the FIRST violation they see, so five defects cost five
> round-trips; the operator wants one bounce per review pass with a complete
> defect inventory.

## 1. The incident that forced it

BL-590 slice 1 took **seven architect send-backs**. The defect family was one
thing — resume identity / idempotency of the onboarder state store — and each
round surfaced exactly one more member of it:

| Bounce | What it found | What it did not look at |
|---|---|---|
| #1–#4 | successive sites violating one unstated idempotency property | the rest of the same property's surface |
| #5 | D1 slug collision, D2 unvalidated cast | D3/D4, below |
| #6 | D3 handler/store target-identity disagreement, D4 | whether #5's fixes had actually landed |
| #7 | D1–D4 **all regressed/absent** + P1–P6 property coverage never in the live suite | — |

Bounce #7 is the shape the operator wants: one evidence file
(`backlog/evidence/BL-590-onboarder-slice1-architect-bounce7-20260727.md`),
four numbered defects each with its own repro and remediation, plus the
spec-level finding that the declared invariants' property tests lived only in
`backlog/evidence/` and never in `extension/test/`. It arrived after six
avoidable round-trips.

BL-606 lost three rounds the same way.

## 2. Why the prior rule was necessary but not sufficient

`architect.prompt` already said, post-BL-606:

> When you find a violation, do NOT send back yet: first sweep the parcel for
> EVERY other site violating the SAME invariant. **One bounce per property,
> never one per site.**

Three gaps:

1. **Per-property is still per-defect at the pass level.** BL-590's family
   surfaced as properties #1–#6 across six bounces — each individually
   obeying "one bounce per property".
2. **Only the architect had the obligation.** cleaner, hardender, documenter
   and QA had nothing stronger than "you do not bounce as a matter of course".
3. **Spec failures were routed as implementation failures.** A declared
   invariant with no live property test is an INVEST/testability failure owned
   by the specifier, but it was bounced to the coder, who cannot fix a spec.

## 3. The rule as adopted, and the two judgment calls inside it

Article 4.4's core is one line: *finish the checklist, then send one bounce
carrying every defect that pass found.* Two things in it were decided here
rather than in the intake, because the literal ask does not survive contact
with the pipeline without them.

### 3.1 "Complete" had to mean run-or-blocked, not assumed-clean

A literal "finish the full review checklist" is impossible after a compile
failure: unit, acceptance, mutation and CRAP genuinely cannot run. Left
unstated, the rule invites either paralysis or — worse, and the failure mode
this project already has a memory entry for — a sweep that records unrun
checks as clean.

So: every check is either RUN or recorded **BLOCKED BY** the item that blocks
it. A compile bounce with one defect and eight blocked gates is a *complete*
pass. This also keeps the metric honest in the other direction: a second
bounce after the blocker is fixed is legitimate, not a first-failure-stop
regression, and the blocked list is the evidence that distinguishes them.

### 3.2 "One bounce" had to be reconciled with per-owner routing

Article 4.3 routes a bounce to the role that OWNS the fix. An inventory
blaming two stages cannot be one `git_handoff` to two roles. Resolution:

- the single bounce goes to the **earliest** blamed role (4.3's existing
  "earlier of them" tie-break, generalised);
- the inventory **travels with the parcel**, and every stage that later holds
  it must clear the items blamed on IT before forwarding.

Without that second half, "one bounce" would silently drop the later-stage
items — a documenter defect bounced to the coder would be forwarded straight
past the documenter unfixed, which is precisely the BL-425/BL-575/BL-576
blind-forward failure this project has already paid for three times.

Spec gaps take a third path, because the specifier is never sent a parcel
(Article 1.2): they leave as a `note` (priority `00`) to specifier AND
coordinator in the same pass, and that note is explicitly **not** a second
bounce event. An all-spec-gap inventory bounces nothing at all — complete the
inbound task, send the note, and the specifier amends the spec on `main` and
notifies the holder to merge and rebuild.

## 4. What is deliberately NOT changed

- **BL-532 sibling deferral** — a batch sibling with no failing check of its own
  is still deferred, never bounced, and still gets no evidence file and no
  `record-bounce.js` call.
- **`rule_proposal`** stays a separate channel; it never splits or substitutes
  for a bounce (BL-333's lesson is unchanged).
- **Per-property thinking inside the sweep** — still enumerate every property
  and every site. The change is only that you do not SHIP until all of them are
  checked.
- **Legitimate multi-bounce** — a fix that introduces new defects, or a blocked
  gate that runs and fails once unblocked, is a new pass and a new bounce.
- **Article 4.3 ownership routing** — untouched. 4.3 decides where a bounce
  goes; 4.4 decides when it is complete enough to send.

## 5. Enforcement: prompts first, tooling as a follow-on

The intake proposed four enforcement hooks. Deliberately NOT built as part of
this amendment — the operator marked them "optional follow-on ... if prompts
alone are insufficient", and a process rule that needs its own CLI before it
can be obeyed is a rule that does not take effect today:

| Hook | Disposition |
|---|---|
| `record-bounce.js --items` — one bounce event carrying N defect items | **BL-688** (paused, `epic: code-quality-gates`) |
| `defects_per_bounce` / `blocked_checks` metric to detect first-failure-stop regression | same slice, BL-688 — the recorder is what makes it derivable |
| CI/acceptance checklist step ("evidence lists ≥1 item OR explicit NONE") | named follow-on in BL-688; not specced until BL-688 lands |
| Tracer bullet: seeded multi-defect parcel yields one bounce with ≥3 items | named follow-on in BL-688 |

Today the rule is enforced the way every other pipeline discipline in this
project is enforced first: by the role prompts, and by the next reviewer
noticing a one-item inventory that should have had four.

## 6. Verified at incorporation

- `record-bounce.js` accepts `--ticket --role --type --class --commit --by
  --evidence` only — no multi-item flag exists, so BL-688 is genuinely new work
  and the prose rule cannot lean on it.
- All five reviewing roles carry the mirrored obligation; the file for the
  hardening role is `swarmforge/roles/hardender.prompt` (the pipeline's
  spelling, typo included).
