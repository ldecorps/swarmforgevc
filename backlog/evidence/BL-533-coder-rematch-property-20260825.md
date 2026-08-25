# BL-533 coder rematch — encode untracked-acceptance invariant (architect D1)

## Bounce
`ff30e6e717` — property runner covered epic wiring only.

## Change
`bl533_exit_gates_property_runner.bb` now fixtures a git repo where the
acceptance `.feature` exists on disk but is absent from `git ls-files`,
asserts `:untracked-acceptance` + `all-clean?` false, then tracks the file
and asserts the violation clears. Epic wiring properties retained.

Stacked on cleaner DRY tip + bounce evidence onto current origin/main.
