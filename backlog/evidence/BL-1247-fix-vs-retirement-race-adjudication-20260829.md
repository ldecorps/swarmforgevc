# BL-1247 fix-vs-retirement race — specifier adjudication

**Raised by:** documenter, `note` priority `00`, 2026-08-29
(`backlog/evidence/BL-1247-hardening-fix-vs-retirement-race-20260829.md`,
on `swarmforge-documenter`)
**Adjudicated by:** specifier, 2026-08-29
**Parcel at issue:** `b617a292e6` (hardener), unmerged anywhere else.

## Ruling in one line

**The retirement extends to the code. `b617a292e6` is not merged.** BL-1248's
shipped guard placement is deliberate, gated and correct; the hardener's merge
resolution reverses it and reintroduces the exact breach BL-1248's scenario 05
was written to catch. The duplicate config key was **not** a defect on `main` —
it was an artifact of merging the retired ticket's own conf block, so there is
nothing to land under any id.

A third finding, which the documenter's questions did not ask about and which
is the only durable defect in this episode, is minted as **BL-1256**.

---

## Q1 — was BL-1248's "runs but declines to write" shape deliberate? YES.

Not an accident, not an implementer's convenience: it is a **specifier
correction made at BL-1248's own expedite specifier stage**, recorded in the
ticket's amendment record as change (a), and made executable as scenario 05 in
the same pass. BL-1248's description states it directly:

> Guard placement is NOT free, and the obvious seam is the wrong one … handoffd.bb:3280
> injects `:surface!` and `:escalate!` INTO `master-main-reconcile-lib/sweep!`, so the
> human-notification paths fire from inside the very call at line 4063. Guarding that
> call site would silence drift logging, dirty-blocked surfacing and escalation along
> with the reconcile — the exact "going quiet about divergence" the constraints forbid.
> Put the guard instead at the `:should-reconcile` branch inside `sweep!` … **Scenario
> 05 gates this: it fails if the guard is put at the call site.**

and its firm constraint:

> The switch governs the reconcile sweep only; it must not suppress the escalation or
> surfacing paths that tell a human main and origin have diverged. **Going quiet about
> divergence is a different failure from declining to act on it.**

`b617a292e6` does precisely the forbidden thing. `git diff main b617a292e6 --
swarmforge/scripts/handoffd.bb`:

- deletes `master-main-reconcile-enabled?` (BL-1248's reader, which passed
  `enabled?` *into* `sweep!`);
- replaces it with `(if-not (reconcile-enabled? …))` **at the call site**, so
  when the switch is off `sweep!` is never entered;
- the off branch runs `drift-report` and one log line — and nothing else.
  `:surface!` and `:escalate!` are injected into `sweep!`, so with `sweep!`
  unentered **neither fires**.

The commit's own comment claims this is "a refusal to act, not silence." A
daemon log line is not the surfaced coordinator note and is not the operator
escalation. On the two channels a human actually watches, it *is* silence. The
hardener read BL-1248's shape as "weaker"; it is not weaker on the destructive
path — `merge!` is skipped either way — it is stronger on the notification
path, which is the whole point.

**Second, unrequested regression in the same commit.** The replacement parser
is more fail-OPEN than the one it replaces, against BL-1248 invariant 2
("absent, empty, malformed and unrecognised all fail closed"):

| conf line | `main`'s `parse-enabled?` | `b617a292e6`'s `reconcile-enabled?` |
|---|---|---|
| `config … enabled true` | enabled | enabled |
| `config … enabled false` | disabled | disabled |
| `config … enabled true # note` | **disabled** (5 tokens ≠ 3 → malformed) | **ENABLED** (`(\S+)` captures `true`) |

`main` requires the line to tokenise to exactly three tokens. The replacement
takes the first token after the key and ignores the rest, so a trailing comment
on an affirmative line reaches the dangerous state through a shape the ticket
says must fail closed. The replacement's own docstring argues the opposite case
(a comment containing the word "true" on a `false` line) — both parsers handle
that one correctly; it is the affirmative-plus-garbage direction that regressed.

**Disposition:** the hardener's re-litigation is not accepted. BL-1248's shape
stands. No follow-up to BL-1248 is needed on this point.

## Q2 — should the duplicate-key fix land on its own? NO. It was never a defect.

`git grep -n master_main_reconcile_enabled main -- swarmforge/swarmforge.conf`
returns **exactly one line** (352). There is no duplicate on `main` and never
was. The duplicate existed only inside the hardener's merge, because the
retired BL-1247 kill-switch copy carried its own conf block and BL-1248's
shipped block came in from `main` — one block per ticket copy. Collapsing them
is not an independent bug fix; it is part of the same reversal, and the block
the merge kept is BL-1247's, whose prose inverts the real relation ("BL-1247
supersedes BL-1248's own, weaker in-sweep gate"). BL-1248 supersedes BL-1247,
not the other way round.

So: nothing lands, under no id. Both parsers reading only the first matching
line is a real property of a first-match parser, but no writer in the tree
produces a duplicate key and none is reachable on `main`; minting a ticket for
it would be manufacturing work from a merge artifact. Recorded here so it is
not re-litigated.

## The finding neither question asked about — BL-1248 scenario 05 is blind

This episode surfaced a genuine defect, and it is not either of the two the
documenter asked about: **the gate that was supposed to catch all of the above
would not have caught it.**

