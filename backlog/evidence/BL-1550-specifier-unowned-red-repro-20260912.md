# BL-1550 — specifier reproduction of QA's unowned-red note, 2026-09-12

- **Source**: QA `note` 2026-09-12 19:53Z from the BL-1529 parcel:
  `unowned-red draftPathUnder property test - mint ticket; evidence
  6e8792c53c` (detail file
  `backlog/evidence/BL-1529-QA-unowned-red-draftPathUnder-20260912.md` on
  `swarmforge-QA`, not yet on `main`).
- **Register before this pass**: `standing_red_register_cli.bb` reports
  `"unowned":[]` because `extension/test/draftPathUnder.property.test.js`
  was never registered at all; `grep draftPathUnder backlog/standing-reds.tsv
  backlog/paused backlog/active` returns nothing. Unowned, confirmed.
- **Repro by seed on main `e76e486205`**: 6 isolated
  `npx vitest run --config vitest.properties.config.mjs
  test/draftPathUnder.property.test.js` runs, 0 failed (QA saw 2 of 6 at
  `2a158f5a5c`). The seed decides whether `"."` is drawn.
- **Deterministic repro**: `removeDraftIfPresent(path.join(<mkdtemp dir>, "."))`
  throws `EISDIR: illegal operation on a directory, unlink ...` on every
  call. `fs.rmSync(<dir>, { force: true })` (QA's suggested guard) throws
  `ERR_FS_EISDIR` on the same input, so that guard alone would not fix it.
- **Site**: `extension/src/swarm/draftPathUnder.ts` `removeDraftIfPresent`
  (`existsSync` then bare `unlinkSync`), landed by BL-1537 `e300226fae6`.
  Production callers (`closing-ceremony-run.ts`,
  `night-closing-ceremony-run.ts`, `tracer-bullet-launcher.ts`) always pass
  a `<root>/tmp/<prefix>-<pid>-<nonce>` path, never a directory, so the
  production risk is the contract (a throw out of a cleanup path), not a
  live fault.
- **Adjudication**: two defects, one ticket - the helper's contract on a
  directory (leave in place, never throw, never recurse) and the property's
  population (`.`/`..` are not draft names; strict children only, directory
  case pinned as an example). Same-site owner search found none. Minted
  BL-1550, `type: defect`, `severity: high` (standing-red rule 2026-09-05),
  register row added in the same commit.

By specifier.
