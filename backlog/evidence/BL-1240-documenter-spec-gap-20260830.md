# BL-1240 — spec-gap: `required_wiring` entry 1 names the wrong file

Documenter, 2026-08-30.

## What's blocking the forward

`required_wiring:` entry 1 reads:

```
swarmforge/scripts/test/suite_inventory_cli.bb::suite-manifest.tsv::the per-parcel check must reuse the existing inventory logic rather than growing a second, divergent notion of what counts as registered
```

`suite_inventory_cli.bb` never contains the literal string
`"suite-manifest.tsv"` — it references the manifest filename only through
`suite-inventory-lib/manifest-name`, a symbol from
`swarmforge/scripts/test/suite_inventory_lib.bb`, where the literal is
actually defined:

```clojure
(def manifest-name "suite-manifest.tsv")
```

The gate's `git show <commit>:<path>` read of `suite_inventory_cli.bb`
correctly finds no match, and fails closed:

```
PRE_QA_GATE_FAIL wiring BL-1240 swarmforge/scripts/test/suite_inventory_cli.bb
does not contain "suite-manifest.tsv" (the per-parcel check must reuse the
existing inventory logic rather than growing a second, divergent notion of
what counts as registered)
```

This is the BL-874/BL-960/BL-1183 shape again: the anchor names the module
that USES the constant, not the module that DEFINES the literal the pattern
searches for.

## What I did not do, and why

Ticket YAML `required_wiring:` is a specification the specifier owns
(Article 1.2); I did not rewrite the entry myself. The code, the acceptance,
and my documentation of this parcel (the new "Unregistered-Test Send-Time
Gate" section in `swarmforge/handoff-protocol.md`, the new how-to, and the
Specification.MD entry) are all otherwise correct and unaffected.

## Suggested fix, for whoever adjudicates this

Replace entry 1's path with the file that actually defines the literal:

```
swarmforge/scripts/test/suite_inventory_lib.bb::suite-manifest.tsv::the per-parcel check must reuse the existing inventory logic rather than growing a second, divergent notion of what counts as registered
```

Filed as a `note` (priority 00) to specifier and coordinator rather than
forwarding a broken git_handoff or silently editing ticket YAML outside my
role.