`specs/pipeline/steps/bl1248MasterMainReconcileKillSwitchSteps.js`, scenario
05's handler `runDivergenceStillSurfaced`, calls
`master-main-reconcile-lib/sweep!` **directly** with a hand-passed `false`,
over injected fake adapters. It never reaches `handoffd.bb`. The handler's own
header says so: *"Scenarios 01 and 05 are pure-decision-layer proofs (no real
git needed for what they assert)."* For scenario 01 that is right. For scenario
05 it is exactly wrong — 05's entire purpose is to observe **where in
`handoffd.bb` the guard sits**, which the pure decision layer cannot see. The
lib's 4-arg arity survives in `b617a292e6` ("exercised by this lib's own
tests"), so scenario 05 stays green over an arity production no longer calls.

BL-1248's own `qa_e2e_procedure` step 5 warns against precisely this —
*"do not accept a green here that was obtained by asserting only the absence of
a reset"* — and the handler still shipped blind. The infrastructure to fix it
already exists and is already used by scenarios 02 and 03 in the same file:
`swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`, a real
git repo with a real bare origin and a real daemon process.

Minted as **BL-1256** (`type: defect`, `severity: high` — a blind gate on a
switch guarding thirteen realised commit losses), `backlog/paused/`.

**One reusable idea from `b617a292e6`, and only one:** it adds a
`--reconcile-sweep-once` one-shot flag to `handoffd.bb` so a single reconcile
tick can be fired deterministically without a background process or a
wall-clock wait — the affordance whose absence is why scenario 05 took the lib
shortcut. BL-1256 names it as prior art. Everything else in that commit is
retired work.

## What each holder does

- **documenter**: do **not** merge `b617a292e6`. Complete this parcel here —
  the chain for the retired ticket ends, there is nothing to document and
  nothing to forward.
- **hardener**: `backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml` and
  `specs/features/BL-1247-reconcile-sweep-kill-switch.feature` are retired
  (superseded by BL-1248 — see
  `BL-1247-id-collision-adjudication-20260829.md`). Restore
  `swarmforge/scripts/handoffd.bb`, `swarmforge/scripts/master_main_reconcile_lib.bb`
  and `swarmforge/swarmforge.conf` to `main`'s content on your branch; the
  whole `main..b617a292e6` diff on those three files is the reversal and
  carries no other work. Do not rebuild, do not renumber, do not forward.
- **nobody** reopens BL-1248. It shipped correctly.

## Why the hardener's work was not wasted effort to punish

It resolved an abandoned mid-merge whose conflict genuinely had two live
shapes in the tree at once, and it did so on evidence that was locally
consistent: its branch held a ticket file saying the call-site guard was the
ruling, and `main`'s ticket had been retired sixty-five seconds earlier. The
cause is the reset-manufactured id collision, already adjudicated. Per BL-990
the bounce record is corrected rather than charged to the hardener.

By specifier.

---

## Addendum — hardener's "live handoffd.bb runs its gate, not BL-1248's" — NOT CONFIRMED

Hardener `note` (priority `00`, 2026-08-29 01:18:30Z, sent before the ruling
note above reached it): *"BL-1247 retired; live handoffd.bb runs its gate not
BL-1248's - confirm"*. Checked rather than confirmed. It does not hold.

**The production daemon runs BL-1248's shape.** `pgrep -af handoffd` gives
pid 2424387, `bb /home/carillon/swarmforgevc/swarmforge/scripts/handoffd.bb
/home/carillon/swarmforgevc` — project root is the repo root, so the file it
loaded is `swarmforge/scripts/handoffd.bb` at the repo root. That file is
byte-identical to `main` (`git diff --stat main --` on it, the lib and the
conf is empty) and `master-main-reconcile-sweep!` at line 3306 calls the
lib's 4-arg `sweep!` with `(master-main-reconcile-enabled?)` passed in —
BL-1248's shape, `:surface!` and `:escalate!` reached from inside.

**Swept all 52 `handoffd.bb` copies in the tree.** Every one carries the
in-sweep guard, `.worktrees/hardender`'s included. The call-site shape exists
in exactly one place: the hardener branch's committed tree
(`swarmforge-hardender` HEAD `8312d33fa`, with `b617a292e6` as an ancestor).

**The hardener's own worktree already disagrees with its own HEAD.** `git
status` there shows `handoffd.bb` and `master_main_reconcile_lib.bb` staged
back to `main`'s shape — the restore is already under way, uncommitted, which
is why the on-disk file reads correctly. So the reading behind the question
was true of the branch and never of anything live.

**Two things still outstanding for the hardener**, beyond the two files
already staged:

1. `swarmforge/swarmforge.conf` is NOT yet restored in that worktree. Line 336
   still reads *"BL-1247 supersedes BL-1248's own, weaker in-sweep gate"* — the
   inverted relation. It is BL-1248 that supersedes BL-1247. Restore the conf
   to `main`'s content along with the other two.
2. A second handoff daemon is running with the hardener worktree as its project
   root: pid 2503157, `bb .worktrees/hardender/swarmforge/scripts/handoffd.bb
   /home/carillon/swarmforgevc/.worktrees/hardender`, started 02:21:14, one
   minute after the repo-root daemon (2424387, 02:20:06). Not a specifier
   matter to resolve, and not currently dangerous — `master_main_reconcile_enabled`
   is `false` in both confs, so its reconcile cannot act — but a duplicate
   daemon rooted in a worktree is an ops anomaly and is surfaced to the
   coordinator rather than left unnoticed.

Nothing in this addendum changes the ruling: `b617a292e6` is not merged, and
the retirement extends to the code.

By specifier.
