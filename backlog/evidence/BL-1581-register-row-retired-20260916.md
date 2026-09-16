# BL-1581: stale standing-red register row retired (2026-09-16)

Coordinator note 2026-09-16T00:02Z: "bl1358 row owner BL-1581 closed 20260915,
register still owned:false".

- Row: `property` / `extension/test/bl1358MutantTimeCeilingInvariants.property.test.js` / BL-1581 / first_seen 2026-09-15.
- BL-1581 is in `backlog/done/`; its fix is on `main` (5484b3dddc, 184d2a3a34).
  The land did not remove the row (same shape as BL-1580's bl1295 row, retired
  in 27db76cdf7, and BL-1463's row on 2026-09-07).
- `standing_red_register_cli.bb` before: 6 rows, 1 unowned (this one);
  `effective_backlog_depth_cli.bb` printed 1.
- Run on `main` at 722b708546: `npx vitest run --config vitest.properties.config.mjs
  test/bl1358MutantTimeCeilingInvariants.property.test.js` -> 2 passed / 2, 4.85 s,
  reach map `{"positions":3,"minDrawsPerPosition":1}`.
- Outcome: row removed from `backlog/standing-reds.tsv`; no new owner minted
  (a green test gets no owner). `check_standing_red_register.sh` exit 0;
  register CLI `"unowned":[]` after.
