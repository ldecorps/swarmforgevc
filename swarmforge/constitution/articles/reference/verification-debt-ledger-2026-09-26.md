# The verification-debt ledger: hand checks are counted, not remembered (2026-09-26)

Human, 2026-09-26, verbatim: "I think we should have tool removing llm work
wherever it makes sense", and "this principle should be a core
responsibility of the lean coordinator. Or is there a way to enforce this
rule even harder on the swarm engine?"

A rule that says "notice when you keep checking something by hand" depends
on an LLM remembering it, and that is the behaviour it is trying to remove.
So the noticing is done by a register instead. Roles record, a script
counts, and the throttle enforces. It is the third register in the family
of `backlog/standing-reds.tsv` and `backlog/hardening-debt-ledger.yaml`.

Tickets: BL-1782 (ledger, recorder, reader), BL-1783 (discharge and waive),
BL-1784 (an unowned category throttles intake to 1). **Until BL-1782 lands,
`swarmforge/scripts/verification_debt_ledger_update.bb` does not exist and
there is nothing to record.** Keep writing what you checked by hand in your
evidence, as you already do.

## When a row is owed (every role)

You record a row when, to do your stage's job, you **checked or classified
something by hand that no script decided for you**, and the same check
would be needed again on another ticket. Examples:
- QA grepping a branch for which paths belong to the ticket before trusting
  the land step's keep/drop, or building a tip-pure land by hand after
  LAND_ESCALATE.
- A reviewer hand-counting a population a scenario derives (BL-1445), or
  hand-diffing a new dispatch branch against its sibling (BL-1515).
- The coordinator working out by hand which parcel a stale claim belongs to.

A row is not owed for judgement that is the job itself: reviewing a design,
choosing a fix, or writing a spec. It is also not owed for a one-off
novel shape you do not expect to meet again. If unsure, record it. The
threshold absorbs noise, and a waiver (BL-1783) closes a category that
turns out not to be worth a tool.

## How to record

```
bb swarmforge/scripts/verification_debt_ledger_update.bb <project-root> --record <category> \
    --ticket <id> --role <your role> --description "<what you checked by hand, one line>" \
    [--evidence <path>]
```

- `<project-root>` is the master checkout, never your worktree. The
  recorder commits the row there itself, so it rides no parcel. Do not
  stage or commit the ledger yourself.
- `<category>` is a kebab-case id for the **kind** of check, not the
  ticket. Reuse an existing category: read
  `bb swarmforge/scripts/verification_debt_ledger_read.bb <project-root>`
  first. Mint a new one only when none fits. Two names for one kind of
  check split its count, and the register never fires.
- The same category and ticket twice is a no-op
  (`VERIFICATION_DEBT_ALREADY_RECORDED`).
- If the recorder prints `VERIFICATION_DEBT_UNOWNED <category> ...`, send
  the specifier a `note` (priority `00`): `verification-debt <category>
  unowned (count <n>) - mint its owner`. Then carry on with your work.
  This does not block you.
- If the recorder exits non-zero because it could not commit, the row is
  not recorded. Say so in your evidence and record it on a later turn.

## Owning, discharging, waiving

- **Owner.** The specifier mints a ticket whose deliverable makes the
  check mechanical and declares `verification_category: <category>` on one
  line (backlog-schema.md). While that ticket is open, the category is
  owned and does not throttle.
- **Discharge.** When the tool ships, whoever lands or closes it runs
  `--discharge <category> --by <role> --evidence <committed evidence path>`.
  The rows are kept and marked paid.
- **Waive.** When a category is not worth a tool, run `--waive <category>
  --by <who> --reason "<why>"`. Only the specifier (for process
  categories) or the human does this, and the reason must be one a reader
  could check. "Not worth it" alone is not a reason.
- A hand check recorded after a discharge or waiver is new debt and counts
  from one. A tool that does not cover the case brings the category back
  on its own.

## The coordinator's soft duty (the first layer, not the only one)

At every closing ceremony, and whenever the effective depth reads 1 on
the verification-debt signal (BL-1784), the coordinator runs the reader.
For each id in `unowned` that has no specifier note open for it, it sends
the specifier one `note` (priority `00`) naming the category, its count
and its tickets. The throttle is the hard layer. This note makes sure the
specifier hears about it the same shift.

## The specifier's duty

On a `verification-debt <category> unowned` note: read the category's
rows, then **in the same pass** either mint the owner ticket (declaring
`verification_category:`) or record a waiver with its reason. A category
left unowned holds intake at 1 once BL-1784 lands. That is the point of
the throttle, and it is not something to wait out.
