# Unowned red found while implementing BL-1630, 2026-09-20

Not BL-1630's own defect - this parcel never touches anything related to
approval commits or byline checks.

## test/bl1368ApprovalCommitByline.property.test.js > "property: a pipeline
role's own commit still passes the role byline check, and a human-decision
commit is not one"

Failed once in a full `npm run test:properties` run:

```
AssertionError: Expected values to be strictly deep-equal:
  [ 'QA', 'architect', 'cleaner', 'coder', 'documenter', 'hardender', 'specifier' ]
  [ 'QA', 'architect', 'cleaner', 'coder', 'documenter', 'hardender' ]
```

The test's own "Reach: every pipeline role was actually exercised"
assertion failed because the random generator did not happen to draw
"specifier" as one of the roles in this run - a generator-reach flake
(the same shape my role's own Invariants section names: "a property can
pass hundreds of runs against a live, reproducible defect" when a
generator under-weights reaching a particular state). Re-ran
`npx vitest run --config vitest.properties.config.mjs
test/bl1368ApprovalCommitByline.property.test.js` in isolation
immediately after: 3/3 green.

`grep -i bl1368 backlog/standing-reds.tsv` finds no row. Same class of
flake as BL-1340's own generator-reach failure seen during this session's
earlier BL-1652 work (also non-reproducible in isolation) - two sightings
in one session across two different property files may indicate the
property lane's generator-reach assertions are systemically under-tuned,
worth the specifier's own look rather than a one-off retry each time.

By coder.
