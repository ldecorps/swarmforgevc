# BL-989 — cleaner pass — 20260825

- Tip-pure cherry-pick coder `4c62919219` onto `origin/main` only
  (ancestor chain hitchhiked BL-828/987/988/1079). `dels_on_origin=0`.
- No further DRY: three suites already share the same `printf '^%s\t'`
  tab-anchor shape; helpers in role_lifecycle already encapsulate.
- `node --test bl989PortableGrepTabAnchor.property.test.js` — 3/3 pass.

By cleaner.
